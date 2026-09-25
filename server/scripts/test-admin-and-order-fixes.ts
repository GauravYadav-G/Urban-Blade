import { buildApp } from '../src/app.js';
import { query, pool } from '../src/db/pool.js';
import type { FastifyInstance } from 'fastify';

async function runAdminAndOrderFixesTest() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  🧪 VERIFICATION: ADMIN PANEL & ORDER PIPELINE PRODUCTION AUDIT   ');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const app: FastifyInstance = await buildApp();
  let createdOrderId: string | null = null;
  let createdBookingId: string | null = null;
  let testProductId: string | null = null;
  let originalStock: number = 100;

  try {
    // 1. Test Admin Cache Flush
    console.log('⚡ 1. Testing Admin Cache Flush (POST /api/admin/cache/flush)...');
    const flushRes = await app.inject({
      method: 'POST',
      url: '/api/admin/cache/flush',
    });
    console.log(`   Response status: ${flushRes.statusCode}`);
    if (flushRes.statusCode !== 200) {
      throw new Error(`Cache flush failed: ${flushRes.statusCode} ${flushRes.body}`);
    }
    const flushData = JSON.parse(flushRes.body);
    if (!flushData.ok) {
      throw new Error(`Cache flush ok was not true: ${flushRes.body}`);
    }
    console.log(`   ✅ Cache flushed successfully: "${flushData.message}"\n`);

    // 2. Test Admin Products Retrieval & Dual Casing
    console.log('📦 2. Testing Admin Products Dual-Casing (GET /api/admin/products)...');
    const productsRes = await app.inject({
      method: 'GET',
      url: '/api/admin/products',
    });
    if (productsRes.statusCode !== 200) {
      throw new Error(`Failed to fetch admin products: ${productsRes.statusCode}`);
    }
    const productsData = JSON.parse(productsRes.body);
    const productsList = productsData.data || productsData;
    if (!Array.isArray(productsList) || productsList.length === 0) {
      throw new Error('No products returned from /api/admin/products');
    }
    const firstProd = productsList[0];
    testProductId = firstProd.id;
    originalStock = firstProd.stock_quantity ?? firstProd.stockQuantity ?? 100;

    console.log(`   Discovered ${productsList.length} products. Sampling "${firstProd.name}" (ID: ${firstProd.id}):`);
    console.log(`     - stockQuantity: ${firstProd.stockQuantity}`);
    console.log(`     - stock_quantity: ${firstProd.stock_quantity}`);
    console.log(`     - imageUrl: ${firstProd.imageUrl?.slice(0, 35)}...`);
    console.log(`     - image_url: ${firstProd.image_url?.slice(0, 35)}...`);

    if (firstProd.stockQuantity === undefined || firstProd.stock_quantity === undefined) {
      throw new Error('Dual-casing failure: stockQuantity or stock_quantity is undefined');
    }
    console.log('   ✅ Products route returns dual camelCase & snake_case properties.\n');

    // 3. Test Admin Product Update with camelCase payload
    console.log('🔄 3. Testing Product Update with camelCase payload (PUT /api/admin/products/:id)...');
    const targetStock = 87;
    const updateProdRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/products/${testProductId}`,
      headers: { 'Content-Type': 'application/json' },
      payload: {
        stockQuantity: targetStock,
        price: firstProd.price,
      },
    });
    if (updateProdRes.statusCode !== 200) {
      throw new Error(`Product update failed: ${updateProdRes.statusCode} ${updateProdRes.body}`);
    }
    const updatedProdData = JSON.parse(updateProdRes.body);
    const updatedProduct = updatedProdData.product || updatedProdData;
    console.log(`   Updated product returned stock: stockQuantity=${updatedProduct.stockQuantity}, stock_quantity=${updatedProduct.stock_quantity}`);
    if (updatedProduct.stock_quantity !== targetStock && updatedProduct.stockQuantity !== targetStock) {
      throw new Error(`Stock was not updated to ${targetStock}! Returned: ${JSON.stringify(updatedProduct)}`);
    }

    // Verify directly in PostgreSQL
    const dbCheck = await query('SELECT stock_quantity FROM products WHERE id = $1', [testProductId]);
    if (dbCheck.rows[0]?.stock_quantity !== targetStock) {
      throw new Error(`PostgreSQL stock_quantity did not update! DB value: ${dbCheck.rows[0]?.stock_quantity}`);
    }
    console.log(`   ✅ Stock update verified in Neon PostgreSQL: ${dbCheck.rows[0].stock_quantity}\n`);

    // 4. Test Admin Booking Creation with camelCase properties
    console.log('💈 4. Testing Admin Booking Creation with camelCase payload (POST /api/admin/bookings)...');
    const bookingRes = await app.inject({
      method: 'POST',
      url: '/api/admin/bookings',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        customerName: 'Sanjay Kapoor',
        customerEmail: 'sanjay.kapoor@urbanblade.in',
        customerPhone: '9876543210',
        bookingDate: '2026-10-15',
        timeSlot: '11:00 AM',
        totalPrice: 1299,
        serviceNames: ['Master Haircut & Scalp Detox'],
        stylistName: 'Vikram Seth',
        notes: 'VIP client appointment test',
      },
    });
    console.log(`   Booking response status: ${bookingRes.statusCode}`);
    if (bookingRes.statusCode !== 201) {
      throw new Error(`Booking creation failed: ${bookingRes.statusCode} ${bookingRes.body}`);
    }
    const bookingData = JSON.parse(bookingRes.body);
    createdBookingId = bookingData.booking?.id || bookingData.id;
    console.log(`   ✅ Booking created cleanly without NOT NULL errors! ID: ${createdBookingId}\n`);

    // 5. Test Cash On Delivery Order with Email in shipping_address
    console.log('🛒 5. Testing Order Placement with Email in Shipping Address (POST /api/orders/cod-order)...');
    const testCustomerEmail = 'vikas.verma@urbanblade.in';
    const orderRes = await app.inject({
      method: 'POST',
      url: '/api/orders/cod-order',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        items: [
          {
            productId: testProductId,
            quantity: 1,
          },
        ],
        shippingAddress: {
          fullName: 'Vikas Verma',
          phone: '9811223344',
          street: 'Flat 402, Royal Palms, Indirapuram',
          city: 'Ghaziabad',
          email: testCustomerEmail,
        },
        userId: testCustomerEmail,
        couponCode: 'WELCOME10',
        discountAmount: 100,
      },
    });
    console.log(`   Order response status: ${orderRes.statusCode}`);
    if (orderRes.statusCode !== 201) {
      throw new Error(`Order placement failed: ${orderRes.statusCode} ${orderRes.body}`);
    }
    const orderData = JSON.parse(orderRes.body);
    createdOrderId = orderData.orderId || orderData.id;
    console.log(`   ✅ Order placed successfully! Receipt: ${orderData.receiptNumber}, Order ID: ${createdOrderId}`);

    // 6. Test Querying Orders by Customer Email
    console.log(`\n🔍 6. Testing Order Discovery by Email (GET /api/orders?email=${testCustomerEmail})...`);
    const customerOrdersRes = await app.inject({
      method: 'GET',
      url: `/api/orders?email=${encodeURIComponent(testCustomerEmail)}`,
    });
    if (customerOrdersRes.statusCode !== 200) {
      throw new Error(`Failed to query customer orders: ${customerOrdersRes.statusCode}`);
    }
    const customerOrders = JSON.parse(customerOrdersRes.body);
    console.log(`   Found ${customerOrders.length} order(s) for ${testCustomerEmail}`);
    const matchedOrder = customerOrders.find((o: any) => o.id === createdOrderId);
    if (!matchedOrder) {
      throw new Error(`Placed order ${createdOrderId} was not found in GET /api/orders?email=${testCustomerEmail}!`);
    }
    console.log(`   ✅ Customer order discovered! Status: ${matchedOrder.status}, Total: ₹${matchedOrder.total_amount}`);
    console.log(`      Shipping Address Email: ${matchedOrder.shipping_address?.email || matchedOrder.shipping_address}`);

    // 7. Test Admin Order Status Lifecycle Advance
    console.log('\n🚚 7. Testing Admin Order Dispatch Pipeline...');
    const stages = ['processing', 'shipped', 'delivered'];
    for (const st of stages) {
      const advanceRes = await app.inject({
        method: 'PUT',
        url: `/api/admin/orders/${createdOrderId}/status`,
        headers: { 'Content-Type': 'application/json' },
        payload: {
          status: st,
          trackingNumber: `TRK-TEST-${createdOrderId.slice(0, 6).toUpperCase()}`,
        },
      });
      if (advanceRes.statusCode !== 200) {
        throw new Error(`Failed to advance order to ${st}: ${advanceRes.statusCode}`);
      }
      console.log(`   ✅ Advanced order to stage: ${st}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log('  🎉 ALL ADMIN & ORDER PIPELINE TESTS PASSED WITH 100% SUCCESS!   ');
    console.log('═══════════════════════════════════════════════════════════════════\n');
  } finally {
    // Cleanup audit records
    console.log('🧹 Cleaning up test audit records...');
    if (createdOrderId) {
      await query('DELETE FROM order_items WHERE order_id = $1', [createdOrderId]);
      await query('DELETE FROM orders WHERE id = $1', [createdOrderId]);
      console.log(`   Cleaned test order ${createdOrderId}`);
    }
    if (createdBookingId) {
      await query('DELETE FROM bookings WHERE id = $1', [createdBookingId]);
      console.log(`   Cleaned test booking ${createdBookingId}`);
    }
    if (testProductId) {
      await query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [originalStock, testProductId]);
      console.log(`   Restored product ${testProductId} stock to ${originalStock}`);
    }
    await pool.end();
  }
}

runAdminAndOrderFixesTest().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
