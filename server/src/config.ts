import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from server root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DEFAULT_CORS_ORIGINS = 'https://www.urbanblade.shop,https://urbanblade.shop,https://www.urbanblade.in,https://urbanblade.in,http://localhost:4200';

if (process.env.NODE_ENV === 'production') {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
}

const DEV_FALLBACK_JWT_SECRET = 'urbanblade-dev-jwt-secret-do-not-use-in-prod-32chars!';

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  corsOrigins: (process.env.CORS_ORIGINS || DEFAULT_CORS_ORIGINS)
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),

  jwt: {
    secret: process.env.JWT_SECRET || DEV_FALLBACK_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
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
    maxEventLoopDelayMs: parseInt(process.env.MAX_EVENT_LOOP_DELAY_MS || '2500', 10),
    maxHeapUsedBytes: parseInt(process.env.MAX_HEAP_USED_BYTES || '1073741824', 10), // 1GB
  },

  cache: {
    defaultTtlSec: parseInt(process.env.CACHE_TTL_DEFAULT_SEC || '300', 10),
    hotTtlSec: parseInt(process.env.CACHE_TTL_HOT_SEC || '60', 10),
  },

  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
  },

  // Separate secret for payment HMAC signatures (distinct from JWT secret)
  payment: {
    signingSecret: process.env.PAYMENT_SIGNING_SECRET || process.env.RAZORPAY_KEY_SECRET || '',
  },
};
