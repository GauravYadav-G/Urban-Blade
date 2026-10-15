import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('customer rescheduling enforces ownership, future availability and immutable booking details', async t => {
  const db = new PGlite();
  const { pool } = await import('../dist/db/pool.js');
  const { redis } = await import('../dist/redis/client.js');
  redis.disconnect();
  await db.exec((await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, ''));
  await db.exec(`CREATE UNIQUE INDEX test_active_stylist ON bookings(stylist_id,booking_date,time_slot) WHERE status!='cancelled'`);
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  const { buildApp } = await import('../dist/app.js');
  const app = await buildApp();
  t.after(async () => { await app.close(); await pool.end(); await db.close(); });
  const alice = '11111111-1111-4111-8111-111111111111';
  const bob = '22222222-2222-4222-8222-222222222222';
  const stylist = '33333333-3333-4333-8333-333333333333';
  const booking = '44444444-4444-4444-8444-444444444444';
  const other = '55555555-5555-4555-8555-555555555555';
  await query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,'alice@test.invalid','Alice','unused'),($2,'bob@test.invalid','Bob','unused')`, [alice, bob]);
  await query(`INSERT INTO stylists(id,name,role,avatar_url) VALUES($1,'Studio assignment','Senior stylist','')`, [stylist]);
  await query(`INSERT INTO bookings(id,customer_name,customer_email,customer_phone,stylist_id,booking_date,time_slot,visit_type,service_address,status,total_price,notes)
    VALUES($1,'Alice','alice@test.invalid','9811223344',$2,'2099-10-20','10:00 AM','home','12 Private Street','confirmed',549.50,'Haircut'),
          ($3,'Bob','bob@test.invalid','9811223344',$2,'2099-10-21','11:00 AM','salon',NULL,'confirmed',499,'Haircut')`, [booking, stylist, other]);
  const headers = (id = alice, role = 'customer') => ({ authorization: `Bearer ${app.jwt.sign({ id, role,
    email: id === alice ? 'alice@test.invalid' : 'bob@test.invalid', name: 'Customer' })}` });
  const body = { bookingDate: '2099-10-21', timeSlot: '02:00 PM', expectedDate: '2099-10-20', expectedTimeSlot: '10:00 AM' };
  const put = (payload = body, id = alice, role = 'customer', target = booking) => app.inject({ method: 'PUT', url: `/api/bookings/${target}/schedule`, payload, headers: headers(id, role) });
  assert.equal((await app.inject({ method: 'PUT', url: `/api/bookings/${booking}/schedule`, payload: body })).statusCode, 401);
  assert.equal((await put(body, bob)).statusCode, 404);
  assert.equal((await put(body, alice, 'vendor')).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `/api/bookings/${booking}/available-slots?date=2099-10-21`, headers: headers(bob) })).statusCode, 404);
  for (const invalid of [{ ...body, bookingDate: '2099-02-30' }, { ...body, bookingDate: '2000-01-01' }, { ...body, timeSlot: '11:00 PM' }, { ...body, totalPrice: 1 }, { ...body, stylistId: stylist }]) {
    assert.equal((await put(invalid)).statusCode, 400);
  }
  const availability = await app.inject({ method: 'GET', url: `/api/bookings/${booking}/available-slots?date=2099-10-21`, headers: headers() });
  assert.equal(availability.statusCode, 200, availability.body);
  assert.equal(availability.json().availableSlots.includes('11:00 AM'), false);
  assert.equal(availability.json().availableSlots.includes('02:00 PM'), true);
  assert.equal('stylist_id' in availability.json(), false);
  assert.equal((await put({ ...body, timeSlot: '11:00 AM' })).statusCode, 409);
  assert.equal((await put({ ...body, expectedDate: '2099-10-19' })).statusCode, 409);
  const success = await put();
  assert.equal(success.statusCode, 200, success.body);
  assert.equal(success.json().booking_date, '2099-10-21');
  assert.equal(success.json().time_slot, '02:00 PM');
  const saved = (await query('SELECT * FROM bookings WHERE id=$1', [booking])).rows[0];
  assert.equal(saved.stylist_id, stylist);
  assert.equal(Number(saved.total_price), 549.50);
  assert.equal(saved.service_address, '12 Private Street');
  assert.equal(saved.visit_type, 'home');
  assert.equal(saved.version, 1);
  const history = await app.inject({ method: 'GET', url: '/api/bookings', headers: headers() });
  assert.equal(history.json().length, 1);
  assert.equal(history.json()[0].time_slot, '02:00 PM');
  assert.equal((await put()).statusCode, 409); // stale replay cannot move a newer schedule
  await query("UPDATE bookings SET status='completed' WHERE id=$1", [booking]);
  assert.equal((await put({ ...body, expectedDate: '2099-10-21', expectedTimeSlot: '02:00 PM' })).statusCode, 409);
});
