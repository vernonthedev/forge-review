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
  severityThreshold: severitySchema.optional(),
  severity_threshold: severitySchema.optional(),
  maxComments: z.number().int().positive().max(50).optional(),
  max_comments: z.number().int().positive().max(50).optional(),
  incremental: z.boolean().optional(),
  verifyFindings: z.boolean().optional(),
  verify_findings: z.boolean().optional(),
}).transform(({ severityThreshold, severity_threshold, maxComments, max_comments, incremental, verifyFindings, verify_findings }) => ({
  severityThreshold: severityThreshold ?? severity_threshold ?? 'medium',
  maxComments: maxComments ?? max_comments ?? 15,
  incremental: incremental ?? true,
  verifyFindings: verifyFindings ?? verify_findings ?? true,
}));

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

export interface EnvConfigDefaults {
  llmBaseUrl?: string;
  llmModel?: string;
}

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
      const failClosedConfig = repositoryConfigSchema.parse({});
      return {
        config: { ...failClosedConfig, enabled: false },
        errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      };
    }
    return { config: result.data, errors: [] };
  } catch (error) {
    const failClosedConfig = repositoryConfigSchema.parse({});
    return {
      config: { ...failClosedConfig, enabled: false },
      errors: [error instanceof Error ? error.message : 'Invalid YAML/JSON format'],
    };
  }
}

export function getDefaultConfig(envDefaults?: EnvConfigDefaults): RepositoryConfig {
  const baseConfig = repositoryConfigSchema.parse({});
  if (!envDefaults) return baseConfig;

  return {
    ...baseConfig,
    model: {
      ...baseConfig.model,
      baseUrl: envDefaults.llmBaseUrl ?? baseConfig.model.baseUrl,
      model: envDefaults.llmModel ?? baseConfig.model.model,
    },
  };
}

export function mergeConfigWithEnvDefaults(config: RepositoryConfig, envDefaults?: EnvConfigDefaults): RepositoryConfig {
  if (!envDefaults) return config;
  return {
    ...config,
    model: {
      ...config.model,
      baseUrl: config.model.baseUrl ?? envDefaults.llmBaseUrl,
      model: config.model.model ?? envDefaults.llmModel,
    },
  };
}