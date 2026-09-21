import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { loadEnv } from '../apps/api/dist/config/env.js';
import { healthRoutes } from '../apps/api/dist/features/health/routes.js';
import { createWebhookRoutes } from '../apps/api/dist/features/webhooks/routes.js';

const environment = loadEnv();

const app = new Hono();
app.route('/api/health', healthRoutes);
app.route('/api/webhooks/github', createWebhookRoutes(environment));
app.get('/api', (c) => {
  return c.json({
    name: 'Forge Review',
    version: '0.0.0',
    status: 'running',
  });
});

export default handle(app);
