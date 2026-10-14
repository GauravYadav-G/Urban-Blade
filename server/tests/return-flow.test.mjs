import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import fastify from 'fastify';
import jwt from '@fastify/jwt';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
import { returnsRoutes } from '../dist/modules/orders/returns.routes.js';
import { reviewOrderReturn } from '../dist/modules/orders/return.service.js';

// Disposable PostgreSQL fixtures only: no gateway requests or business DB writes.
test('Full-order return lifecycle, stock inspection, audit and authorization', async t => {
  redis.disconnect();
  const db = new PGlite();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  await db.exec(schema);
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  const app = fastify({ logger: false });
  await app.register(jwt, { secret: randomUUID() });
  await app.register(returnsRoutes, { prefix: '/api' });
  t.after(async () => { await app.close(); await pool.end(); await db.close(); });
  const customer = randomUUID(), other = randomUUID(), admin = randomUUID();
  await query(`INSERT INTO users(id,email,name,password_hash,role) VALUES
    ($1,'returns-customer@example.invalid','Return Customer','unused','customer'),
    ($2,'returns-other@example.invalid','Other Customer','unused','customer'),
    ($3,'returns-admin@example.invalid','Returns Admin','unused','admin')`, [customer, other, admin]);
  const headers = (id = admin, role = id === admin ? 'admin' : 'customer') => ({
    authorization: `Bearer ${app.jwt.sign({ id, email: `fixture-${id}@example.invalid`, name: 'Fixture', role })}`,
  });
  const req = (method, url, payload, id = admin) => app.inject({ method, url, payload, headers: headers(id) });
  const fixture = async (changes = {}, { ledger = true, quantity = 2, items = true } = {}) => {
    const orderId = randomUUID(), productId = randomUUID();
    await query(`INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity)
      VALUES($1,$2,'Return Serum','Fixture',100,'hair','retail','Urban Blade','unisex','/images/placeholder.svg',8)`, [productId, `return-${productId}`]);
    const fields = { user_id: customer, status: 'delivered', payment_method: 'Cash on Delivery', payment_status: 'captured', ...changes };
    await query(`INSERT INTO orders(id,user_id,status,payment_method,payment_status,subtotal,total_amount,currency,shipping_address,
      refund_status,refund_amount,payment_reconciliation_error,razorpay_signature)
      VALUES($1,$2,$3,$4,$5,200,200,'INR',$6,$7,$8,$9,'private-signature-fixture')`,
    [orderId, fields.user_id, fields.status, fields.payment_method, fields.payment_status,
      JSON.stringify({ fullName: 'Return Customer', email: 'returns-customer@example.invalid', phone: '9999999999' }),
      fields.refund_status ?? null, fields.refund_amount ?? null, fields.payment_reconciliation_error ?? null]);
    if (items) await query(`INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,image_url)
      VALUES($1,$2,'Return Serum',100,2,'/images/placeholder.svg')`, [orderId, productId]);
    if (ledger) await query("INSERT INTO stock_reservations(order_id,product_id,quantity,status) VALUES($1,$2,$3,'committed')", [orderId, productId, quantity]);
    return { orderId, productId };
  };
  const stock = async id => (await query('SELECT stock_quantity FROM products WHERE id=$1', [id])).rows[0].stock_quantity;
  const events = async id => (await query('SELECT * FROM order_return_events WHERE order_id=$1 ORDER BY created_at', [id])).rows;
  const open = (id, reason = 'Wrong product received', who = customer) => req('POST', `/api/orders/${id}/return`, { reason }, who);
  const review = (id, status, restock) => req('PUT', `/api/admin/orders/${id}/return`, {
    status, note: status === 'approved' ? 'Approved for inspection' : 'Products inspected by staff',
    ...(restock === undefined ? {} : { restock }),
  });
  let returned;

  await t.test('Only master admins can access queue, review or initiate staff returns', async () => {
    const sample = await fixture();
    for (const [method, url, payload] of [
      ['GET', '/api/admin/returns'], ['GET', `/api/admin/orders/${sample.orderId}/return`],
      ['POST', `/api/admin/orders/${sample.orderId}/return`, { reason: 'Staff request' }],
      ['PUT', `/api/admin/orders/${sample.orderId}/return`, { status: 'approved', note: 'Approve request' }],
    ]) {
      assert.equal((await app.inject({ method, url, payload })).statusCode, 401);
      assert.equal((await req(method, url, payload, customer)).statusCode, 403);
      assert.equal((await app.inject({ method, url, payload, headers: headers(other, 'vendor') })).statusCode, 403);
    }
  });

  await t.test('Validate IDs, request reasons, query parameters and explicit receipt decisions', async () => {
    for (const payload of [{ reason: '' }, { reason: 'xy' }, { reason: 'x'.repeat(501) }, { reason: 'Valid reason', user_id: other }]) {
      assert.equal((await req('POST', `/api/orders/${randomUUID()}/return`, payload, customer)).statusCode, 400);
    }
    assert.equal((await req('POST', '/api/orders/not-a-uuid/return', { reason: 'Valid reason' }, customer)).statusCode, 400);
    for (const querystring of ['status=invented', 'limit=101', 'page=0', 'q=' + 'x'.repeat(151)]) {
      assert.equal((await req('GET', '/api/admin/returns?' + querystring)).statusCode, 400);
    }
    assert.equal((await review(randomUUID(), 'received')).statusCode, 400);
    assert.equal((await review(randomUUID(), 'approved', false)).statusCode, 400);
    await assert.rejects(reviewOrderReturn(randomUUID(), admin, { status: 'received', note: 'Inspected' }), error => error.code === 'RESTOCK_DECISION_REQUIRED');
  });

  await t.test('Customer requests and history are restricted to order ownership', async () => {
    returned = await fixture();
    assert.equal((await open(returned.orderId, 'Other customer request', other)).statusCode, 404);
    assert.equal((await req('GET', `/api/orders/${returned.orderId}/return`, undefined, other)).statusCode, 404);
    assert.equal((await events(returned.orderId)).length, 0);
  });

  await t.test('Reject undelivered orders and unresolved, failed, refunded or partially refunded money', async () => {
    for (const changes of [
      { status: 'shipped' }, { status: 'cancelled' }, { payment_status: 'failed' },
      { payment_status: 'refunded' }, { payment_method: 'Razorpay', payment_status: 'pending' },
      { refund_status: 'pending' }, { refund_status: 'processed' }, { refund_amount: 25 },
      { payment_reconciliation_error: 'Inventory settlement needs review' },
    ]) {
      const order = await fixture(changes);
      assert.equal((await open(order.orderId)).statusCode, 409, JSON.stringify(changes));
      assert.equal((await events(order.orderId)).length, 0);
    }
    const unpaid = await fixture({ payment_status: 'pending' });
    assert.equal((await open(unpaid.orderId)).statusCode, 200);
    assert.equal((await query('SELECT payment_status FROM orders WHERE id=$1', [unpaid.orderId])).rows[0].payment_status, 'pending');
  });

  await t.test('Request and replay preserve reason, funds, stock and one durable event', async () => {
    const result = await open(returned.orderId, '  Wrong product received  ');
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().order.return_status, 'requested');
    assert.equal(result.json().order.return_requested_by, customer);
    assert.ok(result.json().order.return_requested_at);
    assert.equal(result.json().order.items.length, 1);
    assert.ok(!('razorpay_signature' in result.json().order));
    assert.equal((await open(returned.orderId, 'Different retry reason')).statusCode, 200);
    const history = await req('GET', `/api/orders/${returned.orderId}/return`, undefined, customer);
    assert.equal(history.json().order.return_reason, 'Wrong product received');
    assert.equal(history.json().events.length, 1);
    assert.equal(history.json().events[0].source, 'customer');
    assert.equal(history.json().order.payment_status, 'captured');
    assert.equal(await stock(returned.productId), 8);
  });

  await t.test('Staff can open returns for counter orders with no customer account', async () => {
    const counter = await fixture({ user_id: null, payment_method: 'Cash' });
    const result = await req('POST', `/api/admin/orders/${counter.orderId}/return`, { reason: 'Customer returned to counter' });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().order.return_requested_by, admin);
    assert.equal((await events(counter.orderId))[0].source, 'admin');
    assert.equal((await open(counter.orderId)).statusCode, 404);
  });

  await t.test('Receipt needs approval and approval persists operator review without touching inventory', async () => {
    assert.equal((await review(returned.orderId, 'received', true)).statusCode, 409);
    assert.equal((await review(returned.orderId, 'approved')).statusCode, 200);
    const approved = (await req('GET', `/api/admin/orders/${returned.orderId}/return`)).json();
    assert.equal(approved.order.return_reviewed_by, admin);
    assert.ok(approved.order.return_reviewed_at);
    assert.equal(approved.order.return_restock, null);
    assert.equal(approved.events.length, 2);
    assert.equal(approved.events[1].actor_name, 'Returns Admin');
    assert.equal(await stock(returned.productId), 8);
  });

  await t.test('Inspected receipt restores sold units once and rejects contradictory retries', async () => {
    const result = await review(returned.orderId, 'received', true);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().order.return_restock, true);
    assert.ok(result.json().order.return_received_at);
    assert.equal(result.json().order.payment_status, 'captured');
    assert.equal(await stock(returned.productId), 10);
    assert.equal((await review(returned.orderId, 'received', true)).statusCode, 200);
    assert.equal((await review(returned.orderId, 'received', false)).statusCode, 409);
    assert.equal((await review(returned.orderId, 'rejected')).statusCode, 409);
    assert.equal((await events(returned.orderId)).length, 3);
    assert.equal(await stock(returned.productId), 10);
  });

  await t.test('Received return completes offline refund without a second restock', async () => {
    const path = `/api/admin/orders/${returned.orderId}/refund/manual`;
    const payload = { reference: 'returned-offline-refund-001', reason: 'Returned products received' };
    const result = await req('POST', path, payload);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().order.refund_status, 'processed');
    assert.equal(result.json().order.payment_status, 'refunded');
    assert.equal(Number(result.json().order.refund_amount), 200);
    assert.equal((await req('POST', path, payload)).statusCode, 200);
    assert.equal((await req('POST', path, { ...payload, reference: 'different-refund-reference' })).statusCode, 409);
    assert.equal((await query("SELECT COUNT(*)::int AS count FROM offline_payment_records WHERE order_id=$1 AND kind='refund'", [returned.orderId])).rows[0].count, 1);
    assert.equal(await stock(returned.productId), 10);
  });

  await t.test('Damaged goods remain outside sellable inventory through receipt and refund', async () => {
    const damaged = await fixture();
    await open(damaged.orderId, 'Damaged product');
    await review(damaged.orderId, 'approved');
    assert.equal((await review(damaged.orderId, 'received', false)).statusCode, 200);
    assert.equal((await req('POST', `/api/admin/orders/${damaged.orderId}/refund/manual`, { reference: 'damaged-refund-001', reason: 'Damaged product returned' })).statusCode, 200);
    const history = (await req('GET', `/api/admin/orders/${damaged.orderId}/return`)).json();
    assert.equal(history.order.return_restock, false);
    assert.equal(history.events.find(event => event.status === 'received').restock, false);
    assert.equal(await stock(damaged.productId), 8);
  });

  await t.test('Rejected returns remain terminal with original reason and durable review', async () => {
    const rejected = await fixture();
    await open(rejected.orderId, 'Changed my mind');
    assert.equal((await review(rejected.orderId, 'rejected')).statusCode, 200);
    assert.equal((await review(rejected.orderId, 'approved')).statusCode, 409);
    assert.equal((await review(rejected.orderId, 'received', true)).statusCode, 409);
    const history = (await req('GET', `/api/admin/orders/${rejected.orderId}/return`)).json();
    assert.equal(history.order.return_reason, 'Changed my mind');
    assert.equal(history.events.length, 2);
    assert.equal(await stock(rejected.productId), 8);
  });

  await t.test('Missing or mismatched stock ledger blocks restocking and rolls receipt back', async () => {
    for (const options of [{ quantity: 1 }, { ledger: false }]) {
      const corrupt = await fixture({}, options);
      await open(corrupt.orderId);
      await review(corrupt.orderId, 'approved');
      const result = await review(corrupt.orderId, 'received', true);
      assert.equal(result.statusCode, 409, result.body);
      assert.equal(result.json().error, 'RETURN_INVENTORY_REVIEW_REQUIRED');
      const current = (await req('GET', `/api/admin/orders/${corrupt.orderId}/return`)).json();
      assert.equal(current.order.return_status, 'approved');
      assert.equal(current.order.return_received_at, null);
      assert.equal(current.order.return_restock, null);
      assert.equal(current.events.length, 2);
      assert.equal(await stock(corrupt.productId), 8);
    }
  });

  await t.test('Queue filters/search/pagination cover the full return set, with all order items', async () => {
    const queue = await req('GET', '/api/admin/returns?status=all&limit=2&page=1');
    assert.equal(queue.statusCode, 200, queue.body);
    assert.equal(queue.json().data.length, 2);
    assert.ok(queue.json().total > 2);
    const empty = await req('GET', '/api/admin/returns?page=999&limit=2');
    assert.deepEqual(empty.json().data, []);
    assert.equal(empty.json().total, queue.json().total);
    const single = await req('GET', `/api/admin/returns?q=${returned.orderId}`);
    assert.equal(single.json().total, 1);
    assert.equal(single.json().data[0].id, returned.orderId);
    assert.equal(single.json().data[0].items[0].quantity, 2);
    const rejected = await req('GET', '/api/admin/returns?status=rejected&q=Changed%20my%20mind');
    assert.equal(rejected.json().total, 1);
    assert.equal(rejected.json().data[0].return_status, 'rejected');
    assert.equal((await req('GET', '/api/admin/returns?q=%25')).json().total, 0);
    assert.equal((await req('GET', '/api/admin/returns?q=Return%20Serum')).json().total, queue.json().total);
  });

  await t.test('Unexpected database failures return an actionable message without SQL leakage', async () => {
    await query('ALTER TABLE order_return_events RENAME TO missing_return_events');
    try {
      const result = await req('GET', `/api/admin/orders/${returned.orderId}/return`);
      assert.equal(result.statusCode, 503);
      assert.equal(result.json().error, 'RETURN_UNAVAILABLE');
      assert.ok(!result.body.includes('order_return_events'));
      assert.ok(!result.body.includes('SELECT'));
    } finally { await query('ALTER TABLE missing_return_events RENAME TO order_return_events'); }
  });
});
