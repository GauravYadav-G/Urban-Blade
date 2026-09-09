import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, checkDbHealth } from './pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(): Promise<boolean> {
  console.log('🔄 Checking database connection before running migrations...');
  const health = await checkDbHealth();
  if (!health.ok) {
    console.error('❌ Cannot connect to PostgreSQL at', health.error);
    return false;
  }

  const client = await pool.connect();
  try {
    console.log('🚀 Running schema migration...');
    const schemaSql = fs.readFileSync(path.resolve(__dirname, 'schema.sql'), 'utf-8');
    await client.query(schemaSql);
    console.log('✅ Base schema successfully applied.');

    console.log('🚀 Running index creation (GIN & B-Tree)...');
    const indexesSql = fs.readFileSync(path.resolve(__dirname, 'indexes.sql'), 'utf-8');
    await client.query(indexesSql);
    console.log('✅ High-performance indexes successfully applied.');

    return true;
  } catch (err: any) {
    console.error('❌ Migration failed:', err.message);
    return false;
  } finally {
    client.release();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then((ok) => {
      pool.end();
      process.exit(ok ? 0 : 1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
