import { Hono } from 'hono';
import { verifyWebhookSignature, extractInstallationId, extractRepository, extractPullRequestInfo, isSupportedEvent, createInstallationToken, createCommitStatus } from '@forge-review/github';
import { loadRepositoryConfig, loadGuidelines, createReviewEngine } from '@forge-review/review-engine';
import { createCorrelationId } from '@forge-review/shared';
import { mergeConfigWithEnvDefaults } from '@forge-review/config';
import type { WebhookPayload } from '@forge-review/shared';

const processedDeliveries = new Set<string>();
const MAX_PROCESSED_DELIVERIES = 10000;

const webhookRoutes = new Hono<{
  Bindings: {
    GITHUB_APP_ID: string;
    GITHUB_PRIVATE_KEY: string;
    GITHUB_WEBHOOK_SECRET: string;
    LLM_BASE_URL: string;
    LLM_MODEL: string;
    NVIDIA_API_KEY: string;
  };
}>();

webhookRoutes.post('/', async (c) => {
  const correlationId = createCorrelationId();
  const startTime = Date.now();

  try {
    const signature = c.req.header('x-hub-signature-256') ?? '';
    const payload = await c.req.text();

    if (!verifyWebhookSignature(payload, signature, c.env.GITHUB_WEBHOOK_SECRET)) {
      console.log(`[${correlationId}] Invalid webhook signature`);
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const event = c.req.header('x-github-event');
    if (event !== 'pull_request') {
      return c.json({ received: true }, 202);
    }

    const deliveryId = c.req.header('x-github-delivery');
    if (deliveryId) {
      if (processedDeliveries.has(deliveryId)) {
        console.log(`[${correlationId}] Duplicate delivery ID detected: ${deliveryId}`);
        return c.json({ received: true, duplicate: true }, 202);
      }
      if (processedDeliveries.size >= MAX_PROCESSED_DELIVERIES) {
        const firstKey = processedDeliveries.values().next().value;
        if (firstKey) processedDeliveries.delete(firstKey);
      }
      processedDeliveries.add(deliveryId);
    }

    const webhookPayload = JSON.parse(payload) as WebhookPayload;

    if (!isSupportedEvent(webhookPayload.action)) {
      console.log(`[${correlationId}] Unsupported action: ${webhookPayload.action}`);
      return c.json({ received: true }, 202);
    }

    const installationId = extractInstallationId(webhookPayload);
    const repository = extractRepository(webhookPayload);
    const pullRequest = extractPullRequestInfo(webhookPayload);

    console.log(`[${correlationId}] Processing PR #${pullRequest.number} in ${repository.fullName} (${webhookPayload.action})`);

    const installationToken = await createInstallationToken(
      { appId: c.env.GITHUB_APP_ID, privateKey: c.env.GITHUB_PRIVATE_KEY },
      installationId
    );

    const config = await loadRepositoryConfig(installationToken.token, repository.owner, repository.name, pullRequest.baseSha);
    
    const envDefaults = {
      llmBaseUrl: c.env.LLM_BASE_URL,
      llmModel: c.env.LLM_MODEL,
    };
    const mergedConfig = mergeConfigWithEnvDefaults(config, envDefaults);

    const guidelines = await loadGuidelines(
      installationToken.token,
      repository.owner,
      repository.name,
      pullRequest.baseSha,
      mergedConfig.guidelines?.path ?? '.github/forge-review.md'
    );

    if (!mergedConfig.enabled) {
      console.log(`[${correlationId}] Review disabled for ${repository.fullName}`);
      return c.json({ received: true, skipped: true }, 202);
    }

    const providerConfig = {
      provider: mergedConfig.model.provider,
      baseUrl: mergedConfig.model.baseUrl ?? 'https://integrate.api.nvidia.com/v1',
      model: mergedConfig.model.model,
      apiKey: mergedConfig.model.apiKey ?? (mergedConfig.model.baseUrl ? undefined : c.env.NVIDIA_API_KEY),
      temperature: mergedConfig.model.temperature,
      maxTokens: mergedConfig.model.maxTokens,
    };

    const engine = await createReviewEngine(providerConfig);

    const reviewContext = {
      correlationId,
      installationId,
      repository,
      pullRequest,
      token: installationToken.token,
      config: mergedConfig,
      guidelines,
      eventType: webhookPayload.action,
    };

    await createCommitStatus(installationToken.token, {
      owner: repository.owner,
      repo: repository.name,
      sha: pullRequest.headSha,
      state: 'pending',
      description: 'Forge Review is analyzing this PR',
    }).catch((error: unknown) => {
      console.log(`[${correlationId}] Failed to post pending status:`, error instanceof Error ? error.message : error);
    });

    const reviewPromise = engine.executeReview(reviewContext).then(
      async (job: { startedAt: Date; result?: { findings: Array<{ severity: string }> }; stage: string }) => {
        const duration = Date.now() - job.startedAt.getTime();
        const findings = job.result?.findings ?? [];
        const summary = findings.length === 0
          ? 'Forge Review completed: no findings'
          : `Forge Review completed: ${findings.length} finding${findings.length === 1 ? '' : 's'}`;
        console.log(
          `[${correlationId}] Review completed for PR #${pullRequest.number} in ${duration}ms ` +
          `(findings: ${findings.length}, stage: ${job.stage})`
        );
        await createCommitStatus(installationToken.token, {
          owner: repository.owner,
          repo: repository.name,
          sha: pullRequest.headSha,
          state: 'success',
          description: summary,
        }).catch((error: unknown) => {
          console.log(`[${correlationId}] Failed to post success status:`, error instanceof Error ? error.message : error);
        });
      },
      async (error: Error) => {
        const duration = Date.now() - startTime;
        console.error(`[${correlationId}] Review failed for PR #${pullRequest.number} in ${duration}ms:`, error);
        await createCommitStatus(installationToken.token, {
          owner: repository.owner,
          repo: repository.name,
          sha: pullRequest.headSha,
          state: 'failure',
          description: `Forge Review failed: ${error.message}`,
        }).catch((statusError: unknown) => {
          console.log(`[${correlationId}] Failed to post failure status:`, statusError instanceof Error ? statusError.message : statusError);
        });
      }
    );

    const executionContext = c.executionCtx as { waitUntil?: (promise: Promise<unknown>) => void } | undefined;
    if (typeof executionContext?.waitUntil === 'function') {
      executionContext.waitUntil(reviewPromise);
    } else {
      void reviewPromise;
    }

    return c.json({ received: true, reviewId: correlationId }, 202);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${correlationId}] Webhook handler error in ${duration}ms:`, error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export { webhookRoutes };