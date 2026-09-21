import { describe, it, expect } from 'vitest';
import { createCorrelationId } from './index';

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
});