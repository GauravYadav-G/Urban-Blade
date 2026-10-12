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
const repeatedCancellation=await req('PUT',`/api/admin/orders/${order.json().orderId}/status`,{status:'cancelled'},admin);assert.equal(repeatedCancellation.statusCode,200,repeatedCancellation.body);assert.equal((await query('SELECT stock_quantity FROM products')).rows[0].stock_quantity,10);checked++;
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
// Appointment operations are location-based, persist home addresses, and can
// move between the dedicated home and salon queues without a stylist record.
const homePayload={customerName:'Home Client',customerPhone:'9876543210',customerEmail:'home@example.com',bookingDate:'2026-10-20',timeSlot:'14:30',visitType:'home',totalPrice:750,notes:'Hair service'};
assert.equal((await req('POST','/api/admin/bookings',homePayload,admin)).statusCode,400);checked++;
const homeBooking=await req('POST','/api/admin/bookings',{...homePayload,serviceAddress:'12 Market Road, Noida 201301'},admin);assert.equal(homeBooking.statusCode,201,homeBooking.body);checked++;
const movedBooking=await req('PUT',`/api/admin/bookings/${homeBooking.json().id}/schedule`,{bookingDate:'2026-10-21',timeSlot:'15:00',visitType:'salon',serviceAddress:null},admin);
assert.equal(movedBooking.statusCode,200,movedBooking.body);assert.equal(movedBooking.json().visit_type,'salon');assert.equal(movedBooking.json().service_address,null);checked++;
// Real SQL settlement: no double inventory decrement for duplicate notifications.
const {settleCapturedPayment}=await mod('modules/orders/payment-settlement.service.js');
const {reserveStock}=await mod('modules/orders/stock-reservation.service.js');
const manualOnline='99999999-9999-4999-8999-999999999999';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,shipping_fee,total_amount,currency,shipping_address,payment_method,payment_status) VALUES($1,$2,'order_manual_cancel','accepted',500,99,599,'INR','{}','Razorpay','pending')",[manualOnline,customer]);
await reserveStock({query},manualOnline,[{productId:product,quantity:1}]);
const manualCancel=await req('PUT',`/api/admin/orders/${manualOnline}/status`,{status:'cancelled'},admin);assert.equal(manualCancel.statusCode,200,manualCancel.body);
await req('PUT',`/api/admin/orders/${manualOnline}/status`,{status:'cancelled'},admin);
assert.equal((await query('SELECT stock_reserved FROM products WHERE id=$1',[product])).rows[0].stock_reserved,0);checked++;
const online='66666666-6666-4666-8666-666666666666';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,shipping_fee,total_amount,currency,shipping_address,payment_method,payment_status) VALUES($1,$2,'order_fixture','accepted',500,99,599,'INR','{}','Razorpay','pending')",[online,customer]);
await reserveStock({query},online,[{productId:product,quantity:1}]);
const gateway={payments:{fetch:async()=>({id:'pay_fixture',order_id:'order_fixture',status:'captured',amount:59900,currency:'INR'})}};
await settleCapturedPayment('pay_fixture',online,gateway);
const stockAfter=(await query('SELECT stock_quantity FROM products')).rows[0].stock_quantity;
await settleCapturedPayment('pay_fixture',online,gateway);
assert.equal((await query('SELECT stock_quantity FROM products')).rows[0].stock_quantity,stockAfter);checked++;
await assert.rejects(settleCapturedPayment('pay_fixture',online,{payments:{fetch:async()=>({id:'pay_fixture',order_id:'order_fixture',status:'captured',amount:1,currency:'INR'})}}),/PAYMENT_NOT_CAPTURED/);checked++;
// Paid cancellation creates one gateway refund, restores stock once, and then
// reconciles the provider's asynchronous processed state.
const {initiateOrderRefund}=await mod('modules/orders/refund.service.js');
let refundCreateCount=0;
const refundGateway={payments:{
  fetchMultipleRefund:async()=>({items:[]}),
  refund:async(_paymentId,params)=>{refundCreateCount++;return {id:'rfnd_fixture',payment_id:'pay_fixture',status:'pending',amount:params.amount,receipt:params.receipt};},
  fetchRefund:async()=>({id:'rfnd_fixture',payment_id:'pay_fixture',status:'processed',amount:59900}),
}};
await initiateOrderRefund(online,'Customer requested cancellation',refundGateway);
assert.equal((await query('SELECT status, refund_status FROM orders WHERE id=$1',[online])).rows[0].status,'cancelled');checked++;
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,stockAfter+1);checked++;
await initiateOrderRefund(online,'Customer requested cancellation',refundGateway);
const refundedOrder=(await query('SELECT payment_status, refund_status FROM orders WHERE id=$1',[online])).rows[0];
assert.equal(refundedOrder.payment_status,'refunded');assert.equal(refundedOrder.refund_status,'processed');assert.equal(refundCreateCount,1);checked++;
// An expired online-payment hold gets one final verification and is then
// released even if the gateway is unavailable.
const stale='77777777-7777-4777-8777-777777777777';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,shipping_fee,total_amount,currency,shipping_address,payment_method,payment_status,created_at) VALUES($1,$2,'order_expired_fixture','accepted',500,99,599,'INR','{}','Razorpay','pending',NOW()-INTERVAL '1 hour')",[stale,customer]);
await reserveStock({query},stale,[{productId:product,quantity:1}]);
const {reapAbandonedCheckouts}=await mod('modules/orders/abandoned-checkout.reaper.js');
let finalVerificationCount=0;
await reapAbandonedCheckouts(()=>({orders:{fetchPayments:async()=>{finalVerificationCount++;throw new Error('gateway offline');}}}));
assert.equal((await query('SELECT status FROM orders WHERE id=$1',[stale])).rows[0].status,'cancelled'); checked++;
assert.equal((await query('SELECT stock_reserved FROM products WHERE id=$1',[product])).rows[0].stock_reserved,0); checked++;
await reapAbandonedCheckouts(()=>({orders:{fetchPayments:async()=>{finalVerificationCount++;return {items:[]};}}}));
assert.equal(finalVerificationCount,1); checked++;
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

// Completed refund notifications cannot regress or double-restock inventory.
const {applyRefundWebhook}=await mod('modules/orders/refund.service.js');
const stockBeforeReplay=(await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity;
await applyRefundWebhook({id:'rfnd_fixture',payment_id:'pay_fixture',status:'failed',amount:59900});
await applyRefundWebhook({id:'rfnd_fixture',payment_id:'pay_fixture',status:'pending',amount:59900});
assert.equal((await query('SELECT refund_status FROM orders WHERE id=$1',[online])).rows[0].refund_status,'processed');
await settleCapturedPayment('pay_fixture',online,gateway);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,stockBeforeReplay);checked++;
await assert.rejects(applyRefundWebhook({id:'rfnd_fixture',payment_id:'pay_fixture',status:'processed',amount:1}),/REFUND_AMOUNT_MISMATCH/);checked++;
// Timeout after provider acceptance is ambiguous: retry only reconciles, never creates twice.
let ambiguousCreates=0;
const ambiguousGateway={payments:{fetchMultipleRefund:async()=>({items:[]}),refund:async()=>{ambiguousCreates++;throw new Error('network timeout');}}};
await assert.rejects(initiateOrderRefund(stale,'Customer cancellation',ambiguousGateway),/network timeout/);
assert.equal((await query('SELECT refund_status FROM orders WHERE id=$1',[stale])).rows[0].refund_status,'pending');
await initiateOrderRefund(stale,'Customer cancellation',ambiguousGateway);
assert.equal(ambiguousCreates,1);
assert.equal((await req('PUT',`/api/admin/orders/${stale}/status`,{status:'processing'},admin)).statusCode,409);checked++;
// Validate vendor CRUD and enforce the current vendor identity on every request.
assert.equal((await req('POST','/api/admin/vendors',{name:null},admin)).statusCode,400);
const createdVendor=await req('POST','/api/admin/vendors',{name:'Urban Blade Lab',email:'vendor@example.com',password:'test-only-password-123',commissionRate:12},admin);
assert.equal(createdVendor.statusCode,201,createdVendor.body);
const vendorId=createdVendor.json().vendor.id;
assert.equal(createdVendor.json().vendor.password,undefined);
assert.equal((await req('POST','/api/admin/vendors',{name:'Urban Blade Lab',email:'vendor@example.com',password:'test-only-password-123'},admin)).statusCode,409);checked++;
const vendorRequest=(method,url,payload)=>app.inject({method,url,payload,headers:vendorHeaders});
const vendorProducts=await vendorRequest('GET','/api/admin/products?vendor=Other');
assert.equal(vendorProducts.statusCode,200,vendorProducts.body);
assert.ok(vendorProducts.json().data.every(row=>row.vendor==='Urban Blade Lab'));
for(const url of ['/api/admin/metrics','/api/admin/finance/summary','/api/admin/vendors','/api/admin/customers','/api/admin/bookings','/api/admin/tasks']) {
 assert.equal((await vendorRequest('GET',url)).statusCode,403,url);checked++;
}
assert.equal((await vendorRequest('POST',`/api/admin/orders/${online}/reconcile-payment`,{})).statusCode,403);checked++;
const secondProduct='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await query("INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity,in_stock) VALUES($1,'other-brand','Other Brand','Test',100,'hair','retail','Other Vendor','unisex','/images/placeholder.svg',10,true)",[secondProduct]);
await query("INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity) VALUES($1,$2,'Other Brand',100,1)",[recover.json().orderId,secondProduct]);
const vendorOrders=await vendorRequest('GET','/api/admin/orders?vendor=Other');
assert.equal(vendorOrders.statusCode,200,vendorOrders.body);
const scoped=vendorOrders.json().data.find(row=>row.id===recover.json().orderId);
assert.ok(scoped);assert.equal(scoped.items.length,1);assert.equal(Number(scoped.total_amount),500);checked++;
assert.equal((await vendorRequest('PUT','/api/admin/products/'+secondProduct,{price:1})).statusCode,403);checked++;
assert.equal((await req('PUT','/api/admin/vendors/'+vendorId,{status:'suspended'},admin)).statusCode,200);
assert.equal((await vendorRequest('GET','/api/admin/orders')).statusCode,403);
assert.equal((await req('PUT','/api/admin/vendors/'+vendorId,{status:'active',name:'Renamed Vendor'},admin)).statusCode,200);
assert.equal((await query('SELECT vendor FROM products WHERE id=$1',[product])).rows[0].vendor,'Renamed Vendor');checked++;
// Full-order COD return: ownership, explicit transitions, inspection, external refund.
const returnOrder=recover.json().orderId;
assert.equal((await req('POST',`/api/orders/${returnOrder}/return`,{reason:'Unwanted product'})).statusCode,409);
await query("UPDATE orders SET status='delivered' WHERE id=$1",[returnOrder]);
assert.equal((await req('POST',`/api/admin/orders/${returnOrder}/collection`,{reference:'cod-collection-001'},admin)).statusCode,200);checked++;
const summary=await req('GET','/api/admin/finance/summary',undefined,admin);
assert.equal(summary.statusCode,200,summary.body);
const balance=summary.json().vendorSettlements.find(row=>row.id===vendorId);
assert.equal(Number(balance.payable_amount),396);
const payoutPayload={vendorId,amount:100,reference:'bank-transfer-001'};
const payout=await req('POST','/api/admin/finance/process-payout',payoutPayload,admin);
assert.equal(payout.statusCode,200,payout.body);assert.equal(payout.json().disbursed,false);
assert.equal((await req('POST','/api/admin/finance/process-payout',payoutPayload,admin)).statusCode,200);
assert.equal((await query('SELECT COUNT(*)::int n FROM vendor_payouts')).rows[0].n,1);
assert.equal((await req('POST','/api/admin/finance/process-payout',{...payoutPayload,amount:1000,reference:'too-large'},admin)).statusCode,409);
assert.equal((await req('POST','/api/admin/finance/process-payout',{...payoutPayload,amount:-1},admin)).statusCode,400);checked++;
assert.equal((await req('POST',`/api/orders/${returnOrder}/return`,{reason:'Wrong size'},other)).statusCode,404);
assert.equal((await req('POST',`/api/orders/${returnOrder}/return`,{reason:'Wrong size'})).statusCode,200);
assert.equal((await req('POST',`/api/orders/${returnOrder}/return`,{reason:'Retry same return'})).statusCode,200);
assert.equal((await req('PUT',`/api/admin/orders/${returnOrder}/return`,{status:'received',note:'Inspected',restock:true},admin)).statusCode,409);
assert.equal((await req('PUT',`/api/admin/orders/${returnOrder}/return`,{status:'approved',note:'Please send items back'},customer)).statusCode,403);
assert.equal((await req('PUT',`/api/admin/orders/${returnOrder}/return`,{status:'approved',note:'Please send items back'},admin)).statusCode,200);
const beforeReturn=(await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity;
assert.equal((await req('PUT',`/api/admin/orders/${returnOrder}/return`,{status:'received',note:'Unopened, checked',restock:true},admin)).statusCode,200);
assert.equal((await req('PUT',`/api/admin/orders/${returnOrder}/return`,{status:'received',note:'Repeat',restock:true},admin)).statusCode,200);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,beforeReturn+1);
const manual=await req('POST',`/api/admin/orders/${returnOrder}/refund/manual`,{reference:'bank-refund-001',reason:'Received return'},admin);
assert.equal(manual.statusCode,200,manual.body);assert.equal(manual.json().order.payment_status,'refunded');checked++;
const history=await req('GET','/api/orders');
assert.equal(history.json().find(row=>row.id===returnOrder).return_status,'received');
// Online delivered orders require a received return; damaged goods stay out of stock.
const delivered='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,total_amount,currency,shipping_address,payment_method,payment_status,razorpay_payment_id) VALUES($1,$2,'delivered_fixture','delivered',500,500,'INR','{}','Razorpay','captured','pay_delivered')",[delivered,customer]);
await query("INSERT INTO stock_reservations(order_id,product_id,quantity,status) VALUES($1,$2,1,'committed')",[delivered,product]);
const deliveredGateway={payments:{fetchMultipleRefund:async()=>({items:[]}),refund:async()=>({id:'rfnd_delivered',payment_id:'pay_delivered',status:'processed',amount:50000})}};
await assert.rejects(initiateOrderRefund(delivered,'Return before receipt',deliveredGateway),/ORDER_ALREADY_FULFILLED/);
await req('POST',`/api/orders/${delivered}/return`,{reason:'Damaged in transit'});
await req('PUT',`/api/admin/orders/${delivered}/return`,{status:'approved',note:'Return for inspection'},admin);
const damagedReceipt=await req('PUT',`/api/admin/orders/${delivered}/return`,{status:'received',note:'Damaged, do not resell',restock:false},admin);
assert.equal(damagedReceipt.statusCode,200,damagedReceipt.body);
const beforeDamagedRefund=(await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity;
await initiateOrderRefund(delivered,'Damaged goods received',deliveredGateway);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,beforeDamagedRefund);checked++;

// Provider outages and unknown statuses cannot fabricate progress or resurrect refunds.
const {fetchCarrierWebsiteTracking, mapRawStatusToInternal, syncOrderFromCarrierWebsite}=await mod('modules/orders/carrier-portal.service.js');
const realFetch=globalThis.fetch;
const oldCarrierToken=process.env.DELHIVERY_API_TOKEN;process.env.DELHIVERY_API_TOKEN='fixture-token';
try {
 globalThis.fetch=async()=>{throw new Error('offline');};
 await assert.rejects(fetchCarrierWebsiteTracking('DLV-123','Delhivery'),/CARRIER_STATUS_UNAVAILABLE/);
 assert.throws(()=>mapRawStatusToInternal('Undelivered'),/CARRIER_STATUS_UNRECOGNIZED/);
 await query("UPDATE orders SET tracking_number='DLV-REFUNDED',carrier='Delhivery' WHERE id=$1",[online]);
 globalThis.fetch=async()=>new Response(JSON.stringify({ShipmentData:[{Shipment:{AWB:'DLV-REFUNDED',Status:{Status:'Delivered'},Scans:[]}}]}),{status:200});
 await syncOrderFromCarrierWebsite(online,'Delhivery');
 assert.equal((await query('SELECT status FROM orders WHERE id=$1',[online])).rows[0].status,'cancelled');
} finally { globalThis.fetch=realFetch;if(oldCarrierToken===undefined)delete process.env.DELHIVERY_API_TOKEN;else process.env.DELHIVERY_API_TOKEN=oldCarrierToken; }
checked++;
// Catalog edits cannot erase stock holds or delete historical order ownership.
await query('UPDATE products SET stock_reserved=1 WHERE id=$1',[secondProduct]);
const heldStock=await req('PUT','/api/admin/products/'+secondProduct,{stockQuantity:0},admin);
assert.equal(heldStock.statusCode,409,heldStock.body);
assert.equal((await query('SELECT stock_reserved FROM products WHERE id=$1',[secondProduct])).rows[0].stock_reserved,1);
assert.equal((await req('DELETE','/api/admin/products/'+product,undefined,admin)).statusCode,409);checked++;

// Counter sales use authoritative inventory and never overwrite an existing order.
const posId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const posPayload={id:posId,status:'accepted',subtotal:500,total_amount:500,payment_method:'Cash',payment_status:'captured',shipping_address:{fullName:'Counter Buyer',phone:'9999999999'},items:[{product_id:product,product_name:'Test Serum',unit_price:500,quantity:1}]};
const beforePos=(await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity;
const pos=await req('POST','/api/admin/orders',posPayload,admin);
assert.equal(pos.statusCode,201,pos.body);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,beforePos-1);
assert.equal((await req('POST','/api/admin/orders',posPayload,admin)).statusCode,409);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,beforePos-1);
assert.equal((await req('POST','/api/admin/orders',{...posPayload,id:undefined,items:[{...posPayload.items[0],quantity:1.5}]},admin)).statusCode,400);
const counterRefund=await req('POST',`/api/admin/orders/${posId}/refund/manual`,{reference:'cash-receipt-001',reason:'Refunded at counter'},admin);
assert.equal(counterRefund.statusCode,200,counterRefund.body);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,beforePos);
await req('POST',`/api/admin/orders/${posId}/refund/manual`,{reference:'cash-receipt-001',reason:'Refunded at counter'},admin);
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[product])).rows[0].stock_quantity,beforePos);checked++;

// Regression for the reported order: failed attempt + later capture + erased reservation aggregate.
const repairOrder='dddddddd-dddd-4ddd-8ddd-dddddddddddd',repairProduct='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
await query("INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity,stock_reserved,in_stock) VALUES($1,'repair-fixture','Repair fixture','Test',250,'hair','retail','Renamed Vendor','unisex','/images/placeholder.svg',12,0,true)",[repairProduct]);
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,total_amount,currency,shipping_address,payment_method,payment_status) VALUES($1,$2,'order_repair','accepted',500,500,'INR','{}','Razorpay','failed')",[repairOrder,customer]);
await query("INSERT INTO stock_reservations(order_id,product_id,quantity,status) VALUES($1,$2,2,'active')",[repairOrder,repairProduct]);
const providerPayment={id:'pay_repair_captured',order_id:'order_repair',status:'captured',amount:50000,amount_refunded:0,currency:'INR',fee:1180,tax:180,created_at:Math.floor(Date.now()/1000)};
const failedAttempt={...providerPayment,id:'pay_repair_failed',status:'failed',fee:null,tax:null};
const repairGateway={orders:{fetchPayments:async()=>({items:[failedAttempt,providerPayment]})},payments:{fetch:async id=>id===failedAttempt.id?failedAttempt:providerPayment}};
const {reconcileOrderPayment}=await mod('modules/orders/payment-reconciliation.service.js');
const repairPending=await reconcileOrderPayment(repairOrder,repairGateway);
assert.equal(repairPending.payment_status,'captured');assert.equal(repairPending.razorpay_payment_id,providerPayment.id);
assert.equal(repairPending.payment_reconciliation_error,'STOCK_LEDGER_INCONSISTENT');
assert.equal((await query('SELECT stock_quantity FROM products WHERE id=$1',[repairProduct])).rows[0].stock_quantity,12);
const snapshot=(await query('SELECT * FROM gateway_payments WHERE id=$1',[providerPayment.id])).rows[0];
assert.equal(Number(snapshot.amount_paise),50000);assert.equal(Number(snapshot.fee_paise),1180);assert.equal(Number(snapshot.tax_paise),180);
const {repairPaidOrderInventory}=await mod('modules/orders/repair-paid-order.service.js');
assert.equal((await repairPaidOrderInventory(repairOrder,repairGateway)).repaired,true);
assert.equal((await repairPaidOrderInventory(repairOrder,repairGateway)).repaired,false);
assert.equal((await query('SELECT stock_quantity,stock_reserved FROM products WHERE id=$1',[repairProduct])).rows[0].stock_quantity,10);
assert.equal((await query('SELECT stock_reserved FROM products WHERE id=$1',[repairProduct])).rows[0].stock_reserved,0);checked++;
// Snapshot queries include actual paise amounts and keep fees distinct from their included GST.
const audit=await req('GET','/api/admin/finance/audit?days=30&search='+repairOrder,undefined,admin);
assert.equal(audit.statusCode,200,audit.body);assert.equal(audit.json().orders.length,1);
assert.equal(audit.json().orders[0].gateway_status,'captured');
assert.equal(Number(audit.json().orders[0].gateway_fee),11.8);assert.equal(Number(audit.json().orders[0].gateway_fee_tax),1.8);
assert.equal((await vendorRequest('GET','/api/admin/finance/audit')).statusCode,403);checked++;
// A failed attempt is observable but does not poison a still-open checkout.
const pendingOrder='ffffffff-ffff-4fff-8fff-ffffffffffff';
await query("INSERT INTO orders(id,user_id,idempotency_key,status,subtotal,total_amount,currency,shipping_address,payment_method,payment_status) VALUES($1,$2,'order_pending_retry','accepted',250,250,'INR','{}','Razorpay','pending')",[pendingOrder,customer]);
const onlyFailure={...failedAttempt,id:'pay_retry_failed',order_id:'order_pending_retry',amount:25000};
const pendingResult=await reconcileOrderPayment(pendingOrder,{orders:{fetchPayments:async()=>({items:[onlyFailure]})}});
assert.equal(pendingResult.payment_status,'pending');checked++;
// Inventory toggles never destroy quantities; deltas are replay-safe and stale absolute writes fail.
const beforeToggle=(await query('SELECT stock_quantity,version FROM products WHERE id=$1',[repairProduct])).rows[0];
assert.equal((await req('PUT','/api/admin/products/'+repairProduct,{inStock:false},admin)).statusCode,200);
const adjustment={delta:3,reason:'Received new shipment',requestId:'abababab-abab-4bab-8bab-abababababab'};
assert.equal((await req('POST',`/api/admin/inventory/${repairProduct}/adjust`,adjustment,admin)).statusCode,200);
assert.equal((await req('POST',`/api/admin/inventory/${repairProduct}/adjust`,adjustment,admin)).statusCode,200);
const adjusted=(await query('SELECT stock_quantity,in_stock FROM products WHERE id=$1',[repairProduct])).rows[0];
assert.equal(adjusted.stock_quantity,beforeToggle.stock_quantity+3);assert.equal(adjusted.in_stock,false);
assert.equal((await req('PUT','/api/admin/products/'+repairProduct,{stockQuantity:100,expectedVersion:beforeToggle.version},admin)).statusCode,409);
assert.equal((await req('POST',`/api/admin/inventory/${repairProduct}/adjust`,{...adjustment,requestId:'acacacac-acac-4cac-8cac-acacacacacac',delta:-999},admin)).statusCode,409);checked++;
// Partial provider refunds affect cash totals without pretending the full order was refunded.
providerPayment.amount_refunded=10000;
await reconcileOrderPayment(repairOrder,repairGateway);
const partial=(await query('SELECT payment_status,refund_amount FROM orders WHERE id=$1',[repairOrder])).rows[0];
assert.equal(partial.payment_status,'captured');assert.equal(Number(partial.refund_amount),100);
const partialAudit=await req('GET','/api/admin/finance/audit?days=30&search='+repairOrder,undefined,admin);
assert.equal(Number(partialAudit.json().orders[0].gateway_refunded),100);checked++;
// Real stylist directory, admin-only assignment, and customer visibility boundaries.
const createdStylist=await req('POST','/api/admin/stylists',{name:'Fixture Stylist',role:'Senior stylist'},admin);
assert.equal(createdStylist.statusCode,201,createdStylist.body);
const stylistId=createdStylist.json().id;
assert.equal((await req('GET','/api/admin/stylists')).statusCode,403);
assert.deepEqual((await req('GET','/api/bookings/stylists')).json(),[]);
assert.equal((await vendorRequest('POST','/api/admin/stylists',{name:'Forbidden',role:'Stylist'})).statusCode,403);checked++;
const salonAssignment=await req('PUT',`/api/admin/bookings/${homeBooking.json().id}/schedule`,{bookingDate:'2026-10-21',timeSlot:'15:00',visitType:'salon',serviceAddress:null,stylistId},admin);
assert.equal(salonAssignment.statusCode,200,salonAssignment.body);assert.equal(salonAssignment.json().stylist_name,'Fixture Stylist');
const clientHome=await req('POST','/api/admin/bookings',{...homePayload,customerEmail:'buyer@example.com',serviceAddress:'12 Market Road',stylistId},admin);
assert.equal(clientHome.statusCode,201,clientHome.body);
const clientSalon=await req('POST','/api/admin/bookings',{...homePayload,customerEmail:'buyer@example.com',timeSlot:'16:00',visitType:'salon',stylistId},admin);
assert.equal(clientSalon.statusCode,201,clientSalon.body);
const bookingHistory=(await req('GET','/api/bookings')).json();
assert.equal(bookingHistory.find(b=>b.id===clientHome.json().id).stylist_name,'Fixture Stylist');
assert.equal(bookingHistory.find(b=>b.id===clientSalon.json().id).stylist_name,null);checked++;
const conflict=await req('POST','/api/admin/bookings',{...homePayload,serviceAddress:'12 Market Road',stylistId},admin);
assert.equal(conflict.statusCode,409,conflict.body);
assert.equal((await req('PUT',`/api/admin/bookings/${clientHome.json().id}/status`,{status:'invented'},admin)).statusCode,400);
assert.equal((await req('PUT','/api/admin/bookings/00000000-0000-4000-8000-000000000000/status',{status:'completed'},admin)).statusCode,404);checked++;
assert.equal((await req('PUT',`/api/admin/stylists/${stylistId}`,{name:'Renamed Stylist',role:'Senior stylist',is_active:true},admin)).statusCode,200);
assert.equal((await req('DELETE',`/api/admin/stylists/${stylistId}`,undefined,admin)).statusCode,200);
assert.equal((await req('POST','/api/admin/bookings',{...homePayload,timeSlot:'18:00',serviceAddress:'12 Market Road',stylistId},admin)).statusCode,400);
assert.equal((await query('SELECT stylist_id FROM bookings WHERE id=$1',[clientHome.json().id])).rows[0].stylist_id,stylistId);checked++;
const serviceId='cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
await query("INSERT INTO products(id,slug,name,description,price,category,kind,vendor,audience,image_url,stock_quantity,in_stock) VALUES($1,'fixture-service','Fixture haircut','Test',650,'services','service','Urban Blade Lab','unisex','/images/placeholder.svg',0,true)",[serviceId]);
const publicPayload={...homePayload,serviceId,serviceAddress:'12 Market Road',totalPrice:1};
const publicBooking=await req('POST','/api/bookings',publicPayload);
assert.equal(publicBooking.statusCode,201,publicBooking.body);assert.equal(Number(publicBooking.json().total_price),650);
assert.equal((await query('SELECT stylist_id FROM bookings WHERE id=$1',[publicBooking.json().id])).rows[0].stylist_id,null);
assert.equal((await req('POST','/api/bookings',{...publicPayload,stylistId})).statusCode,400);checked++;
const overview=await req('GET','/api/admin/overview',undefined,admin);
assert.equal(overview.statusCode,200,overview.body);
assert.equal(overview.json().counts.orders,(await query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n);
const periodCount=(await query("SELECT COUNT(*)::int AS n FROM orders WHERE created_at>=NOW()-INTERVAL '30 days'")).rows[0].n;
assert.equal(overview.json().activity.length,31);
assert.equal(overview.json().activity.reduce((sum,day)=>sum+day.orders,0),periodCount);
assert.equal(overview.json().payments.reduce((sum,row)=>sum+row.count,0),periodCount);
assert.equal((await req('GET','/api/admin/overview?days=7',undefined,admin)).json().activity.length,8);
assert.equal((await req('GET','/api/admin/overview?days=999',undefined,admin)).statusCode,400);

assert.equal((await req('GET','/api/admin/overview')).statusCode,403);
const honestSummary=(await req('GET','/api/admin/finance/summary',undefined,admin)).json();
assert.equal(honestSummary.macro.totalSalonServicesRevenue,null);
assert.equal(honestSummary.macro.netPlatformEstimatedMargin,null);
assert.ok(honestSummary.bookingFinancials.every(b=>b.travel_surcharge_collected===null));checked++;
// Database outages must not masquerade as an empty roster or zero daily sales.
const workingQuery=pool.query;
try {
  pool.query=async()=>{throw new Error('fixture database outage');};
  assert.equal((await req('GET','/api/admin/bookings',undefined,admin)).statusCode,503);
  assert.equal((await req('GET','/api/admin/metrics/daily',undefined,admin)).statusCode,503);
} finally {pool.query=workingQuery;}
checked++;
console.log(`PASS: schema applied twice, indexes applied, ${checked} API/database assertions (production mode, Redis disconnected).`);

});
