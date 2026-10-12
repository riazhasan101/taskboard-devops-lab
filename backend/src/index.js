const { Pool } = require('pg');
const Redis = require('ioredis');
const { createApp } = require('./app');

const log = (level, msg, extra = {}) => console.log(JSON.stringify({ level, msg, ...extra }));

const PORT = parseInt(process.env.PORT, 10) || 3000;
const db = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000 });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy: (n) => Math.min(n * 200, 2000),
});
redis.on('error', (e) => log('warn', 'redis error', { err: e.message }));

const state = { shuttingDown: false };

async function migrate() {
  // Advisory lock: with N replicas starting together, only one runs DDL at a time.
  const c = await db.connect();
  try {
    await c.query('SELECT pg_advisory_lock(424242)');
    await c.query(`CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  } finally {
    await c.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    c.release();
  }
}

async function main() {
  // Retry so the pod survives the DB starting a few seconds later (compose / fresh cluster)
  for (let i = 1; ; i++) {
    try { await migrate(); break; }
    catch (e) {
      log('warn', 'db not ready, retrying', { attempt: i, err: e.message });
      if (i >= 30) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const server = createApp({ db, redis, state }).listen(PORT, () => log('info', 'listening', { port: PORT }));

  // Graceful shutdown: fail readiness first, give the LB time to drain, then close.
  const shutdown = (sig) => {
    log('info', 'shutdown requested', { sig });
    state.shuttingDown = true;
    setTimeout(() => {
      server.close(async () => {
        await db.end().catch(() => {});
        redis.disconnect();
        process.exit(0);
      });
    }, parseInt(process.env.SHUTDOWN_DELAY_MS, 10) || 5000);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => { log('fatal', e.message); process.exit(1); });
