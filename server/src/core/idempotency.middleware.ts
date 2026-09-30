import { createHash } from 'node:crypto';
import { FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.middleware.js';
import { config } from '../config.js';
import { redis, isRedisAvailable } from '../redis/client.js';

type Entry = { fingerprint: string; status?: number; body?: unknown; expiresAt: number };
const memory = new Map<string, Entry>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export async function idempotencyHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) return;
  // Restrict caching to authenticated checkout creation, never login/token responses.
  if (!['/api/orders/cod-order', '/api/orders/razorpay/create-order'].includes(request.url.split('?')[0])) return;
  const key = request.headers['x-idempotency-key'] || request.headers['idempotency-key'];
  if (!key) return;
  if (typeof key !== 'string' || key.length > 100 || !/^[\w-]+$/.test(key)) {
    reply.code(400).send({ error: 'INVALID_IDEMPOTENCY_KEY' }); return;
  }
  await requireAuth(request, reply);
  if (reply.sent) return;
  const redisKey = `idempotency:${hash(`${request.headers.authorization}:${request.method}:${request.url}:${key}`)}`;
  const fingerprint = hash(JSON.stringify(request.body));
  const entry: Entry = { fingerprint, expiresAt: Date.now() + 120000 };
  let existing: Entry | undefined;
  const useRedis = isRedisAvailable() && !!redis;
  if (config.isProduction && !useRedis) { reply.code(503).send({ error: 'CHECKOUT_TEMPORARILY_UNAVAILABLE' }); return; }
  if (useRedis && redis) {
    try {
      const acquired = await redis.set(redisKey, JSON.stringify(entry), 'EX', 120, 'NX');
      if (!acquired) {
        const raw = await redis.get(redisKey);
        if (raw) {
          try {
            existing = JSON.parse(raw);
          } catch {
            existing = undefined;
          }
        }
        if (!existing) {
          await redis.set(redisKey, JSON.stringify(entry), 'EX', 120);
        }
      }
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
  (request as any).idempotency = { key: redisKey, fingerprint, useRedis };
}

export async function saveIdempotentResponse(request: FastifyRequest, reply: FastifyReply, payload: any): Promise<any> {
  const state = (request as any).idempotency;
  if (!state) return payload;

  const isSuccess = reply.statusCode >= 200 && reply.statusCode < 300;
  if (!isSuccess) {
    // Release key on non-2xx failures so retries re-execute instead of caching errors
    if (state.useRedis && redis) {
      await redis.del(state.key).catch(() => {});
    } else {
      memory.delete(state.key);
    }
    return payload;
  }

  const entry: Entry = {
    fingerprint: state.fingerprint,
    status: reply.statusCode,
    body: typeof payload === 'string' ? JSON.parse(payload) : payload,
    expiresAt: Date.now() + 86400000,
  };
  if (state.useRedis && redis) await redis.set(state.key, JSON.stringify(entry), 'EX', 86400);
  else memory.set(state.key, entry);
  return payload;
}
