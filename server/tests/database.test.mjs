import { PGlite } from '@electric-sql/pglite';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
test('production checkout persists atomically without Redis and enforces API boundaries', async (t) => {
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const db = new PGlite();
t.after(() => db.close());
const schema=(await fs.readFile(root+'/server/src/db/schema.sql','utf8')).replace(/^CREATE EXTENSION[^;]+;/gm,'');
await db.exec(schema); await db.exec(schema);
await db.exec(await fs.readFile(root+'/server/src/db/indexes.sql','utf8'));
const mod = p => import(pathToFileURL(root+'/server/dist/'+p));
const {pool}=await mod('db/pool.js'); const {redis}=await mod('redis/client.js'); redis.disconnect();
const query=async (sql,params=[]) => { const r=await db.query(sql,params); return {rows:r.rows,rowCount:r.rows.length || r.affectedRows || 0}; };
pool.query=query; pool.connect=async()=>({query,release(){}});
const {config}=await mod('config.js'); config.isProduction=true;
const {buildApp}=await mod('app.js'); const app=await buildApp();
t.after(async () => { await app.close(); await pool.end(); });
const customer='11111111-1111-4111-8111-111111111111',admin='22222222-2222-4222-8222-222222222222', product='33333333-3333-4333-8333-333333333333';
await query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'buyer@example.com','Buyer','unused','customer'),($2,'admin@example.com','Admin','unused','admin')",[customer,admin]);
await query("INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity,in_stock) VALUES($1,'test-serum','Test Serum','Test',500,'hair','retail','Urban Blade Lab','unisex','/images/placeholder.svg',10,true)",[product]);
const headers=who=>({authorization:'Bearer '+app.jwt.sign({id:who,email:who===admin?'admin@example.com':'buyer@example.com',name:'Test',role:who===admin?'admin':'customer'})});
let checked=0;
async function req(method,url,payload,who=customer,key){const r=await app.inject({method,url,payload,headers:{...headers(who),...(key?{'x-idempotency-key':key}:{})}});return r;}
const cors=await app.inject({method:'OPTIONS',url:'/api/auth/register',headers:{origin:'https://urban-blade.vercel.app','access-control-request-method':'POST','access-control-request-headers':'content-type,authorization,x-idempotency-key'}});assert.equal(cors.statusCode,204);assert.equal(cors.headers['access-control-allow-origin'],'https://urban-blade.vercel.app');checked++;
for(const url of ['/api/support/inquiries','/api/bookings?email=buyer@example.com']){assert.equal((await app.inject({method:'GET',url})).statusCode,401);checked++;}
const coupon=await req('POST','/api/admin/coupons',{code:'TEST10',discountType:'percentage',discountValue:10,minOrderValue:0,isActive:true,description:'Test'},admin);assert.equal(coupon.statusCode,200,coupon.body);checked++;
const items=[{productId:product,quantity:1}];
const quote=await req('POST','/api/orders/quote',{items,couponCode:'TEST10'});assert.equal(quote.json().totalAmount,549);checked++;
const payload={items,couponCode:'TEST10',expectedTotal:549,shippingAddress:{fullName:'Buyer Test',phone:'9999999999',street:'123 Test Street',city:'Delhi',state:'Delhi',postalCode:'110001'}};
const order=await req('POST','/api/orders/cod-order',payload,customer,'cod-production-test');assert.equal(order.statusCode,201,order.body);assert.equal(order.json().paymentId,'');checked++;
const retry=await req('POST','/api/orders/cod-order',payload,customer,'cod-production-test');assert.equal(retry.json().orderId,order.json().orderId);assert.equal((await query('SELECT COUNT(*)::int n FROM orders')).rows[0].n,1);checked++;
assert.equal((await query('SELECT stock_quantity,stock_reserved FROM products')).rows[0].stock_quantity,9);assert.equal((await query('SELECT status FROM stock_reservations')).rows[0].status,'committed');checked++;
const cancellation=await req('PUT',`/api/admin/orders/${order.json().orderId}/status`,{status:'cancelled'},admin);assert.equal(cancellation.statusCode,200,cancellation.body);assert.equal((await query('SELECT stock_quantity FROM products')).rows[0].stock_quantity,10);checked++;
const invalid=await req('POST','/api/orders/cod-order',{...payload,expectedTotal:1},customer,'retry-failure');assert.equal(invalid.statusCode,409,invalid.body);assert.equal((await query("SELECT COUNT(*)::int n FROM checkout_requests WHERE key LIKE '%' ")).rows[0].n,1);checked++;
const recover=await req('POST','/api/orders/cod-order',payload,customer,'retry-failure');assert.equal(recover.statusCode,201,recover.body);checked++;
const cartBad=await req('POST','/api/auth/cart',{items:[{productId:product,qty:1.5}]});assert.equal(cartBad.statusCode,400);checked++;
// Missing settings table during a rolling deployment uses defaults, not a raw SQL error.
await query('ALTER TABLE site_settings RENAME TO settings_migration_test');
const defaults = await req('POST','/api/orders/quote',{items});
assert.equal(defaults.statusCode,200,defaults.body); assert.equal(defaults.json().totalAmount,599); checked++;
await query('ALTER TABLE settings_migration_test RENAME TO site_settings');
// Persisted tax/shipping settings govern quote totals.
await query("INSERT INTO site_settings(id,value) VALUES('main',$1)",[JSON.stringify({ecommerce:{freeShippingEnabled:false,standardShippingFee:25,taxInclusive:false,taxRatePercent:10}})]);
assert.equal((await req('POST','/api/orders/quote',{items})).json().totalAmount,575); checked++;
// All customer ticket reads are tied to the verified account, never the query email.
await query("INSERT INTO support_inquiries(id,user_name,user_email,subject) VALUES('private-ticket','Other Buyer','other@example.com','Private')");
assert.equal((await req('GET','/api/support/inquiries/private-ticket')).statusCode,404);
assert.equal((await req('DELETE','/api/support/inquiries/private-ticket')).statusCode,403);
assert.equal((await req('GET','/api/support/inquiries?email=%25')).json().data.length,0);checked++;
// A vendor whose name is a prefix cannot change another vendor's product.
const vendor='55555555-5555-4555-8555-555555555555';
const vendorHeaders={authorization:'Bearer '+app.jwt.sign({id:vendor,email:'vendor@example.com',name:'Urban Blade',vendorName:'Urban Blade',role:'vendor'})};
assert.equal((await app.inject({method:'PUT',url:'/api/admin/products/'+product,headers:vendorHeaders,payload:{price:1}})).statusCode,403);checked++;
// Real SQL settlement: no double inventory decrement for duplicate notifications.
const {settleCapturedPayment}=await mod('modules/orders/payment-settlement.service.js');
const {reserveStock}=await mod('modules/orders/stock-reservation.service.js');
const online='66666666-6666-4666-8666-666666666666';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,shipping_fee,total_amount,currency,shipping_address,payment_method,payment_status) VALUES($1,$2,'order_fixture','accepted',500,99,599,'INR','{}','Razorpay','pending')",[online,customer]);
await reserveStock({query},online,[{productId:product,quantity:1}]);
const gateway={payments:{fetch:async()=>({id:'pay_fixture',order_id:'order_fixture',status:'captured',amount:59900,currency:'INR'})}};
await settleCapturedPayment('pay_fixture',online,gateway);
const stockAfter=(await query('SELECT stock_quantity FROM products')).rows[0].stock_quantity;
await settleCapturedPayment('pay_fixture',online,gateway);
assert.equal((await query('SELECT stock_quantity FROM products')).rows[0].stock_quantity,stockAfter);checked++;
await assert.rejects(settleCapturedPayment('pay_fixture',online,{payments:{fetch:async()=>({id:'pay_fixture',order_id:'order_fixture',status:'captured',amount:1,currency:'INR'})}}),/PAYMENT_NOT_CAPTURED/);checked++;
// Gateway outage is never treated as proof an expired hold is unpaid.
const stale='77777777-7777-4777-8777-777777777777';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,shipping_fee,total_amount,currency,shipping_address,payment_method,payment_status,created_at) VALUES($1,$2,'order_expired_fixture','accepted',500,99,599,'INR','{}','Razorpay','pending',NOW()-INTERVAL '1 hour')",[stale,customer]);
await reserveStock({query},stale,[{productId:product,quantity:1}]);
const {reapAbandonedCheckouts}=await mod('modules/orders/abandoned-checkout.reaper.js');
await reapAbandonedCheckouts(()=>({orders:{fetchPayments:async()=>{throw new Error('gateway offline');}}}));
assert.equal((await query('SELECT status FROM orders WHERE id=$1',[stale])).rows[0].status,'accepted'); checked++;
await reapAbandonedCheckouts(()=>({orders:{fetchPayments:async()=>({items:[]})}}));
assert.equal((await query('SELECT status FROM orders WHERE id=$1',[stale])).rows[0].status,'cancelled'); checked++;
// A late captured payment after expiry reacquires inventory and settles once.
await settleCapturedPayment('pay_late',stale,{payments:{fetch:async()=>({id:'pay_late',order_id:'order_expired_fixture',status:'captured',amount:59900,currency:'INR'})}});
assert.equal((await query('SELECT payment_status FROM orders WHERE id=$1',[stale])).rows[0].payment_status,'captured'); checked++;
const denied=await app.inject({method:'OPTIONS',url:'/api/auth/register',headers:{origin:'https://evilurbanblade.shop','access-control-request-method':'POST'}});
assert.equal(denied.headers['access-control-allow-origin'],undefined);checked++;
const privateAi=await app.inject({method:'POST',url:'/api/support/ai-chat',payload:{userEmail:'buyer@example.com',message:'cancel my order'}});
assert.equal(privateAi.statusCode,401);checked++;
// Matching email text does not grant access to another customer's order.
const other='88888888-8888-4888-8888-888888888888';
await query("INSERT INTO users(id,email,name,password_hash,role) VALUES($1,'other@example.com','Other','unused','customer')",[other]);
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,shipping_fee,total_amount,currency,shipping_address,payment_method,payment_status) VALUES(gen_random_uuid(),$1,'other_order','confirmed',500,99,599,'INR','{}','Cash on Delivery','pending')",[other]);
const {generateAiReply}=await mod('modules/support/support.routes.js');
const ai=await generateAiReply({userId:customer,userEmail:'other@example.com',orderId:'other_order',message:'cancel my order'});
assert.notEqual(ai.operation?.type,'order_cancelled');checked++;
console.log(`PASS: schema applied twice, indexes applied, ${checked} API/database assertions (production mode, Redis disconnected).`);

});
