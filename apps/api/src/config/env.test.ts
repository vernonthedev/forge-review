import { describe, it, expect } from 'vitest';
import { loadEnv } from './env';

const validEnv = {
  GITHUB_APP_ID: '12345',
  GITHUB_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
  GITHUB_WEBHOOK_SECRET: 'secret',
  NVIDIA_API_KEY: 'key',
};

describe('loadEnv', () => {
  it('parses valid environment with defaults applied', () => {
    const env = loadEnv({ ...validEnv });
    expect(env.GITHUB_APP_ID).toBe('12345');
    expect(env.LLM_BASE_URL).toBe('https://integrate.api.nvidia.com/v1');
    expect(env.LLM_MODEL).toBe('nvidia/nemotron-3-ultra-550b-a55b');
    expect(env.PORT).toBe(3000);
  });

  it('throws listing missing fields when required vars are absent', () => {
    expect(() => loadEnv({})).toThrowError(/GITHUB_APP_ID.*GITHUB_PRIVATE_KEY.*GITHUB_WEBHOOK_SECRET/);
  });

  it('converts escaped newlines in the private key', () => {
    const env = loadEnv({ ...validEnv, GITHUB_PRIVATE_KEY: 'line1\\nline2' });
    expect(env.GITHUB_PRIVATE_KEY).toBe('line1\nline2');
  });
});
