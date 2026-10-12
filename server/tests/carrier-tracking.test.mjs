import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('durable carrier tracking retries, deduplicates and exposes the same verified snapshot', async t => {
  const db = new PGlite();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  await db.exec(schema);
  const { pool } = await import('../dist/db/pool.js');
  const { redis } = await import('../dist/redis/client.js');
  redis?.disconnect();
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.DELHIVERY_API_TOKEN;
  const originalEnabled = process.env.CARRIER_TRACKING_ENABLED;
  process.env.DELHIVERY_API_TOKEN = 'test-fixture';
  process.env.CARRIER_TRACKING_ENABLED = 'false';
  const { syncDueCarrierOrders, retryDelaySeconds } = await import('../dist/modules/orders/carrier-tracking.worker.js');
  const { syncOrderFromCarrierWebsite, fetchCarrierWebsiteTracking } = await import('../dist/modules/orders/carrier-portal.service.js');
  const { buildApp } = await import('../dist/app.js');
  const app = await buildApp();
  t.after(async () => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.DELHIVERY_API_TOKEN; else process.env.DELHIVERY_API_TOKEN = originalToken;
    if (originalEnabled === undefined) delete process.env.CARRIER_TRACKING_ENABLED; else process.env.CARRIER_TRACKING_ENABLED = originalEnabled;
    await app.close(); await db.close(); await pool.end();
  });
  const customer = '10000000-0000-4000-8000-000000000001';
  const admin = '10000000-0000-4000-8000-000000000002';
  const order = '10000000-0000-4000-8000-000000000003';
  await query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'customer@example.com','Customer','unused','customer'),($2,'admin@example.com','Admin','unused','admin')", [customer, admin]);
  await query(`INSERT INTO orders(id,user_id,status,subtotal,total_amount,shipping_address,payment_method,payment_status,tracking_number,carrier)
    VALUES($1,$2,'processing',100,100,'{}','Cash on Delivery','pending','12345','Delhivery')`, [order, customer]);
  let status = 'In Transit', statusType = 'UD', awb = '12345', scanTime = '2026-10-12T10:00:00', calls = 0;
  const carrierFetch = async () => {
    calls++;
    return new Response(JSON.stringify({ ShipmentData: [{ Shipment: {
      AWB: awb, Status: { Status: status, StatusType: statusType, StatusLocation: 'Delhi', StatusDateTime: scanTime },
      Scans: [{ ScanDetail: { Scan: status, ScanType: statusType, ScannedLocation: 'Delhi', ScanDateTime: scanTime } }],
    } }] }));
  };
  globalThis.fetch = carrierFetch;
  assert.equal(await syncDueCarrierOrders(), 1);
  assert.equal((await query('SELECT status FROM orders WHERE id=$1', [order])).rows[0].status, 'shipped');
  assert.equal(await syncDueCarrierOrders(), 0, 'lease/cadence prevents immediate repeat');
  await syncOrderFromCarrierWebsite(order);
  assert.equal((await query('SELECT count(*)::int n FROM order_fulfilment_events')).rows[0].n, 1, 'unchanged scans do not grow history');
  for (const [id, role, url] of [[customer, 'customer', '/api/orders'], [admin, 'admin', '/api/admin/orders']]) {
    const response = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer ' + app.jwt.sign({ id, role, email: role + '@example.com', name: role }) } });
    assert.equal(response.statusCode, 200, response.body);
    const item = (role === 'admin' ? response.json().data : response.json())[0];
    assert.equal(item.tracking_data.rawPortalStatus, status);
    assert.equal(item.carrier, 'Delhivery');
    assert.equal(item.status, 'shipped');
  }
  awb = 'wrong-awb';
  await assert.rejects(fetchCarrierWebsiteTracking('12345', 'Delhivery'), /CARRIER_SHIPMENT_MISMATCH/);
  awb = '12345'; status = 'Delivered'; statusType = 'RT';
  await syncOrderFromCarrierWebsite(order);
  assert.equal((await query('SELECT status FROM orders WHERE id=$1', [order])).rows[0].status, 'shipped', 'reverse delivery is not customer delivery');
  scanTime = '2026-10-11T10:00:00'; statusType = 'DL';
  await assert.rejects(syncOrderFromCarrierWebsite(order), /CARRIER_STALE_RESPONSE/);
  scanTime = '2026-10-12T11:00:00';
  globalThis.fetch = async () => new Response('{}', { status: 429 });
  await query("UPDATE orders SET tracking_next_check_at=NOW()-INTERVAL '1 second' WHERE id=$1", [order]);
  await syncDueCarrierOrders();
  const failed = (await query('SELECT * FROM orders WHERE id=$1', [order])).rows[0];
  assert.equal(failed.tracking_error, 'CARRIER_RATE_LIMITED');
  assert.equal(failed.tracking_failures, 1);
  assert.ok(failed.tracking_data, 'failure preserves last verified data');
  assert.ok(new Date(failed.tracking_next_check_at) > new Date());
  assert.equal(retryDelaySeconds(100), 3600);
  globalThis.fetch = carrierFetch;
  await syncOrderFromCarrierWebsite(order);
  const delivered = (await query('SELECT * FROM orders WHERE id=$1', [order])).rows[0];
  assert.equal(delivered.status, 'delivered');
  assert.equal(delivered.tracking_error, null);
  assert.equal(delivered.tracking_failures, 0);
  assert.equal(delivered.payment_status, 'pending', 'tracking must not mark COD as paid');
  await query("UPDATE orders SET tracking_next_check_at=NOW()-INTERVAL '1 second' WHERE id=$1", [order]);
  assert.equal(await syncDueCarrierOrders(), 0, 'delivered orders leave the tracking queue');
  await query("UPDATE orders SET tracking_number='67890' WHERE id=$1", [order]);
  const reset = (await query('SELECT * FROM orders WHERE id=$1', [order])).rows[0];
  assert.equal(reset.tracking_data, null);
  assert.equal(reset.tracking_error, null);
  delete process.env.DELHIVERY_API_TOKEN;
  assert.equal(await syncDueCarrierOrders(), 0);
  assert.ok(calls >= 4);
});
