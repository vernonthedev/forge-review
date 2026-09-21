import { describe, it, expect } from 'vitest';
import { parseRepositoryConfig, getDefaultConfig } from './index';

describe('config parsing', () => {
  it('returns default config for empty input', () => {
    const { config, errors } = parseRepositoryConfig('{}');
    expect(errors).toHaveLength(0);
    expect(config.enabled).toBe(true);
    expect(config.model.provider).toBe('nvidia');
    expect(config.review.severityThreshold).toBe('medium');
  });

  it('parses valid JSON configuration', () => {
    const json = JSON.stringify({
      enabled: false,
      model: {
        provider: 'openai-compatible',
        model: 'gpt-4',
      },
      review: {
        severityThreshold: 'high',
        maxComments: 10,
      },
      exclude: ['*.test.ts'],
    });
    const { config, errors } = parseRepositoryConfig(json);
    expect(errors).toHaveLength(0);
    expect(config.enabled).toBe(false);
    expect(config.model.provider).toBe('openai-compatible');
    expect(config.model.model).toBe('gpt-4');
    expect(config.review.severityThreshold).toBe('high');
    expect(config.review.maxComments).toBe(10);
    expect(config.exclude).toContain('*.test.ts');
  });

  it('parses valid YAML configuration', () => {
    const yaml = `
enabled: false
model:
  provider: openai-compatible
  model: gpt-4
review:
  severityThreshold: high
  maxComments: 10
exclude:
  - "*.test.ts"
`;
    const { config, errors } = parseRepositoryConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(config.enabled).toBe(false);
    expect(config.model.provider).toBe('openai-compatible');
    expect(config.model.model).toBe('gpt-4');
    expect(config.review.severityThreshold).toBe('high');
    expect(config.review.maxComments).toBe(10);
    expect(config.exclude).toContain('*.test.ts');
  });

  it('handles malformed JSON', () => {
    const { config, errors } = parseRepositoryConfig('invalid: [');
    expect(errors.length).toBeGreaterThan(0);
    expect(config.enabled).toBe(false);
  });

  it('handles malformed YAML', () => {
    const { config, errors } = parseRepositoryConfig('invalid: [');
    expect(errors.length).toBeGreaterThan(0);
    expect(config.enabled).toBe(false);
  });

  it('accepts documented snake_case review keys', () => {
    const yaml = `
review:
  severity_threshold: high
  max_comments: 10
  verify_findings: false
`;
    const { config, errors } = parseRepositoryConfig(yaml);
    expect(errors).toHaveLength(0);
    expect(config.review.severityThreshold).toBe('high');
    expect(config.review.maxComments).toBe(10);
    expect(config.review.verifyFindings).toBe(false);
  });

  it('getDefaultConfig returns sensible defaults', () => {
    const config = getDefaultConfig();
    expect(config.enabled).toBe(true);
    expect(config.exclude).toContain('node_modules/**');
    expect(config.review.verifyFindings).toBe(true);
  });
});