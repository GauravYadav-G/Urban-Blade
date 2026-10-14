import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import Fastify from 'fastify';
import { createHmac } from 'node:crypto';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
import { processVendorPayout, reconcileVendorPayout, applyVendorPayoutWebhook } from '../dist/modules/admin/durable-payout.service.js';
import { prepareRazorpayXPayout, submitRazorpayXPayout } from '../dist/modules/admin/vendor-payout.service.js';
import { vendorBalances } from '../dist/modules/admin/vendor-finance.service.js';
import { paymentWebhookRoutes } from '../dist/modules/orders/payment-webhook.routes.js';
import { config } from '../dist/config.js';

test('durable payout claims, provider recovery, and monetary integrity', async t => {
  redis.disconnect();
  const db = new PGlite();
  const keys = ['RAZORPAYX_KEY_ID', 'RAZORPAYX_KEY_SECRET', 'RAZORPAYX_ACCOUNT_NUMBER'];
  const previous = keys.map(key => process.env[key]);
  process.env.RAZORPAYX_KEY_ID = 'payout-test-key';
  process.env.RAZORPAYX_KEY_SECRET = 'payout-test-secret';
  process.env.RAZORPAYX_ACCOUNT_NUMBER = 'test-account';
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  let failSettlementOnce = false;
  const query = async (sql, params = []) => {
    if (failSettlementOnce && sql.includes('SET provider_transfer_id = $2')) {
      failSettlementOnce = false;
      throw new Error('simulated storage outage after provider accepted payout');
    }
    const value = await db.query(sql, params);
    return { rows: value.rows, rowCount: value.affectedRows || value.rows.length };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  t.after(async () => {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await pool.end();
    await db.close();
  });
  const admin = '11111111-1111-4111-8111-111111111111';
  const product = '22222222-2222-4222-8222-222222222222';
  const order = '33333333-3333-4333-8333-333333333333';
  const vendorId = 'durable-payout-vendor';
  await query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'payout@example.invalid','Payout Admin','unused','admin')", [admin]);
  await query("INSERT INTO vendors(id,name,slug,email,password,contact_person,phone,commission_rate,payout_account) VALUES($1,'Payout Studio','payout-studio','vendor@example.invalid','unused','Fixture','9876543210',10,$2::jsonb)", [vendorId, JSON.stringify({ upi: 'original@upi', verified: true })]);
  await query("INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity) VALUES($1,'payout-product','Payout product','Fixture',2000,'hair','retail','Payout Studio','unisex','/images/placeholder.svg',1)", [product]);
  await query("INSERT INTO orders(id,status,subtotal,total_amount,payment_method,payment_status,shipping_address) VALUES($1,'delivered',2000,2000,'Cash on Delivery','captured','{}')", [order]);
  await query("INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,'Payout product',2000,1)", [order, product]);
  const request = (reference = 'payout-reference') => ({ vendorId, amount: 500, reference, recordedBy: admin, mode: 'razorpayx' });
  const response = (payload, status = 'queued', id = 'pout_fixture') => ({ id, amount: payload.amount, currency: 'INR', reference_id: payload.reference_id, status });
  const balance = async () => (await vendorBalances()).rows.find(value => value.id === vendorId);
  const saved = async () => (await query('SELECT * FROM vendor_payouts')).rows[0];
  const ageClaim = async () => query("UPDATE vendor_payouts SET submission_started_at = NOW() - INTERVAL '2 minutes'");
  t.beforeEach(async () => {
    await query('DELETE FROM vendor_payouts');
    await query('UPDATE vendors SET payout_account=$1::jsonb WHERE id=$2', [JSON.stringify({ upi: 'original@upi', verified: true }), vendorId]);
  });

  await t.test('persist and reserve balance before sending; simultaneous duplicate does not submit again', async () => {
    let submissions = 0;
    const gateway = { prepare: prepareRazorpayXPayout, fetch: async () => { throw new Error('unexpected fetch'); }, submit: async (payload, key) => {
      submissions++;
      const claim = await saved();
      assert.equal(claim.provider_status, 'submitting');
      assert.deepEqual(claim.provider_payload, payload);
      assert.equal(claim.provider_idempotency_key, key);
      assert.match(key, /^[a-z0-9-]{36}$/);
      assert.ok(payload.reference_id.length <= 40);
      assert.equal(Number((await balance()).pending_amount), 500);
      const repeated = await processVendorPayout(request(), gateway);
      assert.equal(repeated.payout.id, claim.id);
      assert.equal(repeated.payout.provider_status, 'submitting');
      return response(payload);
    } };
    const value = await processVendorPayout(request(), gateway);
    assert.equal(submissions, 1);
    assert.equal(value.disbursed, false);
    assert.equal(value.payout.provider_status, 'queued');
    assert.equal(value.payout.provider_payload, undefined);
    assert.equal(value.payout.provider_idempotency_key, undefined);
    assert.equal(Number((await balance()).payable_amount), 1300);
  });

  await t.test('timeout retains the claim and recovers the same payload even after beneficiary changes', async () => {
    const calls = [];
    const gateway = { prepare: prepareRazorpayXPayout, fetch: async () => { throw new Error('unexpected fetch'); }, submit: async (payload, key) => {
      calls.push({ payload: structuredClone(payload), key });
      if (calls.length === 1) throw new Error('simulated network timeout');
      return response(payload, 'processed');
    } };
    await assert.rejects(processVendorPayout(request(), gateway), /timeout/);
    assert.equal((await saved()).provider_status, 'uncertain');
    assert.equal(Number((await balance()).pending_amount), 500);
    const duplicate = await processVendorPayout(request(), gateway);
    assert.equal(duplicate.payout.provider_status, 'uncertain');
    assert.equal(calls.length, 1);
    await assert.rejects(processVendorPayout({ ...request('different-reference'), amount: 1400 }, gateway), /PAYOUT_EXCEEDS_BALANCE/);
    await assert.rejects(processVendorPayout({ ...request(), amount: 501 }, gateway), /PAYOUT_REFERENCE_CONFLICT/);
    await reconcileVendorPayout(duplicate.payout.id, gateway);
    assert.equal(calls.length, 1, 'fresh claims cannot race with another provider submission');
    await query('UPDATE vendors SET payout_account=$1::jsonb WHERE id=$2', [JSON.stringify({ upi: 'changed@upi', verified: false }), vendorId]);
    await ageClaim();
    const recovered = await reconcileVendorPayout(duplicate.payout.id, gateway);
    assert.equal(recovered.disbursed, true);
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(calls[1].payload.fund_account.vpa.address, 'original@upi');
    assert.equal(Number((await balance()).paid_amount), 500);
    assert.equal(Number((await balance()).pending_amount), 0);
  });

  await t.test('lost database write after successful provider transfer cannot produce another transfer', async () => {
    const transfers = new Map();
    let posts = 0;
    const gateway = { prepare: prepareRazorpayXPayout, fetch: async () => { throw new Error('unexpected fetch'); }, submit: async (payload, key) => {
      posts++;
      if (!transfers.has(key)) transfers.set(key, response(payload, 'processed'));
      return transfers.get(key);
    } };
    failSettlementOnce = true;
    await assert.rejects(processVendorPayout(request(), gateway), /storage outage/);
    const claim = await saved();
    assert.equal(claim.provider_status, 'uncertain');
    assert.equal(Number((await balance()).pending_amount), 500);
    await ageClaim();
    const recovered = await reconcileVendorPayout(claim.id, gateway);
    assert.equal(recovered.disbursed, true);
    assert.equal(posts, 2);
    assert.equal(transfers.size, 1);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM vendor_payouts')).rows[0].count, 1);
  });

  await t.test('invalid and mismatched provider responses never mark money paid', async () => {
    for (const bad of [{ status: 'unknown' }, { amount: 49900 }, { currency: 'USD' }, { reference_id: 'someone-else' }]) {
      await query('DELETE FROM vendor_payouts');
      const gateway = { prepare: prepareRazorpayXPayout, fetch: async () => {}, submit: async payload => ({ ...response(payload, 'processed'), ...bad }) };
      await assert.rejects(processVendorPayout(request(), gateway));
      assert.equal((await saved()).provider_status, 'uncertain');
      assert.equal(Number((await balance()).paid_amount), 0);
      assert.equal(Number((await balance()).pending_amount), 500);
    }
  });

  await t.test('existing IDs reconcile by GET and delayed webhooks cannot regress settled or reversed payouts', async () => {
    let posts = 0;
    let current;
    const gateway = { prepare: prepareRazorpayXPayout, submit: async payload => { posts++; current = response(payload); return current; }, fetch: async id => {
      assert.equal(id, 'pout_fixture');
      return { ...current, status: 'processed' };
    } };
    const queued = await processVendorPayout(request(), gateway);
    const processed = await reconcileVendorPayout(queued.payout.id, gateway);
    assert.equal(processed.disbursed, true);
    assert.equal(posts, 1);
    assert.equal(await applyVendorPayoutWebhook({ ...current, status: 'queued' }), true);
    assert.equal((await saved()).provider_status, 'processed');
    await assert.rejects(applyVendorPayoutWebhook({ ...current, amount: 100, status: 'processed' }), /PAYOUT_PROVIDER_MISMATCH/);
    await applyVendorPayoutWebhook({ ...current, status: 'reversed' });
    assert.equal(Number((await balance()).paid_amount), 0);
    await applyVendorPayoutWebhook({ ...current, status: 'processed' });
    assert.equal((await saved()).provider_status, 'reversed');
    assert.equal(Number((await balance()).payable_amount), 1800);
    assert.equal(await applyVendorPayoutWebhook({ ...current, id: 'pout_unmapped', reference_id: 'unmapped' }), false);
  });

  await t.test('expired ambiguous requests require manual review and never replay a money POST', async () => {
    let posts = 0;
    const gateway = { prepare: prepareRazorpayXPayout, submit: async () => { posts++; throw new Error('timeout'); }, fetch: async () => {} };
    await assert.rejects(processVendorPayout(request(), gateway), /timeout/);
    const claim = await saved();
    await query("UPDATE vendor_payouts SET created_at=NOW()-INTERVAL '8 days',submission_started_at=NOW()-INTERVAL '8 days'");
    await assert.rejects(reconcileVendorPayout(claim.id, gateway), /PAYOUT_REQUIRES_MANUAL_REVIEW/);
    assert.equal(posts, 1);
    assert.equal(Number((await balance()).pending_amount), 500);
  });

  await t.test('legacy payouts with a known ID reconcile without rebuilding or posting a payload', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    await query(`INSERT INTO vendor_payouts(id,vendor_id,amount,reference,recorded_by,provider,provider_transfer_id,provider_status)
      VALUES($1,$2,500,'legacy-reference',$3,'razorpayx','pout_legacy','processing')`, [id, vendorId, admin]);
    const gateway = { prepare: () => { throw new Error('unexpected prepare'); }, submit: async () => { throw new Error('unexpected money POST'); },
      fetch: async payoutId => { assert.equal(payoutId, 'pout_legacy'); return { id: payoutId, amount: 50000, currency: 'INR', status: 'processed', reference_id: 'legacy-reference' }; } };
    const value = await reconcileVendorPayout(id, gateway);
    assert.equal(value.disbursed, true);
    assert.equal(Number((await balance()).paid_amount), 500);
  });

  await t.test('RazorpayX webhooks enforce their own signature and settle mapped transactions', async subtest => {
    const oldXSecret = process.env.RAZORPAYX_WEBHOOK_SECRET;
    const oldPaymentSecret = config.razorpay.webhookSecret;
    process.env.RAZORPAYX_WEBHOOK_SECRET = 'fixture-payout-webhook-secret';
    config.razorpay.webhookSecret = 'different-fixture-payment-secret';
    const app = Fastify();
    subtest.after(async () => {
      await app.close();
      if (oldXSecret === undefined) delete process.env.RAZORPAYX_WEBHOOK_SECRET;
      else process.env.RAZORPAYX_WEBHOOK_SECRET = oldXSecret;
      config.razorpay.webhookSecret = oldPaymentSecret;
    });
    await app.register(paymentWebhookRoutes, { prefix: '/api' });
    let provider;
    const gateway = { prepare: prepareRazorpayXPayout, fetch: async () => {}, submit: async payload => {
      provider = response(payload);
      return provider;
    } };
    await processVendorPayout(request(), gateway);
    const raw = JSON.stringify({ event: 'payout.processed', payload: { payout: { entity: { ...provider, status: 'processed' } } } });
    const sign = secret => createHmac('sha256', secret).update(raw).digest('hex');
    const req = signature => app.inject({ method: 'POST', url: '/api/payments/razorpayx/webhook', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, payload: raw });
    assert.equal((await req(sign(config.razorpay.webhookSecret))).statusCode, 400);
    assert.equal((await req('invalid')).statusCode, 400);
    assert.equal((await saved()).provider_status, 'queued');
    assert.equal((await req(sign(process.env.RAZORPAYX_WEBHOOK_SECRET))).statusCode, 200);
    assert.equal((await saved()).provider_status, 'processed');
    assert.equal(Number((await balance()).paid_amount), 500);
    assert.equal((await req(sign(process.env.RAZORPAYX_WEBHOOK_SECRET))).statusCode, 200);
    assert.equal(Number((await balance()).paid_amount), 500);
  });

  await t.test('manual payments remain distinct and duplicate references cannot be changed', async () => {
    const input = { ...request(), mode: 'manual' };
    const first = await processVendorPayout(input);
    const repeat = await processVendorPayout(input);
    assert.equal(first.payout.id, repeat.payout.id);
    assert.equal(first.disbursed, false);
    assert.equal(first.payout.provider_status, 'manual_recorded');
    await assert.rejects(processVendorPayout({ ...input, mode: 'razorpayx' }), /PAYOUT_REFERENCE_CONFLICT/);
    assert.equal(Number((await balance()).paid_amount), 500);
  });

  await t.test('provider transport uses compliant idempotency header and rejects malformed responses without live calls', async () => {
    const oldFetch = globalThis.fetch;
    t.after(() => { globalThis.fetch = oldFetch; });
    const payload = prepareRazorpayXPayout({ amount: 500, reference: 'provider-reference', narration: 'Urban Blade payout', vendorId, vendorName: 'Payout Studio', account: { upi: 'original@upi', verified: true } });
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://api.razorpay.com/v1/payouts');
      assert.equal(options.headers['X-Payout-Idempotency'], '11111111-1111-4111-8111-111111111111');
      assert.deepEqual(JSON.parse(options.body), payload);
      return { ok: true, json: async () => ({ ...response(payload, 'processed'), status: 'invented' }) };
    };
    await assert.rejects(submitRazorpayXPayout(payload, admin), /invalid payout response/);
    await assert.rejects(submitRazorpayXPayout(payload, 'a'.repeat(64)), /saved payout key is invalid/);
    globalThis.fetch = oldFetch;
  });
});
