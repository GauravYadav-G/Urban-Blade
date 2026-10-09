import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import underPressure from '@fastify/under-pressure';
import { healthRoutes } from '../dist/modules/health/health.routes.js';
import { pressureResponse } from '../dist/core/load-shedding.js';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
redis.disconnect();
const originalQuery = pool.query;
for (const healthy of [true, false]) {
  test(`readiness sends once with slow onSend and database ${healthy ? 'up' : 'down'}`, async () => {
    pool.query = async () => { if (!healthy) throw new Error('test unavailable'); return {rows: [{health: 1}]}; };
    const app = Fastify();
    let sends = 0;
    app.addHook('onSend', async (_req, _reply, payload) => { sends++; await new Promise(r => setTimeout(r, 15)); return payload; });
    await app.register(healthRoutes, {prefix: '/api'});
    const response = await app.inject('/api/health/ready');
    await new Promise(r => setTimeout(r, 40));
    assert.equal(response.statusCode, healthy ? 200 : 503);
    assert.equal(response.json().status, healthy ? 'ready' : 'not_ready');
    assert.equal(sends, 1);
    await app.close();
  });
}
test('load shedding responds once, skips commerce handler and permits readiness', async () => {
  const app = Fastify();
  let executed = 0, sends = 0;
  app.addHook('onSend', async (_req, _reply, payload) => { sends++; await new Promise(r => setTimeout(r, 10)); return payload; });
  await app.register(underPressure, {maxHeapUsedBytes: 1, sampleInterval: 10, pressureHandler: pressureResponse});
  app.get('/checkout', async () => { executed++; return {ok: true}; });
  app.get('/api/health/ready', async () => ({status: 'ready'}));
  await app.ready();
  await new Promise(r => setTimeout(r, 80));
  const response = await app.inject('/checkout');
  assert.equal(response.statusCode, 503);
  assert.equal(executed, 0);
  assert.equal(sends, 1);
  const ready = await app.inject('/api/health/ready');
  assert.equal(ready.statusCode, 200);
  await app.close();
});
test.after(async () => { pool.query = originalQuery; await pool.end(); });
