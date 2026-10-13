import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
import { config } from '../dist/config.js';
import { buildApp } from '../dist/app.js';

// Adapted admin scenarios; primary-source mapping is in docs/admin-test-report.md.
test('Standard admin authorization, validation and data-integrity scenarios', async t => {
  redis.disconnect(); config.razorpay.keyId = ''; config.razorpay.keySecret = '';
  const db = new PGlite();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  pool.query = query; pool.connect = async () => ({ query, release() {} });
  const app = await buildApp(); t.after(async () => { await app.close(); await pool.end(); await db.close(); });
  const admin = { authorization: `Bearer ${app.jwt.sign({ id: '11111111-1111-4111-8111-111111111111', role: 'admin', name: 'Admin', email: 'admin@example.invalid' })}` };
  const vendor = { authorization: `Bearer ${app.jwt.sign({ id: 'vendor-fixture', role: 'vendor', name: 'Studio', vendorName: 'Studio', email: 'vendor@example.invalid' })}` };
  const restricted = ['/api/admin/customers', '/api/admin/vendors', '/api/admin/bookings', '/api/admin/tasks', '/api/admin/support/inquiries', '/api/admin/system', '/api/admin/finance/audit', '/api/admin/coupons'];
  const req = (method, url, payload, headers = admin) => app.inject({ method, url, payload, headers });
  await t.test('AA-01 reject unauthenticated admin reads across modules', async () => {
    for (const url of restricted) assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401, url);
  });
  await t.test('AA-02 isolate vendor users from master-admin modules', async () => {
    for (const url of restricted) assert.equal((await req('GET', url, undefined, vendor)).statusCode, 403, url);
  });
  const product = '22222222-2222-4222-8222-222222222222';
  await query(`INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity,stock_reserved)
    VALUES($1,'admin-fixture','Admin fixture','Fixture',500,'hair','retail','Studio North','unisex','/images/placeholder.svg',10,3)`, [product]);
  await t.test('AA-03 deny product updates from a similarly named vendor', async () => {
    assert.equal((await req('PUT', `/api/admin/products/${product}`, { price: 1 }, vendor)).statusCode, 403);
    assert.equal(Number((await query('SELECT price FROM products WHERE id=$1', [product])).rows[0].price), 500);
  });
  await t.test('AI-01 reject stale inventory versions without changing quantities', async () => {
    assert.equal((await req('PUT', `/api/admin/products/${product}`, { stock_quantity: 20, expectedVersion: 999 })).statusCode, 409);
    assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1', [product])).rows[0].stock_quantity, 10);
  });
  await t.test('AI-02 reject stock below outstanding reservations', async () => {
    assert.equal((await req('PUT', `/api/admin/products/${product}`, { stock_quantity: 2, expectedVersion: 0 })).statusCode, 409);
  });
  let taskId;
  await t.test('AT-01 create a task with its due date and customer context', async () => {
    const result = await req('POST', '/api/admin/tasks', { title: 'Call customer', dueDate: 'Tomorrow', relatedUser: 'Audit Customer' });
    assert.equal(result.statusCode, 201, result.body); taskId = result.json().task.id;
    assert.equal(result.json().task.due_date, 'Tomorrow'); assert.equal(result.json().task.related_user, 'Audit Customer');
  });
  await t.test('AT-02 reject blank task titles', async () => {
    assert.equal((await req('POST', '/api/admin/tasks', { title: ' ' })).statusCode, 400);
  });
  await t.test('AT-03 reject unknown task states', async () => {
    assert.equal((await req('PUT', `/api/admin/tasks/${taskId}`, { status: 'invented' })).statusCode, 400);
  });
  await t.test('AT-04 return not-found for missing task updates', async () => {
    assert.equal((await req('PUT', '/api/admin/tasks/nonexistent-fixture', { status: 'completed' })).statusCode, 404);
  });
  let inquiryId;
  await t.test('AH-01 create a support inquiry for a customer', async () => {
    const result = await req('POST', '/api/admin/support/inquiries', { userName: 'Audit Customer', userEmail: 'customer@example.invalid', subject: 'Delivery help', initialMessage: 'How can we help?' });
    assert.equal(result.statusCode, 201, result.body); inquiryId = result.json().inquiry.id;
    assert.equal(result.json().inquiry.messages[0].sender, 'admin');
  });
  await t.test('AH-02 reject empty replies', async () => {
    assert.equal((await req('POST', `/api/admin/support/inquiries/${inquiryId}/message`, { text: ' ', sender: 'admin' })).statusCode, 400);
  });
  await t.test('AH-03 reject forged message sender roles', async () => {
    assert.equal((await req('POST', `/api/admin/support/inquiries/${inquiryId}/message`, { text: 'Reply', sender: 'user' })).statusCode, 400);
  });
  await t.test('AH-04 reject unknown inquiry statuses', async () => {
    assert.equal((await req('PUT', `/api/admin/support/inquiries/${inquiryId}/status`, { status: 'invented' })).statusCode, 400);
  });
  await t.test('AH-05 return not-found for missing inquiry status updates', async () => {
    assert.equal((await req('PUT', '/api/admin/support/inquiries/nonexistent-fixture/status', { status: 'closed' })).statusCode, 404);
  });
  await t.test('AH-06 preserve concurrent replies and assign distinct message IDs', async () => {
    const before = (await query('SELECT messages FROM support_inquiries WHERE id=$1', [inquiryId])).rows[0].messages.length;
    const results = await Promise.all(['First parallel reply', 'Second parallel reply'].map(text =>
      req('POST', `/api/admin/support/inquiries/${inquiryId}/message`, { text, sender: 'admin' })));
    for (const result of results) assert.equal(result.statusCode, 200, result.body);
    const messages = (await query('SELECT messages FROM support_inquiries WHERE id=$1', [inquiryId])).rows[0].messages;
    assert.equal(messages.length, before + 2);
    assert.equal(new Set(messages.slice(-2).map(message => message.id)).size, 2);
  });
});
