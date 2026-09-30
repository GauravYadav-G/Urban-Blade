import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { createHmac } from 'node:crypto';
import { ordersRoutes, resolveAndVerifyItems } from '../dist/modules/orders/orders.routes.js';
import { paymentWebhookRoutes } from '../dist/modules/orders/payment-webhook.routes.js';
import { idempotencyHook, saveIdempotentResponse } from '../dist/core/idempotency.middleware.js';
import { releaseStockReservation, commitStockReservation } from '../dist/modules/orders/stock-reservation.service.js';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
import { config } from '../dist/config.js';

// No external database, Redis, or payment requests: boundaries are explicit test doubles.
redis.disconnect();
after(async () => { await pool.end(); });
const owner = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const product = { id: '33333333-3333-4333-8333-333333333333', name: 'Serum', price: '500', stock_quantity: 5, stock_reserved: 1, in_stock: true };
let db;
beforeEach(() => {
  db = async (sql) => {
    if (sql.includes('revoked_access_tokens')) return { rows: [], rowCount: 0 };
    if (sql.includes('FROM products')) return { rows: [product], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  };
  pool.query = (...args) => db(...args);
});
async function appWithOrders() {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret-with-at-least-32-characters' });
  await app.register(ordersRoutes, { prefix: '/api' });
  return app;
}
function auth(app, id = owner) { return { authorization: `Bearer ${app.jwt.sign({ id, email: 'buyer@example.com', role: 'customer' })}` }; }

test('checkout requires authentication', async () => {
  const app = await appWithOrders();
  const res = await app.inject({ method: 'POST', url: '/api/orders/cod-order', payload: {} });
  assert.equal(res.statusCode, 401); await app.close();
});
test('legacy self-certified payment endpoint is retired', async () => {
  const app = await appWithOrders();
  const res = await app.inject({ method: 'POST', url: '/api/orders/verify-payment', payload: { paymentId: 'pay_sim_fake' } });
  assert.equal(res.statusCode, 410); await app.close();
});
test('client discounts cannot change authoritative prices', async () => {
  const quote = await resolveAndVerifyItems([{ productId: product.id, quantity: 1 }], undefined, 499);
  assert.equal(quote.totalAmount, 599); assert.equal(quote.discountAmount, 0);
});
test('fractional, excessive and duplicate cart quantities are rejected', async () => {
  await assert.rejects(resolveAndVerifyItems([{ productId: product.id, quantity: 0.5 }]), /INVALID_QUANTITY/);
  await assert.rejects(resolveAndVerifyItems([{ productId: product.id, quantity: 101 }]), /INVALID_QUANTITY/);
  await assert.rejects(resolveAndVerifyItems([{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 1 }]), /DUPLICATE_PRODUCT/);
});
test('stock availability excludes existing reservations', async () => {
  await assert.rejects(resolveAndVerifyItems([{ productId: product.id, quantity: 5 }]), /INSUFFICIENT_STOCK/);
});
test('another customer cannot verify or cancel an order', async () => {
  db = async sql => ({ rows: sql.includes('revoked_access_tokens') ? [] : [{ user_id: 'someone-else' }], rowCount: 1 });
  const app = await appWithOrders();
  for (const url of ['/api/orders/razorpay/verify', '/api/orders/cancel-payment']) {
    const res = await app.inject({ method: 'POST', url, headers: auth(app), payload: { orderId } });
    assert.equal(res.statusCode, 404);
  }
  await app.close();
});
test('synthetic payment signatures never confirm orders', async () => {
  config.razorpay.keySecret = 'test-provider-secret';
  db = async sql => ({ rows: sql.includes('revoked_access_tokens') ? [] : [{ id: orderId, user_id: owner, payment_method: 'Razorpay', idempotency_key: 'order_real' }], rowCount: 1 });
  const app = await appWithOrders();
  const res = await app.inject({ method: 'POST', url: '/api/orders/razorpay/verify', headers: auth(app), payload: { orderId, razorpayOrderId: 'order_real', razorpayPaymentId: 'pay_sim_fake', razorpaySignature: 'test_fake' } });
  assert.equal(res.statusCode, 400); assert.equal(res.json().error, 'INVALID_SIGNATURE'); await app.close();
});
test('payment from a different gateway order cannot be substituted', async () => {
  db = async sql => ({ rows: sql.includes('revoked_access_tokens') ? [] : [{ user_id: owner, payment_method: 'Razorpay', idempotency_key: 'order_original' }], rowCount: 1 });
  const app = await appWithOrders();
  const res = await app.inject({ method: 'POST', url: '/api/orders/razorpay/verify', headers: auth(app), payload: { orderId, razorpayOrderId: 'order_other', razorpayPaymentId: 'pay_other', razorpaySignature: 'a'.repeat(64) } });
  assert.equal(res.json().error, 'ORDER_MISMATCH'); await app.close();
});
test('idempotency blocks concurrent requests, replays success and rejects changed payloads', async () => {
  const app = Fastify();
  await app.register(jwt, { secret: 'test-secret-with-at-least-32-characters' });
  app.addHook('preHandler', idempotencyHook); app.addHook('onSend', saveIdempotentResponse);
  let calls = 0;
  app.post('/api/orders/cod-order', async () => { calls++; await new Promise(r => setTimeout(r, 30)); return { orderId }; });
  const request = { method: 'POST', url: '/api/orders/cod-order', headers: { ...auth(app), 'x-idempotency-key': 'attempt-one' }, payload: { quantity: 1 } };
  const responses = await Promise.all([app.inject(request), app.inject(request)]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 409]);
  assert.equal((await app.inject(request)).statusCode, 200); assert.equal(calls, 1);
  assert.equal((await app.inject({ ...request, payload: { quantity: 2 } })).statusCode, 409);
  await app.close();
});
test('stock release is a no-op when a hold was already resolved', async () => {
  let queries = 0;
  const client = { query: async () => { queries++; return { rows: [], rowCount: 0 }; } };
  assert.equal((await releaseStockReservation(client, orderId)).activeReservations, 0);
  assert.equal(queries, 1);
});
test('stock inconsistency throws so caller can roll back the complete transaction', async () => {
  const client = { query: async sql => sql.includes('SELECT product_id') ? { rows: [{ product_id: product.id, quantity: 2 }] } : { rowCount: 0, rows: [] } };
  await assert.rejects(commitStockReservation(client, orderId), /STOCK_LEDGER_INCONSISTENT/);
});
test('webhook signatures are checked against exact request bytes', async () => {
  config.razorpay.webhookSecret = 'webhook-test-secret';
  const app = Fastify(); await app.register(paymentWebhookRoutes, { prefix: '/api' });
  const raw = '{ "event": "payment.failed" }';
  const signature = createHmac('sha256', config.razorpay.webhookSecret).update(raw).digest('hex');
  const request = { method: 'POST', url: '/api/payments/razorpay/webhook', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, payload: raw };
  assert.equal((await app.inject(request)).statusCode, 200);
  assert.equal((await app.inject({ ...request, payload: raw + ' ' })).statusCode, 400);
  await app.close();
});

test('COD rejects a stale displayed price before changing stock', async () => {
  const app = await appWithOrders();
  const res = await app.inject({ method: 'POST', url: '/api/orders/cod-order', headers: auth(app), payload: {
    items: [{ productId: product.id, quantity: 1 }], expectedTotal: 1,
    shippingAddress: { fullName: 'Test Buyer', phone: '9999999999', street: '123 Test Street', city: 'Delhi' },
  } });
  assert.equal(res.statusCode, 409); assert.equal(res.json().error, 'PRICE_CHANGED'); await app.close();
});

test('COD persists an order owned by the signed-in user with provider-independent pending payment', async () => {
  const statements = [];
  const originalConnect = pool.connect;
  pool.connect = async () => ({
    query: async (sql, values) => { statements.push({ sql, values }); return { rows: [], rowCount: 1 }; }, release() {},
  });
  const app = await appWithOrders();
  try {
    const res = await app.inject({ method: 'POST', url: '/api/orders/cod-order', headers: auth(app), payload: {
      userId: 'attacker-chosen-owner', items: [{ productId: product.id, quantity: 1 }], expectedTotal: 599,
      shippingAddress: { fullName: 'Test Buyer', phone: '9999999999', street: '123 Test Street', city: 'Delhi', email: 'spoof@example.com' },
    } });
    assert.equal(res.statusCode, 201); assert.equal(res.json().paymentStatus, 'pending'); assert.equal(res.json().totalAmount, 599);
    const insert = statements.find(statement => statement.sql.includes('INSERT INTO orders'));
    assert.equal(insert.values[1], owner);
    assert.equal(JSON.parse(insert.values[6]).email, 'buyer@example.com');
    assert.equal(statements.at(-1).sql, 'COMMIT');
  } finally { pool.connect = originalConnect; await app.close(); }
});
