import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import fastify from 'fastify';
import jwt from '@fastify/jwt';
import { pool } from '../dist/db/pool.js';
import { redis } from '../dist/redis/client.js';
import { stylistsRoutes } from '../dist/modules/admin/stylists.routes.js';
import { bookingsRoutes } from '../dist/modules/bookings/bookings.routes.js';

// Permanent deletion is exercised only against this disposable database.
test('Stylist archive and permanent deletion preserve appointments and enforce admin confirmation', async t => {
  redis.disconnect();
  const db = new PGlite();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  await db.exec(schema);
  await db.exec(await readFile(new URL('../src/db/indexes.sql', import.meta.url), 'utf8'));
  const query = async (sql, params = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  };
  pool.query = query;
  pool.connect = async () => ({ query, release() {} });
  const app = fastify({ logger: false });
  await app.register(jwt, { secret: randomUUID() });
  await app.register(stylistsRoutes, { prefix: '/api' });
  await app.register(bookingsRoutes, { prefix: '/api' });
  t.after(async () => { await app.close(); await pool.end(); await db.close(); });
  const adminId = randomUUID(), customerId = randomUUID(), vendorId = randomUUID(), staffId = randomUUID();
  await query(`INSERT INTO users(id,email,name,password_hash,role) VALUES
    ($1,'delete-admin@example.invalid','Deletion Admin','unused','admin'),
    ($2,'delete-customer@example.invalid','Booking Customer','unused','customer'),
    ($3,'delete-vendor@example.invalid','Deletion Vendor','unused','vendor'),
    ($4,'delete-staff@example.invalid','Staff Account','unused','stylist')`, [adminId, customerId, vendorId, staffId]);
  await query(`INSERT INTO vendors(id,name,slug,email,password,contact_person,phone,status)
    VALUES('stylist-delete-vendor','Deletion Vendor','stylist-delete-vendor','delete-vendor@example.invalid','unused','Fixture','9999999999','active')`);
  const auth = (role = 'admin') => {
    const user = {
      admin: { id: adminId, email: 'delete-admin@example.invalid' },
      customer: { id: customerId, email: 'delete-customer@example.invalid' },
      vendor: { id: vendorId, email: 'delete-vendor@example.invalid' },
      stylist: { id: staffId, email: 'delete-staff@example.invalid' },
    }[role];
    return { authorization: `Bearer ${app.jwt.sign({ ...user, name: 'Fixture', role })}` };
  };
  const req = (method, url, payload, role = 'admin') => app.inject({ method, url, payload, headers: auth(role) });
  const path = id => `/api/admin/stylists/${id}/permanent`;
  const remove = (stylist, role = 'admin', confirmationName = stylist.name) => req('DELETE', path(stylist.id), { confirmationName }, role);
  const fixture = async (name, active = true) => {
    const id = randomUUID();
    await query("INSERT INTO stylists(id,name,role,avatar_url,is_active) VALUES($1,$2,'Senior Stylist','',$3)", [id, name, active]);
    return { id, name };
  };
  const appointment = async (stylist, status = 'confirmed', visitType = 'salon', version = 0) => {
    const id = randomUUID();
    await query(`INSERT INTO bookings(id,user_id,customer_name,customer_email,customer_phone,stylist_id,
      booking_date,time_slot,status,total_price,notes,visit_type,service_address,version)
      VALUES($1,$2,'Booking Customer','delete-customer@example.invalid','9999999999',$3,
      '2026-11-01',$4,$5,1499.50,'Hair service fixture',$6,$7,$8)`,
    [id, customerId, stylist.id, `${Math.floor(Math.random() * 99999)}-${id.slice(0, 5)}`, status, visitType,
      visitType === 'home' ? '15 Market Road, Noida' : null, version]);
    return (await query('SELECT * FROM bookings WHERE id=$1', [id])).rows[0];
  };
  const stylistExists = async id => (await query('SELECT * FROM stylists WHERE id=$1', [id])).rows[0];
  let archived;

  await t.test('Archive remains reversible and preserves stylist assignment history', async () => {
    archived = await fixture('Archived Fixture Stylist');
    const booking = await appointment(archived, 'completed', 'home', 3);
    const result = await req('DELETE', `/api/admin/stylists/${archived.id}`);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().archived, true);
    assert.equal((await stylistExists(archived.id)).is_active, false);
    const after = (await query('SELECT * FROM bookings WHERE id=$1', [booking.id])).rows[0];
    assert.equal(after.stylist_id, archived.id);
    assert.equal(after.version, 3);
    const joined = (await query('SELECT s.name FROM bookings b LEFT JOIN stylists s ON s.id=b.stylist_id WHERE b.id=$1', [booking.id])).rows[0];
    assert.equal(joined.name, archived.name);
  });

  await t.test('Permanent deletion requires authenticated master admin privileges', async () => {
    const stylist = await fixture('Authorization Fixture Stylist');
    assert.equal((await app.inject({ method: 'DELETE', url: path(stylist.id), payload: { confirmationName: stylist.name } })).statusCode, 401);
    for (const role of ['customer', 'vendor', 'stylist']) {
      assert.equal((await remove(stylist, role)).statusCode, 403, role);
      assert.ok(await stylistExists(stylist.id));
    }
  });

  await t.test('Invalid IDs, missing names, excessive names and unknown body fields are rejected', async () => {
    const stylist = await fixture('Validation Fixture Stylist');
    assert.equal((await req('DELETE', path('not-a-uuid'), { confirmationName: stylist.name })).statusCode, 400);
    for (const payload of [undefined, {}, null, [], { confirmationName: '' },
      { confirmationName: 'x'.repeat(256) }, { confirmationName: 42 },
      { confirmationName: stylist.name, force: true }, { name: stylist.name }]) {
      const result = await req('DELETE', path(stylist.id), payload);
      assert.equal(result.statusCode, 400, JSON.stringify(payload));
      assert.ok(await stylistExists(stylist.id));
    }
    const malformed = await app.inject({ method: 'DELETE', url: path(stylist.id), headers: { ...auth(), 'content-type': 'application/json' }, payload: '{bad json' });
    assert.equal(malformed.statusCode, 400);
  });

  await t.test('Exact current-name confirmation protects against mistaken deletion and stale renamed cards', async () => {
    const stylist = await fixture('Confirmation Fixture Stylist');
    await appointment(stylist);
    for (const name of ['Other Stylist', 'x', stylist.name.toLowerCase()]) {
      const result = await remove(stylist, 'admin', name);
      assert.equal(result.statusCode, 409, result.body);
      assert.equal(result.json().error, 'STYLIST_CONFIRMATION_MISMATCH');
      assert.ok(await stylistExists(stylist.id));
    }
    await query('UPDATE stylists SET name=$2 WHERE id=$1', [stylist.id, 'Renamed Fixture Stylist']);
    assert.equal((await remove(stylist)).statusCode, 409);
    assert.ok(await stylistExists(stylist.id));
    assert.equal((await query('SELECT stylist_id FROM bookings WHERE stylist_id=$1', [stylist.id])).rows[0].stylist_id, stylist.id);
  });

  await t.test('Deleting active stylist preserves every appointment field and increments affected versions', async () => {
    const active = await fixture('Active Deletion Fixture Stylist');
    const unrelated = await fixture('Unrelated Fixture Stylist');
    const unaffected = await appointment(unrelated, 'confirmed', 'salon', 4);
    const bookings = [];
    for (const [status, visitType, version] of [
      ['pending', 'home', 0], ['confirmed', 'salon', 1], ['completed', 'home', 2], ['cancelled', 'salon', 3],
    ]) bookings.push(await appointment(active, status, visitType, version));
    const totalBefore = (await query('SELECT COUNT(*)::int AS count FROM bookings')).rows[0].count;
    const result = await remove(active);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().ok, true);
    assert.equal(result.json().deleted, true);
    assert.equal(result.json().id, active.id);
    assert.equal(result.json().unassignedBookings, 4);
    assert.equal(await stylistExists(active.id), undefined);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM bookings')).rows[0].count, totalBefore);
    for (const before of bookings) {
      const after = (await query('SELECT * FROM bookings WHERE id=$1', [before.id])).rows[0];
      assert.equal(after.stylist_id, null);
      assert.equal(after.version, before.version + 1);
      const { stylist_id: beforeStylist, version: beforeVersion, ...originalFields } = before;
      const { stylist_id: afterStylist, version: afterVersion, ...remainingFields } = after;
      assert.deepEqual(remainingFields, originalFields);
      assert.equal((await query('SELECT s.name AS stylist_name FROM bookings b LEFT JOIN stylists s ON s.id=b.stylist_id WHERE b.id=$1', [before.id])).rows[0].stylist_name, null);
    }
    assert.deepEqual((await query('SELECT * FROM bookings WHERE id=$1', [unaffected.id])).rows[0], unaffected);
    const customerHistory = await req('GET', '/api/bookings', undefined, 'customer');
    assert.equal(customerHistory.statusCode, 200, customerHistory.body);
    for (const booking of bookings) {
      const row = customerHistory.json().find(candidate => candidate.id === booking.id);
      assert.ok(row);
      assert.equal(row.stylist_name, null);
      assert.equal(row.status, booking.status);
      assert.equal(Number(row.total_price), Number(booking.total_price));
    }
    assert.equal((await remove(active)).statusCode, 404);
  });

  await t.test('Archived stylist can be permanently deleted without deleting its historical appointment', async () => {
    const result = await remove(archived);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().unassignedBookings, 1);
    assert.equal(await stylistExists(archived.id), undefined);
    const history = (await query("SELECT stylist_id,version,status,total_price FROM bookings WHERE status='completed' AND version=4")).rows;
    assert.ok(history.some(booking => booking.stylist_id === null && Number(booking.total_price) === 1499.5));
  });

  await t.test('Deleted name can be re-added with a new identity and no historical reassignment', async () => {
    const name = archived.name;
    const before = (await query('SELECT COUNT(*)::int AS count FROM bookings WHERE stylist_id IS NULL')).rows[0].count;
    const result = await req('POST', '/api/admin/stylists', { name, role: 'Stylist', is_active: true });
    assert.equal(result.statusCode, 201, result.body);
    assert.notEqual(result.json().id, archived.id);
    assert.equal(result.json().name, name);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM bookings WHERE stylist_id IS NULL')).rows[0].count, before);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM bookings WHERE stylist_id=$1', [result.json().id])).rows[0].count, 0);
  });

  await t.test('Roster removal does not delete separate stylist-role login accounts or expose public roster', async () => {
    const stylist = await fixture('Staff Account');
    const result = await remove(stylist, 'admin', '  Staff Account  ');
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().unassignedBookings, 0);
    assert.equal((await query('SELECT role FROM users WHERE id=$1', [staffId])).rows[0].role, 'stylist');
    assert.deepEqual((await app.inject({ method: 'GET', url: '/api/bookings/stylists' })).json(), []);
    assert.equal((await req('DELETE', path(randomUUID()), { confirmationName: 'Missing Stylist' })).statusCode, 404);
    const legacy = await fixture('Z', null);
    const directory = await req('GET', '/api/admin/stylists');
    assert.equal(directory.statusCode, 200);
    assert.equal(directory.json().data.find(record => record.id === legacy.id).is_active, false);
    assert.equal((await remove(legacy)).statusCode, 200);
    assert.equal(await stylistExists(legacy.id), undefined);
  });

  await t.test('A failure after unassignment rolls back deletion and returns safe actionable error', async () => {
    const stylist = await fixture('Rollback Fixture Stylist');
    const booking = await appointment(stylist, 'confirmed', 'home', 5);
    await db.exec(`CREATE OR REPLACE FUNCTION reject_fixture_stylist_delete() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'private deletion SQL fixture'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_fixture_stylist_delete BEFORE DELETE ON stylists
      FOR EACH ROW EXECUTE FUNCTION reject_fixture_stylist_delete();`);
    try {
      const result = await remove(stylist);
      assert.equal(result.statusCode, 503, result.body);
      assert.equal(result.json().error, 'STYLIST_DELETION_UNAVAILABLE');
      assert.ok(!result.body.includes('private deletion SQL fixture'));
      assert.ok(await stylistExists(stylist.id));
      assert.deepEqual((await query('SELECT * FROM bookings WHERE id=$1', [booking.id])).rows[0], booking);
    } finally {
      await db.exec('DROP TRIGGER reject_fixture_stylist_delete ON stylists; DROP FUNCTION reject_fixture_stylist_delete();');
    }
  });
});
