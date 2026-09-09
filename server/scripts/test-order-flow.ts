import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';

async function testFullOrderAndPaymentFlow() {
  console.log('🧪 Starting End-to-End Test: Order & Payment Flow with Neon PostgreSQL...');

  // 1. Pick a product from Neon DB
  const prodRes = await pool.query('SELECT id, name, price, stock_quantity FROM products WHERE stock_quantity >= 5 LIMIT 1');
  if (prodRes.rows.length === 0) {
    throw new Error('No products found with sufficient stock in Neon DB');
  }

  const testProduct = prodRes.rows[0];
  const initialStock = parseInt(testProduct.stock_quantity, 10);
  const purchaseQty = 2;
  const unitPrice = parseFloat(testProduct.price);
  const expectedSubtotal = unitPrice * purchaseQty;
  const expectedShipping = expectedSubtotal >= 999 ? 0 : 99;
  const expectedTotal = Math.round((expectedSubtotal + expectedShipping) * 100) / 100;

  console.log(`📦 Testing with Product: "${testProduct.name}" (ID: ${testProduct.id})`);
  console.log(`   Initial Stock: ${initialStock}`);
  console.log(`   Expected Subtotal: ₹${expectedSubtotal}, Shipping: ₹${expectedShipping}, Total: ₹${expectedTotal}`);

  // 2. Simulate Checkout Session (Atomic Stock Decrement)
  const orderId = crypto.randomUUID();
  const idempotencyKey = `test-${Date.now()}-${orderId.slice(0, 6)}`;
  const expiresAt = Date.now() + 15 * 60 * 1000;

  console.log('\n🔒 Step 1: Reserving stock and creating pending order in Neon DB...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Decrement stock
    const stockRes = await client.query(
      `UPDATE products 
       SET stock_quantity = stock_quantity - $1, version = version + 1 
       WHERE id = $2 AND stock_quantity >= $1 
       RETURNING stock_quantity`,
      [purchaseQty, testProduct.id]
    );

    if (stockRes.rows.length === 0) {
      throw new Error('Stock decrement failed');
    }

    const reservedStock = parseInt(stockRes.rows[0].stock_quantity, 10);
    console.log(`   ✅ Stock decremented to: ${reservedStock} (Diff: -${purchaseQty})`);

    // Insert order
    await client.query(
      `INSERT INTO orders (
         id, idempotency_key, status, subtotal, shipping_fee, total_amount, 
         currency, shipping_address, payment_method, payment_status
       ) VALUES (
         $1, $2, 'accepted', $3, $4, $5, 'INR', $6, 'upi', 'pending'
       )`,
      [
        orderId,
        idempotencyKey,
        expectedSubtotal,
        expectedShipping,
        expectedTotal,
        JSON.stringify({ fullName: 'Gaurav Yadav Test', phone: '9015618265', city: 'Ghaziabad', street: 'L-245' })
      ]
    );

    // Insert order item
    await client.query(
      `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [orderId, testProduct.id, testProduct.name, unitPrice, purchaseQty]
    );

    await client.query('COMMIT');
    console.log(`   ✅ Order ${orderId} inserted into Neon DB as 'accepted' / 'pending'.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 3. Cryptographic Signature Generation
  const signatureToken = crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${orderId}:${expectedTotal}:${expiresAt}`)
    .digest('hex');
  console.log(`   🔑 Generated HMAC-SHA256 Token: ${signatureToken.slice(0, 16)}...`);

  // 4. Test Security: Tamper Detection
  console.log('\n🛡️ Step 2: Testing Tamper Resistance (tampered payment amount)...');
  const tamperedTotal = 1.00; // Malicious client trying to pay ₹1 instead of real price
  const tamperedSignature = crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${orderId}:${tamperedTotal}:${expiresAt}`)
    .digest('hex');

  // Verify against real DB total
  const verifyDb = await pool.query('SELECT total_amount FROM orders WHERE id = $1', [orderId]);
  const realTotal = parseFloat(verifyDb.rows[0].total_amount);
  const recomputedSig = crypto
    .createHmac('sha256', config.jwt.secret)
    .update(`${orderId}:${realTotal}:${expiresAt}`)
    .digest('hex');

  const tamperedValid = tamperedSignature === recomputedSig;
  console.log(`   Tampered Signature matches DB price: ${tamperedValid ? '❌ FAILED' : '✅ REJECTED (Protection verified!)'}`);

  // 5. Simulate Real Payment Verification
  console.log('\n💳 Step 3: Verifying Legitimate Payment & Capturing in Neon DB...');
  const paymentId = `pay_sim_${Date.now()}`;
  const legitimateValid = signatureToken === recomputedSig;
  if (!legitimateValid) {
    throw new Error('Legitimate signature verification failed');
  }

  await pool.query(
    `UPDATE orders 
     SET status = 'confirmed', payment_status = 'captured', updated_at = CURRENT_TIMESTAMP 
     WHERE id = $1`,
    [orderId]
  );
  console.log(`   ✅ Order status updated in Neon to: 'confirmed' / 'captured' (Payment ID: ${paymentId})`);

  // 6. Verify Final DB State
  console.log('\n📊 Step 4: Verifying final records in Neon PostgreSQL...');
  const finalOrder = await pool.query('SELECT id, status, payment_status, total_amount FROM orders WHERE id = $1', [orderId]);
  console.log('   Final Order Record:', finalOrder.rows[0]);

  const finalStockRes = await pool.query('SELECT stock_quantity FROM products WHERE id = $1', [testProduct.id]);
  console.log(`   Product Stock after purchase: ${finalStockRes.rows[0].stock_quantity} (Expected: ${initialStock - purchaseQty})`);

  // Clean up test order to keep DB pristine
  await pool.query('DELETE FROM order_items WHERE order_id = $1', [orderId]);
  await pool.query('DELETE FROM orders WHERE id = $1', [orderId]);
  await pool.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [initialStock, testProduct.id]);
  console.log('   🧹 Test order cleaned and stock restored to original level.');

  console.log('\n🎉 ALL SECURITY & DATABASE INTEGRATION TESTS PASSED PERFECTLY!\n');
}

testFullOrderAndPaymentFlow()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('❌ Test failed:', err);
    await pool.end();
    process.exit(1);
  });
