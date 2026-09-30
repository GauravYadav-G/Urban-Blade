import { createHash, randomUUID } from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.middleware.js';
import { pool } from '../db/pool.js';
import { config } from '../config.js';
import { redis, isRedisAvailable } from '../redis/client.js';

type Entry = { owner?: string; fingerprint: string; status?: number; body?: unknown; expiresAt: number };
const memory = new Map<string, Entry>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function idempotencyHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) return;
  // Restrict caching to authenticated checkout creation, never login/token responses.
  if (!['/api/orders/cod-order', '/api/orders/razorpay/create-order'].includes(request.url.split('?')[0])) return;
  const key = request.headers['x-idempotency-key'] || request.headers['idempotency-key'];
  if (!key) {
    if (config.isProduction) reply.code(400).send({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    return;
  }
  if (typeof key !== 'string' || key.length > 100 || !/^[\w-]+$/.test(key)) {
    reply.code(400).send({ error: 'INVALID_IDEMPOTENCY_KEY' }); return;
  }
  await requireAuth(request, reply);
  if (reply.sent) return;
  const redisKey = `idempotency:${hash(`${request.user.id}:${request.method}:${request.url.split('?')[0]}:${key}`)}`;
  const fingerprint = hash(JSON.stringify(request.body));
  const entry: Entry = { owner: randomUUID(), fingerprint, expiresAt: Date.now() + 120000 };
  let existing: Entry | undefined;
  const useRedis = isRedisAvailable() && !!redis;
  // The database transaction owns both the order and its successful response.
  // No Redis dependency, expiring lock, or commit/response gap in production.
  if (config.isProduction) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [redisKey]);
      if (!lock.rows[0].acquired) {
        await client.query('ROLLBACK'); client.release();
        reply.code(409).send({ error: 'REQUEST_IN_FLIGHT', message: 'Your checkout is already being processed. Please wait.' }); return;
      }
      const prior = await client.query('SELECT fingerprint, status, body FROM checkout_requests WHERE key = $1', [redisKey]);
      if (prior.rows.length) {
        const saved = prior.rows[0];
        await client.query('ROLLBACK'); client.release();
        if (saved.fingerprint !== fingerprint) reply.code(409).send({ error: 'IDEMPOTENCY_CONFLICT' });
        else reply.code(saved.status).send(saved.body);
        return;
      }
      (request as any).checkoutClient = client;
      (request as any).idempotency = { key: redisKey, fingerprint, database: true };
      return;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {}); client.release();
      request.log.error({ err }, 'Checkout unavailable');
      reply.code(503).send({ error: 'CHECKOUT_TEMPORARILY_UNAVAILABLE', message: 'Checkout is temporarily unavailable. Please retry.' }); return;
    }
  }
  if (useRedis && redis) {
    try {
      let acquired = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await redis.set(redisKey, JSON.stringify(entry), 'EX', 120, 'NX')) { acquired = true; break; }
        const raw = await redis.get(redisKey);
        if (raw) { existing = JSON.parse(raw); break; }
      }
      if (!acquired && !existing) { reply.code(409).send({ error: 'REQUEST_IN_FLIGHT' }); return; }
    } catch {
      reply.code(503).send({ error: 'CHECKOUT_TEMPORARILY_UNAVAILABLE' }); return;
    }
  } else {
    for (const [k, value] of memory) if (value.expiresAt <= Date.now()) memory.delete(k);
    existing = memory.get(redisKey);
    if (!existing) {
      if (memory.size >= 10000) { reply.code(503).send({ error: 'CHECKOUT_BUSY' }); return; }
      memory.set(redisKey, entry);
    }
  }
  if (existing && existing.fingerprint) {
    if (existing.fingerprint !== fingerprint) reply.code(409).send({ error: 'IDEMPOTENCY_CONFLICT' });
    else if (!existing.status) reply.code(409).send({ error: 'REQUEST_IN_FLIGHT' });
    else reply.code(existing.status).send(existing.body);
    return;
  }
  (request as any).idempotency = { key: redisKey, fingerprint, useRedis, owner: entry.owner };
}

export async function saveIdempotentResponse(request: FastifyRequest, reply: FastifyReply, payload: any): Promise<any> {
  const state = (request as any).idempotency;
  if (!state) return payload;

  if (state.database) {
    const client = (request as any).checkoutClient;
    if (!client) return payload;
    try {
      if (reply.statusCode >= 200 && reply.statusCode < 300) {
        await client.query('INSERT INTO checkout_requests(key,fingerprint,status,body) VALUES($1,$2,$3,$4)', [state.key,state.fingerprint,reply.statusCode,payload]);
        await client.query('COMMIT');
      } else await client.query('ROLLBACK');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      request.log.error({ err }, 'Checkout transaction failed');
      reply.code(503);
      return JSON.stringify({ error: 'CHECKOUT_RETRY', message: 'Checkout confirmation unavailable. Retry the same checkout request.' });
    } finally { client.release(); (request as any).checkoutClient = null; }
    return payload;
  }
  const isSuccess = reply.statusCode >= 200 && reply.statusCode < 300;
  if (!isSuccess) {
    // Release key on non-2xx failures so retries re-execute instead of caching errors
    if (state.useRedis && redis) {
      await redis.eval("local v=redis.call('GET',KEYS[1]); if v and cjson.decode(v).owner==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", 1, state.key, state.owner).catch(() => {});
    } else {
      if (memory.get(state.key)?.owner === state.owner) memory.delete(state.key);
    }
    return payload;
  }

  const entry: Entry = {
    owner: state.owner,
    fingerprint: state.fingerprint,
    status: reply.statusCode,
    body: typeof payload === 'string' ? JSON.parse(payload) : payload,
    expiresAt: Date.now() + 86400000,
  };
  if (state.useRedis && redis) {
    await redis.eval("local v=redis.call('GET',KEYS[1]); if v and cjson.decode(v).owner==ARGV[1] then return redis.call('SET',KEYS[1],ARGV[2],'EX',86400) end return 0", 1, state.key, state.owner, JSON.stringify(entry))
      .catch(err => request.log.error({ err }, 'Could not persist checkout response'));
  } else if (memory.get(state.key)?.owner === state.owner) memory.set(state.key, entry);
  return payload;
}
