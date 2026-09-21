import { Hono } from 'hono';

export const healthRoutes = new Hono()
  .get('/', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  })
  .get('/ready', (c) => {
    return c.json({ status: 'ready', timestamp: new Date().toISOString() });
  });