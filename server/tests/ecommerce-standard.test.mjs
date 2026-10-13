import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
import { config } from '../dist/config.js';
import { buildApp } from '../dist/app.js';
import { calculateTotals, defaultCommerceRules } from '../dist/modules/commerce/commerce.service.js';

// Source mapping: docs/ecommerce-test-report.md. No real gateway or database writes.
test('Web and GitHub ecommerce scenarios adapted for Urban Blade', async t => {
  redis.disconnect();
  config.razorpay.keyId = ''; config.razorpay.keySecret = '';
  const db = new PGlite();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  pool.query = query; pool.connect = async () => ({ query, release() {} });
  const app = await buildApp();
  t.after(async () => { await app.close(); await pool.end(); await db.close(); });
  const signup = { name: 'Audit Shopper', email: 'audit-shopper@example.invalid', password: 'Audit-only-password-42' };
  let token;
  const auth = () => ({ authorization: `Bearer ${token}` });

  await t.test('AUTH-01 register a customer with no administrative privilege', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...signup, role: 'admin' } });
    assert.equal(result.statusCode, 201, result.body); assert.equal(result.json().user.role, 'customer');
    assert.ok(!('password_hash' in result.json().user)); token = result.json().token;
  });
  await t.test('AUTH-02 reject duplicate registrations', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload: signup })).statusCode, 409);
  });
  await t.test('AUTH-03 reject invalid email and short password', async () => {
    for (const payload of [{ ...signup, email: 'invalid' }, { ...signup, password: 'short' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/auth/register', payload })).statusCode, 400);
    }
  });
  await t.test('AUTH-04 reject incorrect login credentials', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: signup.email, password: 'wrong-password' } })).statusCode, 401);
  });
  await t.test('AUTH-05 login and read the authenticated profile', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: signup.email, password: signup.password } });
    assert.equal(result.statusCode, 200, result.body); token = result.json().token;
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth() })).statusCode, 200);
  });
  await t.test('SEC-01 prevent customer access to admin money records', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/admin/finance/audit', headers: auth() })).statusCode, 403);
  });
  await t.test('SEC-02 only administrators can initiate refunds', async () => {
    const url = '/api/admin/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/refund';
    assert.equal((await app.inject({ method: 'POST', url, payload: { reason: 'Audit refund' } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url, headers: auth(), payload: { reason: 'Audit refund' } })).statusCode, 403);
  });
  await query(`INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity,stock_reserved,in_stock,rating)
    VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','audit-serum','Audit Serum','Hair care',500,'hair','retail','Audit Vendor','unisex','/images/placeholder.svg',10,3,true,4),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','audit-cream','Audit Cream','Skin care',200,'skin','retail','Audit Vendor','ladies','/images/placeholder.svg',0,0,false,5)`);
  await t.test('CAT-09 public API searches and filters products', async () => {
    const result = await app.inject({ method: 'GET', url: '/api/products?q=serum&cat=hair&nocache=1' });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().data.length, 1);
    assert.equal(result.json().data[0].slug, 'audit-serum');
  });
  await t.test('CAT-10 public API sorts and paginates products', async () => {
    const result = await app.inject({ method: 'GET', url: '/api/products?sort=price-asc&limit=1&page=2&nocache=1' });
    assert.equal(result.statusCode, 200, result.body); assert.equal(result.json().data.length, 1);
    assert.equal(result.json().data[0].price, 500);
  });
  await t.test('INV-01 catalog availability excludes reserved stock', async () => {
    const result = await app.inject({ method: 'GET', url: '/api/products?q=serum&nocache=1' });
    assert.equal(result.json().data[0].stock_quantity, 7);
  });
  await t.test('INV-02 an unavailable product cannot be quoted for checkout', async () => {
    const result = await app.inject({ method: 'POST', url: '/api/orders/quote', headers: auth(), payload: { items: [{ productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', quantity: 1 }] } });
    assert.equal(result.statusCode, 400, result.body);
  });
  await query(`INSERT INTO coupons(code,discount_type,discount_value,min_order_value,max_discount_amount,expires_at)
    VALUES('AUDIT-CAP','percentage',50,0,100,NULL),
      ('AUDIT-EXPIRED','fixed',100,0,NULL,NOW()-INTERVAL '1 day'),
      ('AUDIT-MIN','fixed',100,1000,NULL,NULL)`);
  const quote = couponCode => app.inject({ method: 'POST', url: '/api/orders/quote', headers: auth(),
    payload: { items: [{ productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity: 1 }], couponCode } });
  await t.test('COUPON-01 valid coupons obey the maximum discount cap', async () => {
    const result = await quote('AUDIT-CAP');
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().discountAmount, 100);
    assert.equal(result.json().totalAmount, 499);
  });
  await t.test('COUPON-02 expired codes cannot reduce the checkout price', async () => {
    assert.equal((await quote('AUDIT-EXPIRED')).statusCode, 400);
  });
  await t.test('COUPON-03 coupon minimum order values are enforced', async () => {
    assert.equal((await quote('AUDIT-MIN')).statusCode, 400);
  });
  await t.test('CART-13 authenticated carts persist and reject duplicate product lines', async () => {
    const line = { lineId: 'line-audit', productId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Audit Serum', imageUrl: '/images/placeholder.svg', unitPrice: 500, currency: 'INR', qty: 2, kind: 'retail' };
    const result = await app.inject({ method: 'POST', url: '/api/auth/cart', headers: auth(), payload: { items: [line] } });
    assert.equal(result.statusCode, 200, result.body);
    const restored = await app.inject({ method: 'GET', url: '/api/auth/cart', headers: auth() });
    assert.deepEqual(restored.json().items, [line]);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/cart', headers: auth(), payload: { items: [line, line] } })).statusCode, 400);
  });
  await t.test('TOTAL-01 shipping fee changes at the configured threshold', () => {
    assert.equal(calculateTotals(998, 0, defaultCommerceRules).shippingFee, 99);
    assert.equal(calculateTotals(999, 0, defaultCommerceRules).shippingFee, 0);
  });
  await t.test('TOTAL-02 inclusive tax does not add tax twice', () => {
    const result = calculateTotals(1180, 0, defaultCommerceRules);
    assert.equal(result.taxAmount, 180); assert.equal(result.totalAmount, 1180);
  });
  await t.test('TOTAL-03 exclusive tax uses the discounted merchandise amount', () => {
    const result = calculateTotals(1000, 100, { ...defaultCommerceRules, taxInclusive: false, taxRatePercent: 10, standardShippingFee: 25, freeShippingEnabled: false });
    assert.equal(result.taxAmount, 90); assert.equal(result.totalAmount, 1015);
  });
  await t.test('AUTH-06 logout revokes the old access token', async () => {
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth() })).statusCode, 200);
    assert.equal((await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth() })).statusCode, 401);
  });
});
