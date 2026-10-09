import { buildApp } from '../src/app.js';
import { query, pool } from '../src/db/pool.js';
import type { FastifyInstance } from 'fastify';

async function main() {
  console.log('Testing Stock Depletion and Restock Flow...');
  const app: FastifyInstance = await buildApp();
  await app.ready();

  const adminToken = app.jwt.sign({
    id: 'cf32923e-e498-407c-93d5-8d8cef913979',
    email: 'admin@urbanblade.in',
    role: 'admin',
    name: 'Master Admin',
  });

  const adminHeaders = {
    authorization: `Bearer ${adminToken}`,
    'content-type': 'application/json',
  };

  // Pick a product to test
  const listRes = await app.inject({
    method: 'GET',
    url: '/api/products?limit=5',
  });
  const listData = JSON.parse(listRes.body);
  const testProd = listData.data[0];
  console.log(`Initial product: "${testProd.name}" (id: ${testProd.id}, slug: ${testProd.slug}, stock: ${testProd.stock_quantity ?? testProd.stockQuantity}, inStock: ${testProd.inStock})`);
  const initialStock = Number(testProd.stock_quantity ?? testProd.stockQuantity ?? 100);

  try {
    // TEST 1: Admin updates stock to 0 (out of stock)
    console.log('\n--- STEP 1: Setting stock to 0 (Out of stock) via Admin API ---');
    const update0 = await app.inject({
      method: 'PUT',
      url: `/api/admin/products/${testProd.id}`,
      headers: adminHeaders,
      payload: { stockQuantity: 0 },
    });
    console.log(`Admin update status: ${update0.statusCode}`);
    if (update0.statusCode !== 200) throw new Error(`Admin update failed: ${update0.body}`);
    const prod0 = JSON.parse(update0.body);
    console.log(`Admin update response: stock = ${prod0.stockQuantity ?? prod0.stock_quantity}, inStock = ${prod0.inStock ?? prod0.in_stock}`);
    if ((prod0.stockQuantity ?? prod0.stock_quantity) !== 0 || (prod0.inStock ?? prod0.in_stock) !== false) {
      throw new Error(`Expected stock 0 and inStock false, got: ${JSON.stringify(prod0)}`);
    }

    // Verify Public API GET /products/:id immediately sees out of stock
    const get0 = await app.inject({
      method: 'GET',
      url: `/api/products/${testProd.id}?t=${Date.now()}`,
    });
    const publicProd0 = JSON.parse(get0.body);
    console.log(`Public API GET /products/:id: stock = ${publicProd0.stockQuantity ?? publicProd0.stock_quantity}, inStock = ${publicProd0.inStock ?? publicProd0.in_stock}`);
    if ((publicProd0.inStock ?? publicProd0.in_stock) !== false) {
      throw new Error(`Public API did not reflect out of stock!`);
    }

    // TEST 2: Admin restocks to 25
    console.log('\n--- STEP 2: Restocking product (setting stock = 25) via Admin API ---');
    const update25 = await app.inject({
      method: 'PUT',
      url: `/api/admin/products/${testProd.id}`,
      headers: adminHeaders,
      payload: { stockQuantity: 25 },
    });
    console.log(`Admin update status: ${update25.statusCode}`);
    const prod25 = JSON.parse(update25.body);
    console.log(`Admin update response: stock = ${prod25.stockQuantity ?? prod25.stock_quantity}, inStock = ${prod25.inStock ?? prod25.in_stock}`);
    if ((prod25.stockQuantity ?? prod25.stock_quantity) !== 25 || (prod25.inStock ?? prod25.in_stock) !== true) {
      throw new Error(`Expected stock 25 and inStock true!`);
    }

    // Verify Public API GET /products/:id immediately sees in stock
    const get25 = await app.inject({
      method: 'GET',
      url: `/api/products/${testProd.id}?t=${Date.now()}`,
    });
    const publicProd25 = JSON.parse(get25.body);
    console.log(`Public API GET /products/:id after restock: stock = ${publicProd25.stockQuantity ?? publicProd25.stock_quantity}, inStock = ${publicProd25.inStock ?? publicProd25.in_stock}`);
    if ((publicProd25.inStock ?? publicProd25.in_stock) !== true || (publicProd25.stockQuantity ?? publicProd25.stock_quantity) !== 25) {
      throw new Error(`Public API did not reflect restock!`);
    }

    // TEST 3: Direct Manual Neon DB Update (simulating manual edit in Neon Console)
    console.log('\n--- STEP 3: Simulating Manual Direct Neon DB Edit (UPDATE products SET stock_quantity = 77, in_stock = true) ---');
    await query('UPDATE products SET stock_quantity = 77, in_stock = true, updated_at = NOW() WHERE id = (SELECT id FROM products WHERE id::text = $1 OR slug = $1 LIMIT 1)', [testProd.id]);

    // Live query via GET /api/products/:id?t=...
    const getManual = await app.inject({
      method: 'GET',
      url: `/api/products/${testProd.id}?t=${Date.now()}`,
    });
    const manualProd = JSON.parse(getManual.body);
    console.log(`Public API GET with timestamp after direct DB edit: stock = ${manualProd.stockQuantity ?? manualProd.stock_quantity}, inStock = ${manualProd.inStock}`);
    if ((manualProd.stockQuantity ?? manualProd.stock_quantity) !== 77 || manualProd.inStock !== true) {
      throw new Error(`Public API did not reflect direct DB edit! Got: ${JSON.stringify(manualProd)}`);
    }

    // TEST 4: Public PUT /products/:id fallback endpoint
    console.log('\n--- STEP 4: Testing Public Endpoint PUT /api/products/:id fallback ---');
    const updatePub = await app.inject({
      method: 'PUT',
      url: `/api/products/${testProd.id}`,
      payload: { stockQuantity: 50 },
    });
    console.log(`Public PUT status: ${updatePub.statusCode}`);
    if (updatePub.statusCode !== 200) throw new Error(`Public PUT failed: ${updatePub.body}`);
    const prodPub = JSON.parse(updatePub.body);
    console.log(`Public PUT response: stock = ${prodPub.stockQuantity ?? prodPub.stock_quantity}, inStock = ${prodPub.inStock}`);
    if ((prodPub.stockQuantity ?? prodPub.stock_quantity) !== 50 || prodPub.inStock !== true) {
      throw new Error(`Public PUT failed to set stock 50!`);
    }

    // STEP 5: Restore initial stock
    console.log('\n--- STEP 5: Restoring original stock ---');
    await app.inject({
      method: 'PUT',
      url: `/api/admin/products/${testProd.id}`,
      headers: adminHeaders,
      payload: { stockQuantity: initialStock },
    });
    console.log(`Original stock restored: ${initialStock}`);

    console.log('\n✅ All stock, restock, manual DB sync, and fallback tests passed with 100% success!');
  } finally {
    await app.close();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
