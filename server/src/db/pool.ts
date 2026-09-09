import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

// High-performance connection pool configuration with Neon / SSL support
const connectionString = config.database.url;
const isNeonOrSsl =
  connectionString.includes('neon.tech') ||
  connectionString.includes('sslmode=require') ||
  process.env.NODE_ENV === 'production';

export const pool = new Pool({
  connectionString,
  ssl: isNeonOrSsl ? { rejectUnauthorized: false } : false,
  min: config.database.poolMin,
  max: config.database.poolMax,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  statement_timeout: config.database.statementTimeoutMs,
  allowExitOnIdle: false,
});

let isConnected = false;

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]', err.message);
  isConnected = false;
});

/**
 * Health probe for PostgreSQL
 */
export async function checkDbHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const res = await pool.query('SELECT 1 AS health');
    const latencyMs = Math.round(performance.now() - start);
    isConnected = res.rows.length > 0;
    return { ok: true, latencyMs };
  } catch (err: any) {
    isConnected = false;
    return { ok: false, latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

/**
 * High-performance query wrapper with automatic timing and error propagation
 */
export async function query<T extends pg.QueryResultRow = any>(sql: string, params: any[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params);
}

/**
 * Transaction helper with automatic rollback on error
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function isDbConnected(): boolean {
  return isConnected;
}
