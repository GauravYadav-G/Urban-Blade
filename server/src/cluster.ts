import cluster from 'cluster';
import os from 'os';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║   ⚡ URBAN BLADE HIGH-CONCURRENCY CLUSTER MANAGER                  ║
╠═══════════════════════════════════════════════════════════════════╣
║   Primary PID:    ${process.pid}                                          ║
║   CPU Cores:      ${numCPUs} Workers Spawning                            ║
║   Throughput:     Targeting 60,000+ Requests/Sec Across Cores    ║
╚═══════════════════════════════════════════════════════════════════╝
  `);

  // Fork workers matching CPU count
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`⚠️ Worker ${worker.process.pid} died (${signal || code}). Auto-restarting...`);
    cluster.fork();
  });
} else {
  // Workers execute server.ts
  import('./server.js');
}
