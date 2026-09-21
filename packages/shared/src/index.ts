export * from './types.js';

export function createCorrelationId(): string {
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}