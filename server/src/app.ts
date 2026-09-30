import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import underPressure from '@fastify/under-pressure';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { config } from './config.js';
import { idempotencyHook, saveIdempotentResponse } from './core/idempotency.middleware.js';
import { initializeOrderQueue } from './queue/order-saga.queue.js';
import { startAbandonedCheckoutReaper } from './modules/orders/abandoned-checkout.reaper.js';

// Route modules
import { healthRoutes } from './modules/health/health.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { productsRoutes } from './modules/products/products.routes.js';
import { cartRoutes } from './modules/cart/cart.routes.js';
import { bookingsRoutes } from './modules/bookings/bookings.routes.js';
import { paymentWebhookRoutes } from './modules/orders/payment-webhook.routes.js';
import { ordersRoutes } from './modules/orders/orders.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { supportRoutes } from './modules/support/support.routes.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = fastify({
    logger: {
      level: config.isProduction ? 'warn' : config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie'],
    },
    connectionTimeout: 10000,
    keepAliveTimeout: 5000,
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (!reply.getHeader('Cache-Control') && !reply.getHeader('cache-control')) {
      reply.header('Cache-Control', 'no-store');
    }
    if (config.isProduction) reply.header('Strict-Transport-Security', 'max-age=31536000');
    return payload;
  });

  // ─── 1. LOAD SHEDDING & EVENT LOOP CIRCUIT BREAKER (ZERO-CRASH GUARD) ──────
  await app.register(underPressure, {
    maxEventLoopDelay: config.limits.maxEventLoopDelayMs,
    maxHeapUsedBytes: config.limits.maxHeapUsedBytes,
    maxRssBytes: config.limits.maxHeapUsedBytes * 1.5,
    pressureHandler: (req, rep, type, value) => {
      // Never shed health check probes or root welcome checks
      const path = req.url || '';
      if (path === '/' || path.startsWith('/api/health')) {
        return;
      }
      req.log.warn({ type, value }, '⚠️ System under severe pressure - shedding load');
      rep.header('Retry-After', 2);
      rep.status(503).send({
        error: 'SERVICE_UNDER_PRESSURE',
        message: 'System is experiencing extreme peak load. Retrying in 2 seconds...',
      });
    },
  });

  // ─── 2. CORS & HIGH-CONCURRENCY RATE LIMITING ──────────────────────────────
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: config.limits.rateLimitMax,
    timeWindow: config.limits.rateLimitWindowMs,
  });

  // ─── 3. JWT AUTHENTICATION ────────────────────────────────────────────────
  await app.register(jwt, {
    secret: config.jwt.secret,
  });

  // ─── 4. SWAGGER / OPENAPI DOCUMENTATION ───────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Urban Blade High-Performance API',
        description: 'Amazon-Grade 100,000+ Concurrent Scalable Salon & Retail Platform',
        version: '1.0.0',
      },
      servers: [{ url: `http://localhost:${config.port}` }],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  // ─── 5. IDEMPOTENCY HOOKS (ZERO DUPLICATE MUTATIONS) ──────────────────────
  app.addHook('preHandler', idempotencyHook);
  app.addHook('onSend', saveIdempotentResponse);

  // ─── 6. REGISTER API ROUTE MODULES ────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(authRoutes, { prefix: '/api' });
  await app.register(productsRoutes, { prefix: '/api' });
  await app.register(cartRoutes, { prefix: '/api' });
  await app.register(bookingsRoutes, { prefix: '/api' });
  await app.register(ordersRoutes, { prefix: '/api' });
  await app.register(paymentWebhookRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(supportRoutes, { prefix: '/api' });

  // ─── 7. INITIALIZE BACKGROUND SAGA QUEUES & CLEANUP TASKS ─────────────────
  initializeOrderQueue();
  startAbandonedCheckoutReaper();


  // Root welcome route
  app.get('/', async () => ({
    name: 'Urban Blade High-Performance API',
    tier: 'Amazon-Grade Scalable Architecture',
    docs: '/docs',
    health: '/api/health',
    status: 'online',
  }));

  return app;
}
