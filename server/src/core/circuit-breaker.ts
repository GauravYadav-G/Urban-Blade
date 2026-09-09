import { config } from '../config.js';

let eventLoopLagMs = 0;
let lastCheck = performance.now();

// Measure event loop delay every 500ms
setInterval(() => {
  const now = performance.now();
  const delta = now - lastCheck;
  eventLoopLagMs = Math.max(0, Math.round(delta - 500));
  lastCheck = now;
}, 500).unref();

export function getEventLoopLag(): number {
  return eventLoopLagMs;
}

export function getMemoryUsage() {
  const mem = process.memoryUsage();
  return {
    rssMb: Math.round(mem.rss / 1024 / 1024),
    heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
    externalMb: Math.round(mem.external / 1024 / 1024),
  };
}

/**
 * Timeout Hedging Helper
 * Executes a function with a strict timeout; if it exceeds timeoutMs,
 * returns the fallback value immediately instead of hanging the HTTP client.
 */
export async function withTimeoutHedging<T>(
  action: () => Promise<T>,
  fallback: () => Promise<T> | T,
  timeoutMs = 150
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(async () => {
      try {
        const fallbackValue = await fallback();
        resolve(fallbackValue);
      } catch {
        resolve(undefined as any);
      }
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([action(), timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch (err) {
    clearTimeout(timer!);
    return await fallback();
  }
}
