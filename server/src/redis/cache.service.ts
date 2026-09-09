import { LRUCache } from 'lru-cache';
import { getCacheKey, setCacheKey, delCacheKey } from './client.js';
import { config } from '../config.js';

// ─── L1 PROCESS CACHE (0MS LATENCY FOR HOTTEST KEYS) ─────────────────────────
const l1Cache = new LRUCache<string, any>({
  max: 1000, // Up to 1,000 hot keys in local process RAM
  ttl: 15 * 1000, // 15 seconds TTL for L1
  allowStale: true,
});

// Single-flight in-progress promise map to prevent cache stampedes
const inFlightPromises = new Map<string, Promise<any>>();

export interface CacheOptions {
  ttlSeconds?: number;
  useL1?: boolean;
}

/**
 * Two-Tier Cache-Aside with Single-Flight Stampede Defense
 * 1. Checks L1 Local Process Memory (0ms)
 * 2. Checks L2 Redis (< 2ms)
 * 3. On miss, coalesces 1,000+ concurrent requests into 1 single DB fetch
 */
export async function getOrSetCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const ttl = options.ttlSeconds || config.cache.defaultTtlSec;
  const useL1 = options.useL1 ?? true;

  // 1. Check L1 Memory Cache
  if (useL1) {
    const l1Hit = l1Cache.get(key);
    if (l1Hit !== undefined) {
      return l1Hit as T;
    }
  }

  // 2. Check L2 Redis Cache
  try {
    const l2Hit = await getCacheKey(key);
    if (l2Hit !== null) {
      const parsed = JSON.parse(l2Hit) as T;
      if (useL1) {
        l1Cache.set(key, parsed);
      }
      return parsed;
    }
  } catch (err) {
    // If cache read fails, proceed to fetcher without crashing
  }

  // 3. Stampede Protection (Single-Flight Pattern)
  // If multiple concurrent requests need this key, only 1 executes the fetcher
  if (inFlightPromises.has(key)) {
    return (await inFlightPromises.get(key)) as T;
  }

  const promise = (async () => {
    try {
      const freshData = await fetcher();
      if (freshData !== undefined && freshData !== null) {
        if (useL1) {
          l1Cache.set(key, freshData);
        }
        await setCacheKey(key, JSON.stringify(freshData), ttl).catch(() => {});
      }
      return freshData;
    } finally {
      inFlightPromises.delete(key);
    }
  })();

  inFlightPromises.set(key, promise);
  return await promise;
}

/**
 * Invalidate a key from both L1 and L2 caches
 */
export async function invalidateCache(key: string): Promise<void> {
  l1Cache.delete(key);
  await delCacheKey(key).catch(() => {});
}

/**
 * Invalidate all catalog-related cache entries
 */
export async function invalidateCatalog(): Promise<void> {
  l1Cache.clear();
  await delCacheKey('catalog:all').catch(() => {});
  await delCacheKey('catalog:deals').catch(() => {});
  await delCacheKey('catalog:bestsellers').catch(() => {});
}
