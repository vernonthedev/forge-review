import { Hono } from 'hono';
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

export default app;