const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('../src/app');

// Tiny in-memory fakes so tests need no Postgres/Redis.
function fakes() {
  const rows = [];
  const cache = new Map();
  const db = {
    async query(sql, params = []) {
      if (sql.startsWith('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.startsWith('SELECT id')) return { rows: [...rows].reverse() };
      if (sql.startsWith('INSERT')) { const r = { id: rows.length + 1, title: params[0], done: false }; rows.push(r); return { rows: [r] }; }
      if (sql.startsWith('UPDATE')) { const r = rows.find((x) => x.id == params[1]); if (r) r.done = params[0]; return { rows: r ? [r] : [] }; }
      if (sql.startsWith('DELETE')) { const i = rows.findIndex((x) => x.id == params[0]); if (i >= 0) rows.splice(i, 1); return { rows: [] }; }
      throw new Error('unexpected sql ' + sql);
    },
  };
  const redis = {
    status: 'ready',
    async get(k) { return cache.get(k) ?? null; },
    async set(k, v) { cache.set(k, v); },
    async del(k) { cache.delete(k); },
    async incr() { return 1; },
  };
  return { db, redis };
}

async function withServer(state, fn, over = {}) {
  const f = { ...fakes(), ...over };
  const server = http.createServer(createApp({ ...f, state }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

test('healthz is always ok', async () => {
  await withServer({}, async (b) => { assert.equal((await fetch(b + '/healthz')).status, 200); });
});

test('readyz is 503 when DB is down and while shutting down', async () => {
  const bad = { db: { query: async () => { throw new Error('down'); } } };
  await withServer({}, async (b) => { assert.equal((await fetch(b + '/readyz')).status, 503); }, bad);
  await withServer({ shuttingDown: true }, async (b) => { assert.equal((await fetch(b + '/readyz')).status, 503); });
});

test('create, list (cache miss then hit), toggle, delete', async () => {
  await withServer({}, async (b) => {
    const j = { 'content-type': 'application/json' };
    const c = await fetch(b + '/api/tasks', { method: 'POST', headers: j, body: JSON.stringify({ title: 'learn k8s' }) });
    assert.equal(c.status, 201);
    const l1 = await fetch(b + '/api/tasks');
    assert.equal(l1.headers.get('x-cache'), 'MISS');
    const l2 = await fetch(b + '/api/tasks');
    assert.equal(l2.headers.get('x-cache'), 'HIT');
    const p = await fetch(b + '/api/tasks/1', { method: 'PATCH', headers: j, body: JSON.stringify({ done: true }) });
    assert.equal((await p.json()).done, true);
    assert.equal((await fetch(b + '/api/tasks/1', { method: 'DELETE' })).status, 204);
  });
});

test('API keeps working when Redis is down', async () => {
  const boom = async () => { throw new Error('redis down'); };
  const over = { redis: { status: 'end', get: boom, set: boom, del: boom, incr: boom } };
  await withServer({}, async (b) => {
    assert.equal((await fetch(b + '/api/tasks')).status, 200);
    assert.equal((await fetch(b + '/api/info')).status, 200);
  }, over);
});

test('rejects empty title', async () => {
  await withServer({}, async (b) => {
    const r = await fetch(b + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 400);
  });
});
