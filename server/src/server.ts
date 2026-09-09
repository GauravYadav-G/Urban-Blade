import { buildApp } from './app.js';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { redis } from './redis/client.js';

async function start() {
  try {
    const app = await buildApp();

    await app.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   🚀 URBAN BLADE HIGH-PERFORMANCE BACKEND (AMAZON-GRADE)          ║
╠═══════════════════════════════════════════════════════════════════╣
║   API Server:     http://localhost:${config.port}                           ║
║   Interactive API Docs: http://localhost:${config.port}/docs                 ║
║   Health Probe:   http://localhost:${config.port}/api/health                 ║
║   Target Scale:   100,000+ Concurrent Users (P95 < 25ms)         ║
╚═══════════════════════════════════════════════════════════════════╝
    `);

    // Graceful Shutdown
    const closeGracefully = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
      await app.close();
      await pool.end().catch(() => {});
      if (redis) {
        await redis.quit().catch(() => {});
      }
      console.log('✅ Clean shutdown completed.');
      process.exit(0);
    };

    process.on('SIGINT', () => closeGracefully('SIGINT'));
    process.on('SIGTERM', () => closeGracefully('SIGTERM'));
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

start();
