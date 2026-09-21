import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { loadEnv } from './config/env.js';
import { healthRoutes } from './features/health/routes.js';
import { createWebhookRoutes } from './features/webhooks/routes.js';

const environment = loadEnv();

const app = new Hono();

app.route('/health', healthRoutes);
app.route('/webhooks/github', createWebhookRoutes(environment));

app.get('/', (c) => {
  return c.json({
    name: 'Forge Review',
    version: '0.0.0',
    status: 'running'
  });
});

const invokedPath = process.argv[1];
const isMainModule = invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath);

if (isMainModule) {
  serve({ fetch: app.fetch, port: environment.PORT });
  console.log(`Forge Review server running on http://localhost:${environment.PORT}`);
}

export default app;