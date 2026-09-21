export * from './types.js';

export function createCorrelationId(): string {
  return `rev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof HttpError) return isRetryableStatus(error.status);
  if (error instanceof TypeError) return true;
  return false;
}

export async function withRetry<Success>(operation: () => Promise<Success>, options?: RetryOptions): Promise<Success> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  let attempt = 0;

  for (;;) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      if (attempt >= maxAttempts || !isRetryableError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1)));
    }
  }
}