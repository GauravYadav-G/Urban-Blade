import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',

  jwt: {
    secret: process.env.JWT_SECRET || 'urbanblade-super-secret-jwt-key-change-in-prod',
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  },

  database: {
    url: process.env.DATABASE_URL || 'postgres://urbanblade:urbanblade_secret@localhost:5432/urbanblade_db',
    poolMin: parseInt(process.env.DATABASE_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DATABASE_POOL_MAX || '30', 10),
    statementTimeoutMs: parseInt(process.env.DATABASE_STATEMENT_TIMEOUT_MS || '5000', 10),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    maxRetries: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
  },

  limits: {
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '5000', 10),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxEventLoopDelayMs: parseInt(process.env.MAX_EVENT_LOOP_DELAY_MS || '100', 10),
    maxHeapUsedBytes: parseInt(process.env.MAX_HEAP_USED_BYTES || '1073741824', 10), // 1GB
  },

  cache: {
    defaultTtlSec: parseInt(process.env.CACHE_TTL_DEFAULT_SEC || '300', 10),
    hotTtlSec: parseInt(process.env.CACHE_TTL_HOT_SEC || '60', 10),
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_TZtC5tBbAEEppP',
    keySecret: process.env.RAZORPAY_KEY_SECRET || 'bSQij93encYPYkJK6yLzy8xm',
  },
};
