import { pool, checkDbHealth } from '../src/db/pool.js';

async function cleanDemoOrders() {
  console.log('🔄 Checking database connection before cleaning orders...');
  const health = await checkDbHealth();
  if (!health.ok) {
    console.error('❌ Cannot connect to PostgreSQL:', health.error);
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get current counts
    const orderCountRes = await client.query('SELECT count(*)::int as count FROM orders');
    const orderItemCountRes = await client.query('SELECT count(*)::int as count FROM order_items');

    const totalOrders = orderCountRes.rows[0].count;
    const totalOrderItems = orderItemCountRes.rows[0].count;

    console.log(`📊 Found ${totalOrders} orders and ${totalOrderItems} order items currently in database.`);

    if (totalOrders === 0 && totalOrderItems === 0) {
      console.log('✅ Orders table is already clean (0 orders).');
      await client.query('COMMIT');
      return;
    }

    // 2. Delete order_items first
    const delItemsRes = await client.query('DELETE FROM order_items');
    console.log(`🗑️ Deleted ${delItemsRes.rowCount} records from order_items.`);

    // 3. Delete orders
    const delOrdersRes = await client.query('DELETE FROM orders');
    console.log(`🗑️ Deleted ${delOrdersRes.rowCount} records from orders.`);

    await client.query('COMMIT');

    // 4. Verify post-cleanup counts
    const verifyOrders = await client.query('SELECT count(*)::int as count FROM orders');
    const verifyItems = await client.query('SELECT count(*)::int as count FROM order_items');

    console.log(`✨ Cleanup verified:`);
    console.log(`   - Orders remaining: ${verifyOrders.rows[0].count}`);
    console.log(`   - Order items remaining: ${verifyItems.rows[0].count}`);
    console.log('🎉 Successfully purged all demo orders from database.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to clean orders:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

cleanDemoOrders();
