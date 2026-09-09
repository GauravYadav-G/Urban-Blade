import { Redis } from 'ioredis';
import { config } from '../config.js';

let isRedisConnected = false;
let redisInstance: Redis | null = null;

// In-memory fallback map if Redis is temporarily unreachable
const fallbackStore = new Map<string, { value: string; expiresAt: number }>();

function createRedisClient(): Redis {
  const client = new Redis(config.redis.url, {
    maxRetriesPerRequest: 1,
    retryStrategy(times: number) {
      if (times > config.redis.maxRetries) {
        return null; // Stop retrying immediately and fall back to in-memory mode
      }
      return Math.min(times * 100, 2000);
    },
    enableReadyCheck: true,
    lazyConnect: true,
  });

  client.on('connect', () => {
    isRedisConnected = true;
    console.log('⚡ Connected to Redis 7.2 Cache Cluster.');
  });

  client.on('error', (err: any) => {
    if (isRedisConnected) {
      console.warn('⚠️ [Redis Warning]', err.message);
    }
    isRedisConnected = false;
  });

  client.on('close', () => {
    isRedisConnected = false;
  });

  return client;
}

redisInstance = createRedisClient();

// Attempt non-blocking connect
redisInstance.connect().catch(() => {
  console.log('ℹ️ Redis not detected on localhost:6379 - running with high-speed In-Memory Cache Fallback.');
});

export const redis = redisInstance;

export function isRedisAvailable(): boolean {
  return isRedisConnected;
}

/**
 * Health check probe for Redis
 */
export async function checkRedisHealth(): Promise<{ ok: boolean; latencyMs: number; mode: 'redis' | 'memory-fallback'; error?: string }> {
  const start = performance.now();
  if (isRedisConnected && redisInstance) {
    try {
      const pong = await redisInstance.ping();
      const latencyMs = Math.round(performance.now() - start);
      return { ok: pong === 'PONG', latencyMs, mode: 'redis' };
    } catch (err: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - start), mode: 'memory-fallback', error: err.message };
    }
  }
  return { ok: true, latencyMs: 0, mode: 'memory-fallback' };
}

/**
 * Resilient Key-Value getter (Redis or In-Memory fallback)
 */
export async function getCacheKey(key: string): Promise<string | null> {
  if (isRedisConnected && redisInstance) {
    try {
      return await redisInstance.get(key);
    } catch {
      // Fall through to memory store
    }
  }
  const item = fallbackStore.get(key);
  if (item) {
    if (Date.now() > item.expiresAt) {
      fallbackStore.delete(key);
      return null;
    }
    return item.value;
  }
  return null;
}

/**
 * Resilient Key-Value setter with TTL (Redis or In-Memory fallback)
 */
export async function setCacheKey(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (isRedisConnected && redisInstance) {
    try {
      await redisInstance.set(key, value, 'EX', ttlSeconds);
      return;
    } catch {
      // Fall through
    }
  }
  fallbackStore.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

/**
 * Resilient Key deleter
 */
export async function delCacheKey(key: string): Promise<void> {
  if (isRedisConnected && redisInstance) {
    try {
      await redisInstance.del(key);
      return;
    } catch {
      // Fall through
    }
  }
  fallbackStore.delete(key);
}
