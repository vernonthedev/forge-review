import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
import {
  verifyWebhookSignature,
  extractInstallationId,
  extractRepository,
  extractPullRequestInfo,
  isSupportedEvent,
  generateFindingId,
  isForgeReviewComment,
  extractFindingId,
  createFindingMarker,
  createCommitStatus,
} from './index';

describe('github utilities', () => {
  describe('verifyWebhookSignature', () => {
    it('verifies valid signature', () => {
      const payload = '{"test": "data"}';
      const secret = 'secret';
      const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
      expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
    });

    it('rejects invalid signature', () => {
      expect(verifyWebhookSignature('payload', 'sha256=invalid', 'secret')).toBe(false);
    });
  });

  describe('extractInstallationId', () => {
    it('extracts installation ID from payload', () => {
      const payload = {
        installation: { id: 12345 },
        repository: { owner: { login: 'test' }, name: 'repo', full_name: 'test/repo' },
        pull_request: { number: 1, title: 'Test', body: '', base: { ref: 'main', sha: 'abc' }, head: { ref: 'feature', sha: 'def' } },
      } as any;
      expect(extractInstallationId(payload)).toBe(12345);
    });
  });

  describe('extractRepository', () => {
    it('extracts repository info', () => {
      const payload = {
        installation: { id: 1 },
        repository: { owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo' },
        pull_request: { number: 1, title: 'Test', body: '', base: { ref: 'main', sha: 'abc' }, head: { ref: 'feature', sha: 'def' } },
      } as any;
      const repo = extractRepository(payload);
      expect(repo).toEqual({ owner: 'owner', name: 'repo', fullName: 'owner/repo' });
    });
  });

  describe('extractPullRequestInfo', () => {
    it('extracts PR info', () => {
      const payload = {
        installation: { id: 1 },
        repository: { owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo' },
        pull_request: { number: 42, title: 'Test PR', body: 'Description', base: { ref: 'main', sha: 'base123' }, head: { ref: 'feature', sha: 'head456' } },
      } as any;
      const pr = extractPullRequestInfo(payload);
      expect(pr).toEqual({
        number: 42,
        title: 'Test PR',
        description: 'Description',
        baseBranch: 'main',
        headBranch: 'feature',
        baseSha: 'base123',
        headSha: 'head456',
      });
    });

    it('handles null body', () => {
      const payload = {
        installation: { id: 1 },
        repository: { owner: { login: 'owner' }, name: 'repo', full_name: 'owner/repo' },
        pull_request: { number: 1, title: 'Test', body: null, base: { ref: 'main', sha: 'abc' }, head: { ref: 'feature', sha: 'def' } },
      } as any;
      const pr = extractPullRequestInfo(payload);
      expect(pr.description).toBe('');
    });
  });

  describe('isSupportedEvent', () => {
    it('returns true for supported events', () => {
      expect(isSupportedEvent('opened')).toBe(true);
      expect(isSupportedEvent('reopened')).toBe(true);
      expect(isSupportedEvent('synchronize')).toBe(true);
    });

    it('returns false for unsupported events', () => {
      expect(isSupportedEvent('closed')).toBe(false);
      expect(isSupportedEvent('edited')).toBe(false);
      expect(isSupportedEvent('unknown')).toBe(false);
    });
  });

  describe('finding markers', () => {
    it('generates finding IDs', () => {
      const id = generateFindingId('src/test.ts', 42, 'Test finding');
      expect(id).toMatch(/^src_test_ts_42_Test_finding_[a-z0-9]+$/);
    });

    it('creates and extracts finding markers', () => {
      const marker = createFindingMarker('test-id-123');
      expect(marker).toBe('<!-- forge-review:finding:test-id-123 -->');
      expect(extractFindingId(marker)).toBe('test-id-123');
    });

    it('detects forge review comments', () => {
      expect(isForgeReviewComment('Some text <!-- forge-review:finding:abc --> more text')).toBe(true);
      expect(isForgeReviewComment('Regular comment')).toBe(false);
    });
  });

  describe('createCommitStatus', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
      mockFetch.mockReset();
    });

    it('posts pending, success, and failure states', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

      for (const state of ['pending', 'success', 'failure'] as const) {
        await createCommitStatus('token', { owner: 'o', repo: 'r', sha: 'abc123', state, description: 'desc' });
      }

      expect(mockFetch).toHaveBeenCalledTimes(3);
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(mockFetch.mock.calls[0][0]).toContain('/repos/o/r/statuses/abc123');
      expect(JSON.parse(options.body as string)).toMatchObject({ state: 'pending', context: 'Forge Review' });
    });

    it('truncates long descriptions to 140 characters', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
      await createCommitStatus('token', { owner: 'o', repo: 'r', sha: 'abc', state: 'success', description: 'x'.repeat(200) });
      const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect((JSON.parse(options.body as string).description as string).length).toBeLessThanOrEqual(140);
    });

    it('throws on API failure', async () => {
      mockFetch.mockResolvedValue({ ok: false, text: async () => 'boom' });
      await expect(
        createCommitStatus('token', { owner: 'o', repo: 'r', sha: 'abc', state: 'failure', description: 'desc' })
      ).rejects.toThrow('Failed to create commit status');
    });
  });
});