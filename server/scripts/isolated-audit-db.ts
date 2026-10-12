import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { pool } from '../src/db/pool.js';
import { redis } from '../src/redis/client.js';
import { config } from '../src/config.js';

/** Audit scripts always use a disposable database; never mutate configured business data. */
export async function isolatedAuditDatabase() {
  const db = new PGlite();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  await db.exec(await readFile(new URL('../src/db/indexes.sql', import.meta.url), 'utf8'));
  redis.disconnect();
  config.razorpay.keyId = '';
  config.razorpay.keySecret = '';
  const query = async (sql: string, params: unknown[] = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  // Match the pg adapter used by database.test.mjs.
  pool.query = query as typeof pool.query;
  pool.connect = (async () => ({ query, release() {} })) as typeof pool.connect;
  const endPool = pool.end.bind(pool);
  pool.end = (async () => { await db.close(); await endPool(); }) as typeof pool.end;
  await query(`INSERT INTO users(id,name,email,password_hash,role) VALUES
    ('cf32923e-e498-407c-93d5-8d8cef913979','Audit Admin','admin@urbanblade.in','unused','admin'),
    ('a0000000-0000-0000-0000-000000000001','Test Customer','test.customer@urbanblade.in','unused','customer')`);
  await query(`INSERT INTO vendors(id,name,slug,email,password,contact_person,phone) VALUES
    ('vnd-urban-blade-salon','Urban Blade Salon Partner','urban-blade-salon','vendor@urbanblade.in','unused','Audit Vendor','9999999999')`);
  await query(`INSERT INTO products(slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity)
    VALUES('audit-product','Audit Product','Disposable test fixture',500,'hair','retail','Urban Blade Salon Partner','unisex','/images/placeholder.svg',10)`);
  // Deterministic provider fixture: no external service calls or invented production state.
  process.env.DELHIVERY_API_TOKEN='isolated-test-token';
  globalThis.fetch = async (input) => new Response(JSON.stringify({ ShipmentData: [{ Shipment: {
    AWB: new URL(String(input)).searchParams.get('waybill'),
    Status: { Status: 'Delivered', StatusLocation: 'Test destination', StatusDateTime: new Date().toISOString() }, Scans: [],
  } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}
