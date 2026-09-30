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
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(184728391)');
    console.log('🚀 Running schema migration...');
    const schemaCandidatePaths = [
      path.resolve(__dirname, 'schema.sql'),
      path.resolve(__dirname, '../../src/db/schema.sql'),
      path.resolve(process.cwd(), 'src/db/schema.sql'),
      path.resolve(process.cwd(), 'dist/db/schema.sql'),
    ];
    const resolvedSchema = schemaCandidatePaths.find((p) => fs.existsSync(p)) || schemaCandidatePaths[0];
    const schemaSql = fs.readFileSync(resolvedSchema, 'utf-8');
    await client.query(schemaSql);
    console.log('✅ Base schema successfully applied.');

    console.log('🚀 Running index creation (GIN & B-Tree)...');
    const indexCandidatePaths = [
      path.resolve(__dirname, 'indexes.sql'),
      path.resolve(__dirname, '../../src/db/indexes.sql'),
      path.resolve(process.cwd(), 'src/db/indexes.sql'),
      path.resolve(process.cwd(), 'dist/db/indexes.sql'),
    ];
    const resolvedIndexes = indexCandidatePaths.find((p) => fs.existsSync(p)) || indexCandidatePaths[0];
    const indexesSql = fs.readFileSync(resolvedIndexes, 'utf-8');
    await client.query(indexesSql);
    console.log('✅ High-performance indexes successfully applied.');

    await client.query('COMMIT');
    return true;
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
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
