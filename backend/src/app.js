const express = require('express');
const os = require('os');
const client = require('prom-client');

/**
 * Builds the Express app. db / redis are injected so the app is testable
 * and so readiness can reflect real dependency health.
 */
function createApp({ db, redis, state }) {
  const app = express();
  app.use(express.json());

  // ---- metrics (scraped by Prometheus at /metrics) ----
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
    registers: [register],
  });
  app.use((req, res, next) => {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = req.route ? req.baseUrl + req.route.path : 'unmatched';
      end({ method: req.method, route, status: res.statusCode });
    });
    next();
  });

  // ---- probes ----
  // liveness: process is up. Must NOT depend on db/redis (else restart storms).
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  // readiness: can this pod serve traffic? Needs the DB. Redis is optional (cache).
  app.get('/readyz', async (_req, res) => {
    if (state.shuttingDown) return res.status(503).json({ status: 'shutting-down' });
    try {
      await db.query('SELECT 1');
      res.json({ status: 'ready', redis: redis.status });
    } catch (e) {
      res.status(503).json({ status: 'db-unavailable' });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  // ---- cache helpers: cache-aside, app keeps working if Redis is down ----
  const cacheGet = async (k) => {
    try { const v = await redis.get(k); return v ? JSON.parse(v) : null; } catch { return null; }
  };
  const cacheSet = async (k, v, ttl = 10) => {
    try { await redis.set(k, JSON.stringify(v), 'EX', ttl); } catch { /* degrade silently */ }
  };
  const cacheDel = async (k) => { try { await redis.del(k); } catch { /* ignore */ } };

  // ---- API ----
  app.get('/api/tasks', async (_req, res, next) => {
    try {
      const cached = await cacheGet('tasks:list');
      if (cached) return res.set('X-Cache', 'HIT').json(cached);
      const { rows } = await db.query('SELECT id, title, done, created_at FROM tasks ORDER BY id DESC LIMIT 200');
      await cacheSet('tasks:list', rows);
      res.set('X-Cache', 'MISS').json(rows);
    } catch (e) { next(e); }
  });

  app.post('/api/tasks', async (req, res, next) => {
    try {
      const title = String(req.body?.title || '').trim();
      if (!title) return res.status(400).json({ error: 'title required' });
      const { rows } = await db.query('INSERT INTO tasks (title) VALUES ($1) RETURNING *', [title.slice(0, 200)]);
      await cacheDel('tasks:list');
      res.status(201).json(rows[0]);
    } catch (e) { next(e); }
  });

  app.patch('/api/tasks/:id', async (req, res, next) => {
    try {
      const { rows } = await db.query('UPDATE tasks SET done = $1 WHERE id = $2 RETURNING *', [!!req.body?.done, req.params.id]);
      if (!rows[0]) return res.status(404).json({ error: 'not found' });
      await cacheDel('tasks:list');
      res.json(rows[0]);
    } catch (e) { next(e); }
  });

  app.delete('/api/tasks/:id', async (req, res, next) => {
    try {
      await db.query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
      await cacheDel('tasks:list');
      res.status(204).end();
    } catch (e) { next(e); }
  });

  // Shows which pod answered + a shared counter in Redis.
  // Great for watching load-balancing, rolling updates and pod failures from the UI.
  app.get('/api/info', async (_req, res) => {
    let hits = null;
    try { hits = await redis.incr('stats:hits'); } catch { /* redis down */ }
    res.json({ pod: os.hostname(), version: process.env.APP_VERSION || 'dev', hits });
  });

  // CPU burner to trigger the HPA during practice. Capped at 2s per call.
  app.get('/api/burn', (req, res) => {
    const ms = Math.min(parseInt(req.query.ms, 10) || 200, 2000);
    const end = Date.now() + ms;
    let x = 0;
    while (Date.now() < end) x += Math.sqrt(Math.random());
    res.json({ burned_ms: ms, pod: os.hostname() });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(JSON.stringify({ level: 'error', msg: err.message }));
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

module.exports = { createApp };
