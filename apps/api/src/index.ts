import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { healthRoutes } from './features/health/routes.js';
import { webhookRoutes } from './features/webhooks/routes.js';

const app = new Hono();

app.route('/health', healthRoutes);
app.route('/webhooks/github', webhookRoutes);

app.get('/', (c) => {
  return c.json({
    name: 'Forge Review',
    version: '0.0.0',
    status: 'running'
  });
});

const port = parseInt(process.env.PORT ?? '3000', 10);

if (import.meta.url === `file://${process.argv[1]}`) {
  serve({ fetch: app.fetch, port });
  console.log(`Forge Review server running on http://localhost:${port}`);
}

export default app;