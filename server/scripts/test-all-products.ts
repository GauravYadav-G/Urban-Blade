import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/db/pool.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testAll() {
  const seedRaw = fs.readFileSync(path.resolve(__dirname, '../src/db/products.seed.json'), 'utf-8');
  const seedProducts = JSON.parse(seedRaw);
  console.log(`Checking all ${seedProducts.length} products with the checkout lookup logic...`);

  let failures = 0;
  for (const p of seedProducts) {
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.id);
    const cleanSlug = p.id.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');
    const slugCandidate = p.slug || cleanSlug;
    const prodRes = await pool.query(
      `SELECT id, name, price, stock_quantity, in_stock FROM products WHERE ${
        isUUID
          ? 'id = $1'
          : 'slug = $1 OR slug = $2 OR slug = $3 OR id::text = $1 OR name ILIKE $2'
      } LIMIT 1`,
      isUUID ? [p.id] : [p.id, cleanSlug, slugCandidate]
    );

    if (prodRes.rows.length === 0) {
      console.error(`❌ FAILED TO FIND: id="${p.id}", slug="${p.slug}", cleanSlug="${cleanSlug}"`);
      failures++;
    }
  }

  if (failures === 0) {
    console.log(`✅ All ${seedProducts.length} products resolved successfully!`);
  } else {
    console.error(`❌ ${failures} products failed to resolve!`);
  }
  await pool.end();
}

testAll().catch(console.error);
