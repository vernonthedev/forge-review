import { z } from 'zod';

const envSchema = z.object({
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_PRIVATE_KEY: z
    .string()
    .min(1)
    .transform((key) => key.replace(/\\n/g, '\n')),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),
  LLM_BASE_URL: z.string().url().default('https://integrate.api.nvidia.com/v1'),
  LLM_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b'),
  NVIDIA_API_KEY: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration (check: ${fields})`);
  }
  return result.data;
}
