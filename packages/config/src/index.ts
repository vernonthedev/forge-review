import { z } from 'zod';
import * as yaml from 'js-yaml';
import type { RepositoryConfig, ModelConfig, ReviewConfig, GuidelinesConfig, Severity } from '@forge-review/shared';

export type { RepositoryConfig, ModelConfig, ReviewConfig, GuidelinesConfig, Severity } from '@forge-review/shared';

export const severitySchema = z.enum(['critical', 'high', 'medium', 'low']) satisfies z.ZodType<Severity>;

export const modelConfigSchema = z.object({
  provider: z.string().default('nvidia'),
  model: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),
  baseUrl: z.string().url().optional().default('https://integrate.api.nvidia.com/v1'),
  apiKey: z.string().optional(),
  temperature: z.number().min(0).max(2).optional().default(0.1),
  maxTokens: z.number().int().positive().optional().default(4096),
});

export const reviewConfigSchema = z.object({
  severityThreshold: severitySchema.default('medium'),
  maxComments: z.number().int().positive().max(50).default(15),
  incremental: z.boolean().default(true),
  verifyFindings: z.boolean().default(true),
});

export const guidelinesConfigSchema = z.object({
  path: z.string().default('.github/forge-review.md'),
});

export const repositoryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  model: modelConfigSchema.default({}),
  review: reviewConfigSchema.default({}),
  exclude: z.array(z.string()).default([
    '**/*.lock',
    'dist/**',
    '.next/**',
    'coverage/**',
    'node_modules/**',
  ]),
  guidelines: guidelinesConfigSchema.optional(),
});

export type ModelConfigInput = z.input<typeof modelConfigSchema>;
export type ReviewConfigInput = z.input<typeof reviewConfigSchema>;
export type GuidelinesConfigInput = z.input<typeof guidelinesConfigSchema>;
export type RepositoryConfigInput = z.input<typeof repositoryConfigSchema>;

function parseContent(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return JSON.parse(content);
  }
  return yaml.load(content);
}

export function parseRepositoryConfig(content: string): { config: RepositoryConfig; errors: string[] } {
  try {
    const parsed = parseContent(content);
    const result = repositoryConfigSchema.safeParse(parsed);
    if (!result.success) {
      return {
        config: repositoryConfigSchema.parse({}),
        errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    return { config: result.data, errors: [] };
  } catch (error) {
    return {
      config: repositoryConfigSchema.parse({}),
      errors: [error instanceof Error ? error.message : 'Invalid YAML/JSON format'],
    };
  }
}

export function getDefaultConfig(): RepositoryConfig {
  return repositoryConfigSchema.parse({});
}