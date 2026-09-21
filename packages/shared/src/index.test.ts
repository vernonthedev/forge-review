import { describe, it, expect, vi } from 'vitest';
import { createCorrelationId, withRetry, HttpError } from './index';

describe('shared utilities', () => {
  it('creates correlation IDs with correct format', () => {
    const id = createCorrelationId();
    expect(id).toMatch(/^rev_\d+_[a-z0-9]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(createCorrelationId());
    }
    expect(ids.size).toBe(100);
  });

  it('retries transient failures then succeeds', async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new HttpError(503, 'unavailable'))
      .mockRejectedValueOnce(new HttpError(429, 'rate limited'))
      .mockResolvedValue('ok');
    const result = await withRetry(operation, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('does not retry authentication failures', async () => {
    const operation = vi.fn().mockRejectedValue(new HttpError(401, 'unauthorized'));
    await expect(withRetry(operation, { baseDelayMs: 1 })).rejects.toThrow('unauthorized');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('gives up after max attempts', async () => {
    const operation = vi.fn().mockRejectedValue(new HttpError(500, 'error'));
    await expect(withRetry(operation, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow('error');
    expect(operation).toHaveBeenCalledTimes(2);
  });
});