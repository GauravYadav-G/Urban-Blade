import { FastifyInstance } from 'fastify';
import { checkDbHealth } from '../../db/pool.js';
import { checkRedisHealth } from '../../redis/client.js';
import { getEventLoopLag, getMemoryUsage } from '../../core/circuit-breaker.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (request, reply) => {
    const dbHealth = await checkDbHealth();
    const redisHealth = await checkRedisHealth();
    const eventLoopLagMs = getEventLoopLag();
    const memory = getMemoryUsage();

    const isHealthy = eventLoopLagMs < 200;

    const payload = {
      status: isHealthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      system: {
        eventLoopLagMs,
        memory,
      },
      services: {
        postgres: dbHealth,
        redis: redisHealth,
      },
      tier: 'Amazon-Grade 100k Concurrent Target',
    };

    reply.status(isHealthy ? 200 : 503).send(payload);
  });

  app.get('/health/live', async () => ({ status: 'alive' }));

  app.get('/health/ready', async (request, reply) => {
    const db = await checkDbHealth();
    if (!db.ok) {
      reply.status(503).send({ status: 'not_ready', reason: 'database_unavailable' });
      return;
    }
    reply.status(200).send({ status: 'ready' });
  });
}
