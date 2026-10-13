import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('customer address books persist across sessions and isolate ownership', async t => {
  const db = new PGlite();
  const { pool } = await import('../dist/db/pool.js');
  const { redis } = await import('../dist/redis/client.js');
  redis.disconnect();
  const schema = (await readFile(new URL('../src/db/schema.sql', import.meta.url), 'utf8')).replace(/^CREATE EXTENSION[^;]+;/gm, '');
  await db.exec(schema);
  await db.exec(schema); // additive migration remains safe to rerun
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
  await query(`INSERT INTO users(id,email,name,password_hash) VALUES($1,'alice@test.invalid','Alice','unused'),($2,'bob@test.invalid','Bob','unused')`, [alice, bob]);
  const auth = id => ({ authorization: `Bearer ${app.jwt.sign({ id, email: `${id}@test.invalid`, name: 'Customer', role: 'customer' })}` });
  const req = (method, url, payload, id = alice) => app.inject({ method, url, payload, headers: auth(id) });
  const draft = { fullName: 'Alice Customer', mobile: '9811223344', house: 'Flat 12', street: 'Example Street', landmark: 'Near park', city: 'Delhi', state: 'Delhi', pinCode: '110001', isDefault: false, location: { lat: 28.6, lng: 77.2, label: 'Delhi' } };
  assert.equal((await app.inject({ method: 'GET', url: '/api/account/addresses' })).statusCode, 401);
  for (const invalid of [{ ...draft, userId: bob }, { ...draft, mobile: 'abc' }, { ...draft, pinCode: '000000' }]) {
    assert.equal((await req('POST', '/api/account/addresses', invalid)).statusCode, 400);
  }
  const first = await req('POST', '/api/account/addresses', draft);
  assert.equal(first.statusCode, 201, first.body);
  const home = first.json()[0];
  assert.equal(home.isDefault, true);
  assert.equal(home.house, 'Flat 12');
  assert.deepEqual(home.location, draft.location);
  // A new token represents another device; no browser storage is involved.
  const anotherDevice = await req('GET', '/api/account/addresses');
  assert.deepEqual(anotherDevice.json(), [home]);
  assert.deepEqual((await req('GET', '/api/account/addresses', undefined, bob)).json(), []);
  for (const [method, suffix, payload] of [['PUT', '', draft], ['DELETE', '', undefined], ['PATCH', '/default', {}]]) {
    assert.equal((await req(method, `/api/account/addresses/${home.id}${suffix}`, payload, bob)).statusCode, 404);
  }
  assert.equal((await req('POST', '/api/account/addresses', { ...draft, id: home.id }, bob)).statusCode, 404);
  const second = await req('POST', '/api/account/addresses', { ...draft, house: 'Office 7', isDefault: true });
  const office = second.json().find(address => address.id !== home.id);
  assert.equal(second.json().filter(address => address.isDefault).length, 1);
  assert.equal(office.isDefault, true);
  const edited = await req('PUT', `/api/account/addresses/${home.id}`, { ...draft, street: 'Updated Street', isDefault: true });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().find(address => address.id === home.id).street, 'Updated Street');
  // Retrying a local migration preserves the customer's newer server edit.
  const legacyRetry = await req('POST', '/api/account/addresses', { ...draft, id: home.id });
  assert.equal(legacyRetry.json().length, 2);
  assert.equal(legacyRetry.json().find(address => address.id === home.id).street, 'Updated Street');
  const defaultChange = await req('PATCH', `/api/account/addresses/${office.id}/default`, {});
  assert.equal(defaultChange.json().filter(address => address.isDefault).length, 1);
  const removed = await req('DELETE', `/api/account/addresses/${office.id}`);
  assert.equal(removed.json()[0].isDefault, true);
  assert.equal((await req('DELETE', `/api/account/addresses/${home.id}`)).json().length, 0);
  assert.equal((await req('GET', '/api/account/addresses')).json().length, 0);
});
