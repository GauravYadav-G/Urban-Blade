import { redis, isRedisAvailable } from './client.js';
import crypto from 'crypto';

// Local in-memory lock store fallback
const memoryLocks = new Map<string, { token: string; expiresAt: number }>();

export interface LockResult {
  acquired: boolean;
  lockKey: string;
  lockToken: string;
}

/**
 * Acquire an atomic distributed lock (Redlock pattern)
 * @param resource e.g. "slot:stylistId:date:time" or "stock:productId"
 * @param ttlMs Lock lease duration in milliseconds (default 30,000ms)
 */
export async function acquireLock(resource: string, ttlMs = 30000): Promise<LockResult> {
  const lockKey = `lock:${resource}`;
  const lockToken = crypto.randomUUID();

  if (isRedisAvailable() && redis) {
    try {
      // Atomic SET with NX (not exists) and PX (millisecond TTL)
      const res = await redis.set(lockKey, lockToken, 'PX', ttlMs, 'NX');
      return {
        acquired: res === 'OK',
        lockKey,
        lockToken,
      };
    } catch {
      // Fall through to memory lock
    }
  }

  // Memory fallback lock
  const existing = memoryLocks.get(lockKey);
  const now = Date.now();
  if (existing && existing.expiresAt > now) {
    return { acquired: false, lockKey, lockToken };
  }

  memoryLocks.set(lockKey, { token: lockToken, expiresAt: now + ttlMs });
  return { acquired: true, lockKey, lockToken };
}

/**
 * Release an atomic distributed lock using token verification
 * Ensures that a client only deletes its own lock, never someone else's expired lock
 */
export async function releaseLock(lockKey: string, lockToken: string): Promise<boolean> {
  if (isRedisAvailable() && redis) {
    try {
      // Lua script for atomic check-and-delete
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const res = await redis.eval(luaScript, 1, lockKey, lockToken);
      return res === 1;
    } catch {
      // Fall through
    }
  }

  const existing = memoryLocks.get(lockKey);
  if (existing && existing.token === lockToken) {
    memoryLocks.delete(lockKey);
    return true;
  }
  return false;
}

/**
 * Execute an action with an automatic distributed lock
 */
export async function withLock<T>(
  resource: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const lock = await acquireLock(resource, ttlMs);
  if (!lock.acquired) {
    throw new Error(`RESOURCE_LOCKED: Concurrency collision on ${resource}. Please try again.`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lock.lockKey, lock.lockToken);
  }
}
