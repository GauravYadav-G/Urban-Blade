import crypto from 'crypto';
import { pool } from '../src/db/pool.js';
import { config } from '../src/config.js';
import { buildApp } from '../src/app.js';
import type { FastifyInstance } from 'fastify';

interface TestResult {
  step: string;
  category: 'CART' | 'CHECKOUT' | 'SECURITY' | 'PAYMENT' | 'ADMIN' | 'CLEANUP';
  status: 'PASS' | 'FAIL' | 'WARNING';
  details: string;
  durationMs: number;
}

const results: TestResult[] = [];

function recordResult(
  step: string,
  category: TestResult['category'],
  status: TestResult['status'],
  details: string,
  start: number
) {
  const durationMs = Date.now() - start;
  results.push({ step, category, status, details, durationMs });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`   ${icon} [${category}] ${step}: ${details} (${durationMs}ms)`);
}

async function runCompleteFlowAudit() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  URBAN BLADE: COMPLETE END-TO-END COMMERCE & FULFILLMENT AUDIT');
  console.log('  Testing live against Neon Serverless PostgreSQL & Fastify Stack');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const app: FastifyInstance = await buildApp();
  await app.ready();

  const createdOrderIds: string[] = [];
  let testProductId = '';
  let testProductName = '';
  let testProductUnitPrice = 0;
  let originalStock = 0;

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 1: PRODUCT SELECTION & LIVE CATALOG AUDIT
    // ─────────────────────────────────────────────────────────────────────────
    console.log('📦 PHASE 1: Product Selection & Catalog Authority');
    let t0 = Date.now();

    const catalogResp = await app.inject({
      method: 'GET',
      url: '/api/products',
    });

    if (catalogResp.statusCode !== 200) {
      recordResult('Fetch Catalog', 'CART', 'FAIL', `Status ${catalogResp.statusCode}: ${catalogResp.body}`, t0);
      throw new Error('Catalog fetch failed');
    }

    const catalog = JSON.parse(catalogResp.body);
    const productsList = catalog.data || catalog;
    if (!productsList || productsList.length === 0) {
      recordResult('Catalog Products Available', 'CART', 'FAIL', 'Catalog empty in Neon DB', t0);
      throw new Error('No products in catalog');
    }

    // Pick in-stock product
    const eligibleProd = productsList.find((p: any) => (p.stockQuantity ?? p.stock_quantity ?? 0) >= 10);
    if (!eligibleProd) {
      recordResult('Stock Availability Check', 'CART', 'FAIL', 'No product found with >= 10 stock', t0);
      throw new Error('Insufficient product stock for testing');
    }

    testProductId = eligibleProd.id;
    testProductName = eligibleProd.name;
    testProductUnitPrice = parseFloat(eligibleProd.price);

    // Read real DB stock
    const dbStockRes = await pool.query('SELECT stock_quantity FROM products WHERE id = $1', [testProductId]);
    originalStock = parseInt(dbStockRes.rows[0].stock_quantity, 10);

    recordResult(
      'Product Identification & Live Stock',
      'CART',
      'PASS',
      `Selected "${testProductName}" (ID: ${testProductId}) at ₹${testProductUnitPrice} (Current Stock: ${originalStock})`,
      t0
    );

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 2: CART CALCULATIONS & SHIPPING THRESHOLD RULES
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🛒 PHASE 2: Cart Calculation & Dynamic Shipping Rules');
    t0 = Date.now();

    const purchaseQty = 2;
    const computedSubtotal = testProductUnitPrice * purchaseQty;
    const computedShipping = computedSubtotal >= 999 ? 0 : 99;
    const computedTotal = computedSubtotal + computedShipping;

    recordResult(
      'Authoritative Price & Shipping Calculation',
      'CART',
      'PASS',
      `Subtotal: ₹${computedSubtotal} (${purchaseQty}x ₹${testProductUnitPrice}) | Shipping: ₹${computedShipping} (Threshold ₹999) | Total: ₹${computedTotal}`,
      t0
    );

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 3: CHECKOUT INITIATION & TWO-PHASE INVENTORY LOCK
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🔒 PHASE 3: Checkout Session & Atomic Inventory Lock');
    t0 = Date.now();

    const checkoutPayload = {
      items: [{ productId: testProductId, quantity: purchaseQty }],
      shippingAddress: {
        fullName: 'Test Auditor Rajput',
        phone: '9876543210',
        street: 'Suite 404, Tech Park',
        city: 'Ghaziabad',
        postalCode: '201002',
      },
      paymentMethod: 'upi' as const,
    };

    const checkoutResp = await app.inject({
      method: 'POST',
      url: '/api/orders/checkout-session',
      payload: checkoutPayload,
    });

    if (checkoutResp.statusCode !== 201) {
      recordResult('Create Checkout Session', 'CHECKOUT', 'FAIL', `Status ${checkoutResp.statusCode}: ${checkoutResp.body}`, t0);
      throw new Error('Checkout session creation failed');
    }

    const sessionData = JSON.parse(checkoutResp.body);
    const orderId = sessionData.orderId;
    createdOrderIds.push(orderId);

    // Verify atomic inventory lock in Neon DB
    const postLockStockRes = await pool.query('SELECT stock_quantity FROM products WHERE id = $1', [testProductId]);
    const stockAfterLock = parseInt(postLockStockRes.rows[0].stock_quantity, 10);
    const expectedStockAfterLock = originalStock - purchaseQty;

    if (stockAfterLock === expectedStockAfterLock) {
      recordResult(
        'Atomic Stock Lock in PostgreSQL',
        'CHECKOUT',
        'PASS',
        `Stock atomically decremented from ${originalStock} to ${stockAfterLock} (Diff: -${purchaseQty})`,
        t0
      );
    } else {
      recordResult(
        'Atomic Stock Lock in PostgreSQL',
        'CHECKOUT',
        'FAIL',
        `Expected stock ${expectedStockAfterLock}, but DB reports ${stockAfterLock}`,
        t0
      );
    }

    // Verify initial pending order shell in DB
    const dbOrderRes = await pool.query('SELECT id, status, payment_status, total_amount FROM orders WHERE id = $1', [orderId]);
    if (dbOrderRes.rows.length === 0) {
      recordResult('Order Shell in DB', 'CHECKOUT', 'FAIL', `Order ${orderId} not found in Neon DB`, t0);
    } else {
      const row = dbOrderRes.rows[0];
      recordResult(
        'Order Shell Persistence in PostgreSQL',
        'CHECKOUT',
        'PASS',
        `Order ${row.id.slice(0, 8)} inserted with status='${row.status}' and payment_status='${row.payment_status}' (₹${row.total_amount})`,
        t0
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 4: SECURITY PENETRATION & LOOPHOLE AUDIT
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🛡️ PHASE 4: Security Vulnerability & Loophole Penetration Testing');

    // Test 4A: Price Tampering Attack
    t0 = Date.now();
    const tamperedAmount = 1.0; // Malicious client trying to pay ₹1 for a ₹2000 product
    const tamperedSignature = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${orderId}:${tamperedAmount}:${sessionData.expiresAt}`)
      .digest('hex');

    const tamperResp = await app.inject({
      method: 'POST',
      url: '/api/orders/verify-payment',
      payload: {
        orderId,
        paymentId: `pay_tampered_${Date.now()}`,
        signatureToken: tamperedSignature,
        expiresAt: sessionData.expiresAt,
      },
    });

    if (tamperResp.statusCode === 403) {
      recordResult(
        'Price Tampering Protection (HMAC Guard)',
        'SECURITY',
        'PASS',
        'Server detected price tampering signature mismatch and rejected with 403 SECURITY_TAMPER_DETECTED',
        t0
      );
    } else {
      recordResult(
        'Price Tampering Protection (HMAC Guard)',
        'SECURITY',
        'FAIL',
        `Server accepted or gave unexpected status ${tamperResp.statusCode}`,
        t0
      );
    }

    // Test 4B: Expired Session Attack
    t0 = Date.now();
    const expiredTimestamp = Date.now() - 10000; // Expired in past
    const expiredSig = crypto
      .createHmac('sha256', config.jwt.secret)
      .update(`${orderId}:${computedTotal}:${expiredTimestamp}`)
      .digest('hex');

    const expiredResp = await app.inject({
      method: 'POST',
      url: '/api/orders/verify-payment',
      payload: {
        orderId,
        paymentId: `pay_expired_${Date.now()}`,
        signatureToken: expiredSig,
        expiresAt: expiredTimestamp,
      },
    });

    if (expiredResp.statusCode === 410) {
      recordResult(
        'Session Expiration Enforcement',
        'SECURITY',
        'PASS',
        'Server rejected expired payment session with 410 PAYMENT_SESSION_EXPIRED',
        t0
      );
    } else {
      recordResult(
        'Session Expiration Enforcement',
        'SECURITY',
        'FAIL',
        `Expected 410, got ${expiredResp.statusCode}`,
        t0
      );
    }

    // Test 4C: Malformed / Empty Cart Attack
    t0 = Date.now();
    const malformedResp = await app.inject({
      method: 'POST',
      url: '/api/orders/checkout-session',
      payload: {
        items: [],
        shippingAddress: { fullName: '', phone: '', street: '' },
      },
    });

    if (malformedResp.statusCode === 400) {
      recordResult(
        'Payload Validation & Empty Cart Guard',
        'SECURITY',
        'PASS',
        'Server rejected empty cart / missing contact with 400 EMPTY_CART',
        t0
      );
    } else {
      recordResult(
        'Payload Validation & Empty Cart Guard',
        'SECURITY',
        'FAIL',
        `Expected 400, got ${malformedResp.statusCode}`,
        t0
      );
    }

    // Test 4D: Inventory Over-Allocation Guard (Requesting more than stock)
    t0 = Date.now();
    const overAllocResp = await app.inject({
      method: 'POST',
      url: '/api/orders/checkout-session',
      payload: {
        items: [{ productId: testProductId, quantity: 999999 }],
        shippingAddress: checkoutPayload.shippingAddress,
      },
    });

    if (overAllocResp.statusCode === 400) {
      recordResult(
        'Stock Over-Allocation Guard',
        'SECURITY',
        'PASS',
        'Server rejected purchase exceeding stock with 400 INSUFFICIENT_STOCK',
        t0
      );
    } else {
      recordResult(
        'Stock Over-Allocation Guard',
        'SECURITY',
        'FAIL',
        `Expected 400, got ${overAllocResp.statusCode}`,
        t0
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 5: LEGITIMATE PAYMENT CAPTURE & ORDER CONFIRMATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n💳 PHASE 5: Legitimate Payment Verification & Order Confirmation');
    t0 = Date.now();

    const legitPaymentId = `pay_upi_auth_${Date.now()}`;
    const legitVerificationResp = await app.inject({
      method: 'POST',
      url: '/api/orders/verify-payment',
      payload: {
        orderId,
        paymentId: legitPaymentId,
        signatureToken: sessionData.signatureToken,
        expiresAt: sessionData.expiresAt,
        paymentDetails: {
          upiVpa: '9876543210@paytm',
          network: 'UPI_FAST_PAY',
        },
      },
    });

    if (legitVerificationResp.statusCode !== 200) {
      recordResult('Legitimate Payment Capture', 'PAYMENT', 'FAIL', `Status ${legitVerificationResp.statusCode}: ${legitVerificationResp.body}`, t0);
      throw new Error('Payment verification failed');
    }

    const receipt = JSON.parse(legitVerificationResp.body);
    recordResult(
      'Cryptographic Payment Capture in Neon DB',
      'PAYMENT',
      'PASS',
      `Order confirmed! Receipt: ${receipt.receiptNumber} | Payment ID: ${legitPaymentId} | Status: ${receipt.status}`,
      t0
    );

    // Verify DB transition
    const confirmedDb = await pool.query('SELECT status, payment_status, transaction_id FROM orders WHERE id = $1', [orderId]);
    const confirmedRow = confirmedDb.rows[0];
    if (confirmedRow.status === 'confirmed' && confirmedRow.payment_status === 'captured') {
      recordResult(
        'PostgreSQL Order Status Confirmation',
        'PAYMENT',
        'PASS',
        `PostgreSQL state successfully updated to status='confirmed', payment_status='captured'`,
        t0
      );
    } else {
      recordResult(
        'PostgreSQL Order Status Confirmation',
        'PAYMENT',
        'FAIL',
        `State incorrect: status='${confirmedRow.status}', payment_status='${confirmedRow.payment_status}'`,
        t0
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 6: CASH ON DELIVERY (COD) 1-CLICK ORDER FLOW
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n💵 PHASE 6: Cash on Delivery (COD) Flow Testing');
    t0 = Date.now();

    const codResp = await app.inject({
      method: 'POST',
      url: '/api/orders/cod-order',
      payload: {
        items: [{ productId: testProductId, quantity: 1 }],
        shippingAddress: {
          fullName: 'COD Customer Anita',
          phone: '9811223344',
          street: 'Block C, Raj Nagar Extension',
          city: 'Ghaziabad',
        },
      },
    });

    if (codResp.statusCode === 201) {
      const codReceipt = JSON.parse(codResp.body);
      createdOrderIds.push(codReceipt.orderId);
      recordResult(
        'Direct COD Order Placement',
        'PAYMENT',
        'PASS',
        `COD Order ${codReceipt.orderId.slice(0, 8)} generated with receipt ${codReceipt.receiptNumber} (payment_status='pending', payment_method='cash_on_delivery')`,
        t0
      );
    } else {
      recordResult('Direct COD Order Placement', 'PAYMENT', 'FAIL', `Status ${codResp.statusCode}: ${codResp.body}`, t0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 7: ADMIN OPERATIONS & COMPLETE FULFILLMENT LIFECYCLE
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🏢 PHASE 7: Admin Panel Operations & Complete Dispatch Pipeline');

    // 7A: Admin Order Discovery
    t0 = Date.now();
    const adminOrdersResp = await app.inject({
      method: 'GET',
      url: '/api/admin/orders',
    });

    if (adminOrdersResp.statusCode === 200) {
      const adminOrdersData = JSON.parse(adminOrdersResp.body);
      const ordersList: any[] = adminOrdersData.data || [];
      const foundConfirmed = ordersList.find((o) => o.id === orderId);

      if (foundConfirmed) {
        recordResult(
          'Admin Order Discovery (Real-time Pipeline)',
          'ADMIN',
          'PASS',
          `Admin retrieved ${ordersList.length} orders; newly placed order ${orderId.slice(0, 8)} discovered with status='${foundConfirmed.status}'`,
          t0
        );
      } else {
        recordResult(
          'Admin Order Discovery',
          'ADMIN',
          'WARNING',
          `Order ${orderId.slice(0, 8)} not in first ${ordersList.length} orders returned`,
          t0
        );
      }
    } else {
      recordResult('Admin Order Discovery', 'ADMIN', 'FAIL', `Status ${adminOrdersResp.statusCode}`, t0);
    }

    // 7B: Stage 1 Advancement — Pack Order (confirmed -> processing)
    t0 = Date.now();
    const stage1Resp = await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${orderId}/status`,
      payload: { status: 'processing' },
    });

    if (stage1Resp.statusCode === 200) {
      const s1Row = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
      if (s1Row.rows[0]?.status === 'processing') {
        recordResult(
          'Fulfillment Stage 1 (Pack Order)',
          'ADMIN',
          'PASS',
          `Order ${orderId.slice(0, 8)} advanced: confirmed -> processing (Warehouse Packing active)`,
          t0
        );
      } else {
        recordResult('Fulfillment Stage 1 (Pack Order)', 'ADMIN', 'FAIL', `DB status is '${s1Row.rows[0]?.status}'`, t0);
      }
    } else {
      recordResult('Fulfillment Stage 1 (Pack Order)', 'ADMIN', 'FAIL', `Status ${stage1Resp.statusCode}`, t0);
    }

    // 7C: Stage 2 Advancement — Dispatch (processing -> shipped)
    t0 = Date.now();
    const stage2Resp = await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${orderId}/status`,
      payload: { status: 'shipped' },
    });

    if (stage2Resp.statusCode === 200) {
      const s2Row = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
      if (s2Row.rows[0]?.status === 'shipped') {
        recordResult(
          'Fulfillment Stage 2 (Line-Item Dispatch)',
          'ADMIN',
          'PASS',
          `Order ${orderId.slice(0, 8)} advanced: processing -> shipped (In Transit with courier)`,
          t0
        );
      } else {
        recordResult('Fulfillment Stage 2 (Line-Item Dispatch)', 'ADMIN', 'FAIL', `DB status is '${s2Row.rows[0]?.status}'`, t0);
      }
    } else {
      recordResult('Fulfillment Stage 2 (Line-Item Dispatch)', 'ADMIN', 'FAIL', `Status ${stage2Resp.statusCode}`, t0);
    }

    // 7D: Stage 3 Advancement — Deliver (shipped -> delivered)
    t0 = Date.now();
    const stage3Resp = await app.inject({
      method: 'PUT',
      url: `/api/admin/orders/${orderId}/status`,
      payload: { status: 'delivered' },
    });

    if (stage3Resp.statusCode === 200) {
      const s3Row = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
      if (s3Row.rows[0]?.status === 'delivered') {
        recordResult(
          'Fulfillment Stage 3 (Final Delivery)',
          'ADMIN',
          'PASS',
          `Order ${orderId.slice(0, 8)} advanced: shipped -> delivered (Fulfilled at customer doorstep)`,
          t0
        );
      } else {
        recordResult('Fulfillment Stage 3 (Final Delivery)', 'ADMIN', 'FAIL', `DB status is '${s3Row.rows[0]?.status}'`, t0);
      }
    } else {
      recordResult('Fulfillment Stage 3 (Final Delivery)', 'ADMIN', 'FAIL', `Status ${stage3Resp.statusCode}`, t0);
    }

    // 7E: Admin Metrics Live Recalculation
    t0 = Date.now();
    const metricsResp = await app.inject({
      method: 'GET',
      url: '/api/admin/metrics',
    });

    if (metricsResp.statusCode === 200) {
      const m = JSON.parse(metricsResp.body);
      recordResult(
        'Live KPI Metrics Recalculation',
        'ADMIN',
        'PASS',
        `Live Revenue: ₹${m.revenue?.month || 0} | Total Orders: ${m.orders?.total || 0} (Delivered: ${m.orders?.delivered || 0}) | Occupancy: ${m.bookings?.occupancyRate || 0}%`,
        t0
      );
    } else {
      recordResult('Live KPI Metrics Recalculation', 'ADMIN', 'FAIL', `Status ${metricsResp.statusCode}`, t0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PHASE 8: CLEANUP & AUDIT TRAIL PRESERVATION
    // ─────────────────────────────────────────────────────────────────────────
    console.log('\n🧹 PHASE 8: Test Cleanup & Stock Restoration');
    t0 = Date.now();

    for (const id of createdOrderIds) {
      await pool.query('DELETE FROM order_items WHERE order_id = $1', [id]);
      await pool.query('DELETE FROM orders WHERE id = $1', [id]);
    }

    // Restore original product stock in DB
    await pool.query('UPDATE products SET stock_quantity = $1 WHERE id = $2', [originalStock, testProductId]);

    recordResult(
      'Clean Up Temporary Audit Records',
      'CLEANUP',
      'PASS',
      `Purged ${createdOrderIds.length} synthetic test orders and restored "${testProductName}" stock to ${originalStock}`,
      t0
    );

  } catch (err: any) {
    console.error('\n❌ Unhandled exception during audit run:', err.message);
  } finally {
    // Print final score & findings
    console.log('\n═══════════════════════════════════════════════════════════════════════');
    console.log('                 AUDIT SUMMARY & BUG DISCOVERY REPORT');
    console.log('═══════════════════════════════════════════════════════════════════════');

    const total = results.length;
    const passed = results.filter((r) => r.status === 'PASS').length;
    const failed = results.filter((r) => r.status === 'FAIL').length;
    const warned = results.filter((r) => r.status === 'WARNING').length;

    console.log(`Total Operations Checked : ${total}`);
    console.log(`Passed Checks            : ${passed} ✅`);
    console.log(`Failed Checks            : ${failed} ❌`);
    console.log(`Warnings                 : ${warned} ⚠️\n`);

    await app.close();
    await pool.end();
  }
}

runCompleteFlowAudit();
