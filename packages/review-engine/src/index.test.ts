import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewEngine } from './index';
import type { ReviewFinding, ChangedFile } from '@forge-review/shared';

describe('ReviewEngine', () => {
  const mockModel = {
    review: vi.fn(),
    lastUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters excluded files', () => {
    const engine = new ReviewEngine({ provider: 'test', baseUrl: 'https://api.test.com', model: 'test', apiKey: 'key' });
    (engine as any).model = mockModel;

    const files: ChangedFile[] = [
      { filename: 'src/index.ts', status: 'modified', patch: '@@ -1 +1 @@\n-const x=1\n+const x=2', additions: 1, deletions: 1 },
      { filename: 'package.lock', status: 'modified', patch: '@@ -1 +1 @@\n-lock', additions: 0, deletions: 1 },
      { filename: 'dist/bundle.js', status: 'added', patch: '@@ -0,0 +1 @@\n+console.log', additions: 1, deletions: 0 },
    ];

    const filtered = (engine as any).filterFiles(files, ['**/*.lock', 'dist/**']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].filename).toBe('src/index.ts');
  });

  it('extracts changed lines from patch', () => {
    const engine = new ReviewEngine({ provider: 'test', baseUrl: 'https://api.test.com', model: 'test', apiKey: 'key' });

    const patch = `@@ -10,3 +10,4 @@
 const existing = 1
-const removed = 2
+const added = 3
+const another = 4
 const unchanged = 5`;

    const lines = (engine as any).extractChangedLines(patch);
    expect(lines).toContain(11);
    expect(lines).toContain(12);
    expect(lines).not.toContain(10);
  });

  it('validates finding against changed lines', () => {
    const engine = new ReviewEngine({ provider: 'test', baseUrl: 'https://api.test.com', model: 'test', apiKey: 'key' });

    const finding: ReviewFinding = {
      severity: 'high',
      category: 'security',
      file: 'src/auth.ts',
      line: 41,
      title: 'Hardcoded secret',
      body: 'API key in source',
      confidence: 0.9,
    };

    const changedFiles: ChangedFile[] = [
      { filename: 'src/auth.ts', status: 'modified', patch: '@@ -40,5 +40,6 @@\n const config = {}\n+const API_KEY = "secret"\n', additions: 1, deletions: 0 },
    ];

    const isValid = (engine as any).validateFinding(finding, changedFiles, 'head123');
    expect(isValid).toBe(true);
  });

  it('rejects finding for unchanged line', () => {
    const engine = new ReviewEngine({ provider: 'test', baseUrl: 'https://api.test.com', model: 'test', apiKey: 'key' });

    const finding: ReviewFinding = {
      severity: 'high',
      category: 'security',
      file: 'src/auth.ts',
      line: 50,
      title: 'Issue on unchanged line',
      body: 'Not in diff',
      confidence: 0.9,
    };

    const changedFiles: ChangedFile[] = [
      { filename: 'src/auth.ts', status: 'modified', patch: '@@ -40,5 +40,6 @@\n const config = {}\n+const API_KEY = "secret"\n', additions: 1, deletions: 0 },
    ];

    const isValid = (engine as any).validateFinding(finding, changedFiles, 'head123');
    expect(isValid).toBe(false);
  });

  it('rejects finding for non-existent file', () => {
    const engine = new ReviewEngine({ provider: 'test', baseUrl: 'https://api.test.com', model: 'test', apiKey: 'key' });

    const finding: ReviewFinding = {
      severity: 'high',
      category: 'security',
      file: 'src/nonexistent.ts',
      line: 10,
      title: 'Issue in missing file',
      body: 'File not in PR',
      confidence: 0.9,
    };

    const changedFiles: ChangedFile[] = [
      { filename: 'src/auth.ts', status: 'modified', patch: '@@ -1,1 +1,2 @@\n+const x = 1', additions: 1, deletions: 0 },
    ];

    const isValid = (engine as any).validateFinding(finding, changedFiles, 'head123');
    expect(isValid).toBe(false);
  });

  it('determines review event from findings', () => {
    const engine = new ReviewEngine({ provider: 'test', baseUrl: 'https://api.test.com', model: 'test', apiKey: 'key' });

    expect((engine as any).determineReviewEvent([])).toBe('COMMENT');
    expect((engine as any).determineReviewEvent([
      { severity: 'low', category: 'other', file: 'a.ts', line: 1, title: 't', body: 'b', confidence: 0.5 },
    ])).toBe('COMMENT');
    expect((engine as any).determineReviewEvent([
      { severity: 'high', category: 'security', file: 'a.ts', line: 1, title: 't', body: 'b', confidence: 0.5 },
    ])).toBe('REQUEST_CHANGES');
    expect((engine as any).determineReviewEvent([
      { severity: 'critical', category: 'correctness', file: 'a.ts', line: 1, title: 't', body: 'b', confidence: 0.5 },
    ])).toBe('REQUEST_CHANGES');
  });
});