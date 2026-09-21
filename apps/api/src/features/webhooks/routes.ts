import { Hono } from 'hono';
import { verifyWebhookSignature, extractInstallationId, extractRepository, extractPullRequestInfo, isSupportedEvent, createInstallationToken } from '@forge-review/github';
import { loadRepositoryConfig, loadGuidelines, createReviewEngine } from '@forge-review/review-engine';
import { createCorrelationId } from '@forge-review/shared';
import type { WebhookPayload } from '@forge-review/shared';

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

    const [config, guidelines] = await Promise.all([
      loadRepositoryConfig(installationToken.token, repository.owner, repository.name, pullRequest.headSha),
      loadGuidelines(installationToken.token, repository.owner, repository.name, pullRequest.headSha),
    ]);

    if (!config.enabled) {
      console.log(`[${correlationId}] Review disabled for ${repository.fullName}`);
      return c.json({ received: true, skipped: true }, 202);
    }

    const providerConfig = {
      provider: config.model.provider,
      baseUrl: config.model.baseUrl ?? c.env.LLM_BASE_URL,
      model: config.model.model,
      apiKey: config.model.apiKey ?? c.env.NVIDIA_API_KEY,
      temperature: config.model.temperature,
      maxTokens: config.model.maxTokens,
    };

    const engine = await createReviewEngine(providerConfig);

    const reviewContext = {
      correlationId,
      installationId,
      repository,
      pullRequest,
      token: installationToken.token,
      config,
      guidelines,
    };

    c.executionCtx.waitUntil(
      engine.executeReview(reviewContext).then(
        (job: { startedAt: Date; result?: { findings: unknown[] }; stage: string }) => {
          const duration = Date.now() - job.startedAt.getTime();
          console.log(
            `[${correlationId}] Review completed for PR #${pullRequest.number} in ${duration}ms ` +
            `(findings: ${job.result?.findings.length ?? 0}, stage: ${job.stage})`
          );
        },
        (error: Error) => {
          const duration = Date.now() - startTime;
          console.error(`[${correlationId}] Review failed for PR #${pullRequest.number} in ${duration}ms:`, error);
        }
      )
    );

    return c.json({ received: true, reviewId: correlationId }, 202);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[${correlationId}] Webhook handler error in ${duration}ms:`, error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export { webhookRoutes };