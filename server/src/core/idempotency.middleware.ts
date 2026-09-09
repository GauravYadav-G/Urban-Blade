import { FastifyRequest, FastifyReply } from 'fastify';
import { redis, isRedisAvailable } from '../redis/client.js';

const memoryIdempotency = new Map<string, { status: number; body: any; expiresAt: number }>();

export interface StoredResponse {
  status: number;
  body: any;
}

/**
 * Amazon-Grade Idempotency Middleware
 * Prevents duplicate orders, double charges, and duplicated bookings during network retries
 */
export async function idempotencyHook(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return;
  }

  const idempotencyKey =
    (request.headers['x-idempotency-key'] as string) ||
    (request.headers['idempotency-key'] as string);

  if (!idempotencyKey) {
    return;
  }

  const redisKey = `idempotency:${idempotencyKey}`;

  // Check if response is already cached
  if (isRedisAvailable() && redis) {
    try {
      const existing = await redis.get(redisKey);
      if (existing) {
        if (existing === 'IN_FLIGHT') {
          reply.status(409).send({
            error: 'REQUEST_IN_FLIGHT',
            message: 'A duplicate request with this idempotency key is currently processing.',
          });
          return;
        }
        const cached: StoredResponse = JSON.parse(existing);
        reply.header('X-Cache-Lookup', 'IDEMPOTENT_HIT');
        reply.status(cached.status).send(cached.body);
        return;
      }

      // Mark request as IN_FLIGHT with 60s expiration
      await redis.set(redisKey, 'IN_FLIGHT', 'EX', 60);
    } catch {
      // Fall through to memory
    }
  } else {
    const cached = memoryIdempotency.get(redisKey);
    if (cached) {
      if (Date.now() < cached.expiresAt) {
        reply.header('X-Cache-Lookup', 'IDEMPOTENT_HIT');
        reply.status(cached.status).send(cached.body);
        return;
      }
      memoryIdempotency.delete(redisKey);
    }
  }

  // Attach key to request so the onSend hook can save the final response
  (request as any).idempotencyKey = redisKey;
}

/**
 * Hook to save response once generated
 */
export async function saveIdempotentResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  payload: any
): Promise<any> {
  const redisKey = (request as any).idempotencyKey;
  if (!redisKey) {
    return payload;
  }

  try {
    const status = reply.statusCode;
    let body = payload;
    try {
      if (typeof payload === 'string') {
        body = JSON.parse(payload);
      }
    } catch {
      body = payload;
    }

    const dataToStore: StoredResponse = { status, body };

    if (isRedisAvailable() && redis) {
      // Keep idempotent response for 24 hours
      await redis.set(redisKey, JSON.stringify(dataToStore), 'EX', 86400);
    } else {
      memoryIdempotency.set(redisKey, {
        status,
        body,
        expiresAt: Date.now() + 86400 * 1000,
      });
    }
  } catch (err) {
    // Non-blocking
  }

  return payload;
}
