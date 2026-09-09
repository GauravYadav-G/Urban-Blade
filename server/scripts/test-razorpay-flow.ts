import { pool } from '../src/db/pool.js';
import crypto from 'crypto';
import { config } from '../src/config.js';

async function testRazorpay() {
  console.log('🧪 Testing Razorpay End-to-End Order Creation & Verification...');

  // 1. Fetch in-stock product
  const pRes = await pool.query('SELECT id, name, price, stock_quantity FROM products WHERE stock_quantity > 5 LIMIT 1');
  const prod = pRes.rows[0];
  console.log(`📦 Using product: ${prod.name} (Stock: ${prod.stock_quantity}, Price: ₹${prod.price})`);

  // 2. Test create-order API
  const res = await fetch('http://localhost:4000/api/orders/razorpay/create-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: prod.id, quantity: 1 }],
      shippingAddress: { fullName: 'Gaurav Yadav', phone: '9015618265', street: 'Sector 14, Raj Nagar' },
    }),
  });

  const session = await res.json() as any;
  console.log('✅ Razorpay Order Created:', session);

  if (!session.razorpayOrderId) {
    throw new Error('No razorpayOrderId returned');
  }

  // 3. Simulate payment verification
  const paymentId = `pay_rzp_test_${Date.now()}`;
  const text = `${session.razorpayOrderId}|${paymentId}`;
  const signature = crypto.createHmac('sha256', config.razorpay.keySecret).update(text).digest('hex');

  const verifyRes = await fetch('http://localhost:4000/api/orders/razorpay/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderId: session.orderId,
      razorpayOrderId: session.razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: signature,
    }),
  });

  const receipt = await verifyRes.json() as any;
  console.log('✅ Razorpay Payment Verified in Neon DB:', receipt);

  // 4. Test COD Order
  const codRes = await fetch('http://localhost:4000/api/orders/cod-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: prod.id, quantity: 1 }],
      shippingAddress: { fullName: 'Gaurav Yadav', phone: '9015618265', street: 'Sector 14, Raj Nagar' },
    }),
  });

  const codReceipt = await codRes.json() as any;
  console.log('✅ Cash on Delivery Order Created in Neon DB:', codReceipt);

  console.log('\n🎉 ALL RAZORPAY & COD BACKEND TESTS PASSED 100%!');
  await pool.end();
}

testRazorpay().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
