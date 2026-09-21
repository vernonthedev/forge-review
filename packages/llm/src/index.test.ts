import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { reviewResultSchema, reviewFindingSchema, OpenAICompatibleProvider } from './index';
import type { ReviewInput } from '@forge-review/shared';

describe('llm schemas', () => {
  it('validates correct review result', () => {
    const result = {
      summary: 'Good PR',
      findings: [
        {
          severity: 'high',
          category: 'security',
          file: 'src/auth.ts',
          line: 42,
          title: 'Hardcoded secret',
          body: 'API key found in source code',
          suggestion: 'Use environment variable',
          confidence: 0.95,
        },
      ],
    };
    expect(reviewResultSchema.safeParse(result).success).toBe(true);
  });

  it('rejects invalid severity', () => {
    const result = {
      summary: 'Test',
      findings: [
        {
          severity: 'invalid',
          category: 'security',
          file: 'test.ts',
          line: 1,
          title: 'Test',
          body: 'Test',
          confidence: 0.5,
        },
      ],
    };
    expect(reviewResultSchema.safeParse(result).success).toBe(false);
  });

  it('rejects invalid confidence range', () => {
    const result = {
      summary: 'Test',
      findings: [
        {
          severity: 'medium',
          category: 'other',
          file: 'test.ts',
          line: 1,
          title: 'Test',
          body: 'Test',
          confidence: 1.5,
        },
      ],
    };
    expect(reviewResultSchema.safeParse(result).success).toBe(false);
  });

  it('validates finding schema', () => {
    const finding = {
      severity: 'medium',
      category: 'performance',
      file: 'src/utils.ts',
      line: 10,
      title: 'Inefficient loop',
      body: 'Use map instead of forEach',
      confidence: 0.8,
    };
    expect(reviewFindingSchema.safeParse(finding).success).toBe(true);
  });
});

describe('OpenAICompatibleProvider', () => {
  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterAll(() => {
    vi.stubGlobal('fetch', originalFetch);
  });

  it('builds prompt with repository context', () => {
    const provider = new OpenAICompatibleProvider({
      provider: 'test',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
    });

    const input: ReviewInput = {
      repository: { owner: 'owner', name: 'repo', fullName: 'owner/repo' },
      pullRequest: {
        number: 1,
        title: 'Test PR',
        description: 'Test description',
        baseBranch: 'main',
        headBranch: 'feature',
        baseSha: 'abc123',
        headSha: 'def456',
      },
      changedFiles: [
        { filename: 'src/test.ts', status: 'modified', patch: '@@ -1,3 +1,4 @@\n const x = 1\n+const y = 2\n', additions: 1, deletions: 0 },
      ],
      repositoryConfig: {
        enabled: true,
        model: { provider: 'test', model: 'test-model' },
        review: { severityThreshold: 'medium', maxComments: 15, incremental: true, verifyFindings: true },
        exclude: [],
      },
    };

    const prompt = (provider as any).buildPrompt(input);
    expect(prompt).toContain('owner/repo');
    expect(prompt).toContain('Test PR');
    expect(prompt).toContain('src/test.ts');
    expect(prompt).toContain('const y = 2');
  });

  it('parses valid JSON response', () => {
    const provider = new OpenAICompatibleProvider({
      provider: 'test',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
    });

    const response = {
      content: JSON.stringify({
        summary: 'Looks good',
        findings: [],
      }),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    };

    const result = (provider as any).parseResponse(response);
    expect(result.summary).toBe('Looks good');
    expect(result.findings).toHaveLength(0);
  });

  it('throws on invalid JSON', () => {
    const provider = new OpenAICompatibleProvider({
      provider: 'test',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
    });

    const response = { content: 'not json', usage: undefined };
    expect(() => (provider as any).parseResponse(response)).toThrow('Failed to parse JSON');
  });

  it('throws on schema validation failure', () => {
    const provider = new OpenAICompatibleProvider({
      provider: 'test',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      apiKey: 'test-key',
    });

    const response = {
      content: JSON.stringify({ summary: 'Test', findings: [{ severity: 'invalid' }] }),
      usage: undefined,
    };
    expect(() => (provider as any).parseResponse(response)).toThrow('Invalid response format');
  });
});