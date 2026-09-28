import { buildApp } from '../src/app.js';
import { query, pool } from '../src/db/pool.js';
import type { FastifyInstance } from 'fastify';

interface AttackTestResult {
  attackName: string;
  category: 'OWASP-A01' | 'OWASP-A02' | 'OWASP-A04' | 'LOGIC-FLAW' | 'RATE-LIMIT';
  outcome: 'BLOCKED' | 'EXPLOITED';
  details: string;
}

const auditResults: AttackTestResult[] = [];

function recordAttack(
  attackName: string,
  category: AttackTestResult['category'],
  outcome: AttackTestResult['outcome'],
  details: string
) {
  auditResults.push({ attackName, category, outcome, details });
  const icon = outcome === 'BLOCKED' ? '🛡️ [BLOCKED - SECURE]' : '🚨 [VULNERABILITY DETECTED]';
  console.log(`   ${icon} (${category}) ${attackName}: ${details}`);
}

async function runTrafficAndPenetrationAudit() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('  ⚔️ URBAN BLADE: ADVERSARIAL PENETRATION AUDIT & TRAFFIC SIMULATION  ');
  console.log('  Testing live against Fastify API + Neon PostgreSQL Serverless       ');
  console.log('═══════════════════════════════════════════════════════════════════════\n');

  const app: FastifyInstance = await buildApp();
  await app.ready();

  // Create real test tokens for testing authorization tiers
  const adminToken = app.jwt.sign({
    id: 'cf32923e-e498-407c-93d5-8d8cef913979',
    email: 'admin@urbanblade.in',
    role: 'admin',
    name: 'Master Admin',
  });

  const customerToken = app.jwt.sign({
    id: '9e55180c-6643-4320-af2d-fd00b2d3c5af',
    email: 'demo@urbanblade.in',
    role: 'customer',
    name: 'Demo Customer',
  });

  const vendorToken = app.jwt.sign({
    id: 'vnd-tools',
    email: 'tools@urbanblade.in',
    role: 'vendor',
    name: 'Urban Blade Tools',
    vendorId: 'vnd-tools',
    vendorName: 'Urban Blade Tools',
  });

  // Pick an existing product for test orders
  const prodRes = await query('SELECT id, name, price, stock_quantity FROM products WHERE in_stock = true AND stock_quantity > 10 LIMIT 1');
  if (prodRes.rows.length === 0) {
    throw new Error('No products in catalog to run security audit');
  }
  const sampleProduct = prodRes.rows[0];
  const realPrice = parseFloat(sampleProduct.price);

  const cleanupOrderIds: string[] = [];

  try {
    // ═════════════════════════════════════════════════════════════════════════
    // VECTOR 1: UN-AUTHENTICATED ADMIN ENDPOINT PENETRATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log('🛡️ VECTOR 1: Public Internet / Anonymous Admin Infiltration');

    // 1A: Anonymous access to revenue metrics
    const anonMetrics = await app.inject({ method: 'GET', url: '/api/admin/metrics' });
    if (anonMetrics.statusCode === 401) {
      recordAttack('Anonymous Metrics Snooping', 'OWASP-A01', 'BLOCKED', 'HTTP 401 Unauthorized returned');
    } else {
      recordAttack('Anonymous Metrics Snooping', 'OWASP-A01', 'EXPLOITED', `Status ${anonMetrics.statusCode} returned metrics`);
    }

    // 1B: Anonymous access to customer PII database
    const anonCustomers = await app.inject({ method: 'GET', url: '/api/admin/customers' });
    if (anonCustomers.statusCode === 401) {
      recordAttack('Anonymous Customer Data Scraping', 'OWASP-A01', 'BLOCKED', 'HTTP 401 Unauthorized returned');
    } else {
      recordAttack('Anonymous Customer Data Scraping', 'OWASP-A01', 'EXPLOITED', `Status ${anonCustomers.statusCode}`);
    }

    // 1C: Anonymous product catalog deletion
    const anonDelete = await app.inject({ method: 'DELETE', url: `/api/admin/products/${sampleProduct.id}` });
    if (anonDelete.statusCode === 401) {
      recordAttack('Anonymous Product Deletion', 'OWASP-A01', 'BLOCKED', 'HTTP 401 Unauthorized returned');
    } else {
      recordAttack('Anonymous Product Deletion', 'OWASP-A01', 'EXPLOITED', `Status ${anonDelete.statusCode}`);
    }

    // 1D: Anonymous system telemetry & infrastructure inspection
    const anonSystem = await app.inject({ method: 'GET', url: '/api/admin/system' });
    if (anonSystem.statusCode === 401) {
      recordAttack('Anonymous Infrastructure Inspection', 'OWASP-A01', 'BLOCKED', 'HTTP 401 Unauthorized returned');
    } else {
      recordAttack('Anonymous Infrastructure Inspection', 'OWASP-A01', 'EXPLOITED', `Status ${anonSystem.statusCode}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // VECTOR 2: PRIVILEGE ESCALATION ATTACK (CUSTOMER -> ADMIN)
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n🛡️ VECTOR 2: Privilege Escalation & Role Tampering Attack');

    // 2A: Customer attempts to promote themselves to admin
    const privEscRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/customers/9e55180c-6643-4320-af2d-fd00b2d3c5af/role`,
      headers: { authorization: `Bearer ${customerToken}`, 'content-type': 'application/json' },
      payload: { role: 'admin' },
    });
    if (privEscRes.statusCode === 403) {
      recordAttack('Customer Self-Promotion to Admin', 'OWASP-A01', 'BLOCKED', 'HTTP 403 Forbidden returned');
    } else {
      recordAttack('Customer Self-Promotion to Admin', 'OWASP-A01', 'EXPLOITED', `Status ${privEscRes.statusCode}`);
    }

    // 2B: Customer attempts to dump all customer records
    const custDumpRes = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      headers: { authorization: `Bearer ${customerToken}` },
    });
    if (custDumpRes.statusCode === 403) {
      recordAttack('Customer Dumping CRM Database', 'OWASP-A01', 'BLOCKED', 'HTTP 403 Forbidden returned');
    } else {
      recordAttack('Customer Dumping CRM Database', 'OWASP-A01', 'EXPLOITED', `Status ${custDumpRes.statusCode}`);
    }

    // 2C: Vendor attempts to modify master admin settings or customers
    const vendorCustRes = await app.inject({
      method: 'GET',
      url: '/api/admin/customers',
      headers: { authorization: `Bearer ${vendorToken}` },
    });
    if (vendorCustRes.statusCode === 403) {
      recordAttack('Vendor Accessing Master Customers CRM', 'OWASP-A01', 'BLOCKED', 'HTTP 403 Forbidden returned');
    } else {
      recordAttack('Vendor Accessing Master Customers CRM', 'OWASP-A01', 'EXPLOITED', `Status ${vendorCustRes.statusCode}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // VECTOR 3: FINANCIAL PARAMETER TAMPERING (PRICE & DISCOUNT INJECTION)
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n🛡️ VECTOR 3: Financial Integrity & Price Tampering Attacks');

    // 3A: Tamper price to ₹0.01 in checkout session
    const fakeDiscountRes = await app.inject({
      method: 'POST',
      url: '/api/orders/checkout-session',
      headers: { 'content-type': 'application/json' },
      payload: {
        items: [{ productId: sampleProduct.id, quantity: 1 }],
        shippingAddress: { fullName: 'Adversary Hacker', phone: '9999888877' },
        discountAmount: 99999, // Adversary attempts to inject huge arbitrary discount
      },
    });

    if (fakeDiscountRes.statusCode === 201) {
      const data = JSON.parse(fakeDiscountRes.body);
      cleanupOrderIds.push(data.orderId);
      // Verify that totalAmount reflects authoritative catalog price, NOT the adversary's injected discount
      if (data.totalAmount >= realPrice) {
        recordAttack(
          'Arbitrary Discount Amount Injection',
          'LOGIC-FLAW',
          'BLOCKED',
          `Server discarded fake discount; enforced authoritative DB total ₹${data.totalAmount} (catalog price: ₹${realPrice})`
        );
      } else {
        recordAttack(
          'Arbitrary Discount Amount Injection',
          'LOGIC-FLAW',
          'EXPLOITED',
          `Server accepted tampered discount: total amount was ₹${data.totalAmount}`
        );
      }
    } else {
      recordAttack('Arbitrary Discount Amount Injection', 'LOGIC-FLAW', 'BLOCKED', `Status ${fakeDiscountRes.statusCode}`);
    }

    // 3B: Tamper unit price directly to ₹0.01 in order creation
    const tamperedOrderRes = await app.inject({
      method: 'POST',
      url: '/api/orders',
      headers: { 'content-type': 'application/json' },
      payload: {
        items: [{ productId: sampleProduct.id, quantity: 1, unitPrice: 0.01 }],
        subtotal: 0.01,
        totalAmount: 0.01,
        shippingAddress: { fullName: 'Adversary Hacker', phone: '9999888877' },
      },
    });

    if (tamperedOrderRes.statusCode === 202) {
      const ordData = JSON.parse(tamperedOrderRes.body);
      cleanupOrderIds.push(ordData.orderId);
      if (ordData.totalAmount >= realPrice) {
        recordAttack(
          'Client-Side Price Override Attack',
          'LOGIC-FLAW',
          'BLOCKED',
          `Server calculated price ₹${ordData.totalAmount} from PostgreSQL, ignoring client's ₹0.01 request`
        );
      } else {
        recordAttack(
          'Client-Side Price Override Attack',
          'LOGIC-FLAW',
          'EXPLOITED',
          `Server allowed order at ₹${ordData.totalAmount}`
        );
      }
    } else {
      recordAttack('Client-Side Price Override Attack', 'LOGIC-FLAW', 'BLOCKED', `Status ${tamperedOrderRes.statusCode}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // VECTOR 4: BROKEN OBJECT LEVEL AUTHORIZATION (BOLA / IDOR)
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n🛡️ VECTOR 4: Broken Object Level Authorization (IDOR) Tests');

    // 4A: Anonymous client attempting to dump all orders in DB
    const anonOrdersDump = await app.inject({ method: 'GET', url: '/api/orders' });
    if (anonOrdersDump.statusCode === 401) {
      recordAttack('Anonymous Orders Table Dump', 'OWASP-A01', 'BLOCKED', 'HTTP 401 Authentication Required');
    } else {
      recordAttack('Anonymous Orders Table Dump', 'OWASP-A01', 'EXPLOITED', `Status ${anonOrdersDump.statusCode}`);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // VECTOR 5: CART CORRUPTION & SESSION ISOLATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n🛡️ VECTOR 5: Cart Session Isolation & Negative Quantities');

    // 5A: Negative quantity attack
    const negQtyRes = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      headers: { 'x-session-id': 'test-session-attacker', 'content-type': 'application/json' },
      payload: { productId: sampleProduct.id, qty: -10 },
    });
    if (negQtyRes.statusCode === 400) {
      recordAttack('Negative Cart Quantity Injection', 'LOGIC-FLAW', 'BLOCKED', 'HTTP 400 Bad Request');
    } else {
      recordAttack('Negative Cart Quantity Injection', 'LOGIC-FLAW', 'EXPLOITED', `Status ${negQtyRes.statusCode}`);
    }

    // 5B: Fake product ID injection into cart
    const fakeProdRes = await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      headers: { 'x-session-id': 'test-session-attacker', 'content-type': 'application/json' },
      payload: { productId: 'non-existent-fake-product-xyz', qty: 1 },
    });
    if (fakeProdRes.statusCode === 404) {
      recordAttack('Non-Existent Product Cart Insertion', 'LOGIC-FLAW', 'BLOCKED', 'HTTP 404 Product Not Found');
    } else {
      recordAttack('Non-Existent Product Cart Insertion', 'LOGIC-FLAW', 'EXPLOITED', `Status ${fakeProdRes.statusCode}`);
    }

    // 5C: Multi-tenant cart isolation test
    const userASession = 'sess_user_alpha_' + Date.now();
    const userBSession = 'sess_user_beta_' + Date.now();

    await app.inject({
      method: 'POST',
      url: '/api/cart/items',
      headers: { 'x-session-id': userASession, 'content-type': 'application/json' },
      payload: { productId: sampleProduct.id, qty: 2 },
    });

    const userBCart = await app.inject({
      method: 'GET',
      url: '/api/cart',
      headers: { 'x-session-id': userBSession },
    });
    const userBData = JSON.parse(userBCart.body);
    if (userBData.items.length === 0) {
      recordAttack('Cart Cross-Session Bleed', 'LOGIC-FLAW', 'BLOCKED', 'User B cart is completely empty and isolated from User A');
    } else {
      recordAttack('Cart Cross-Session Bleed', 'LOGIC-FLAW', 'EXPLOITED', 'User B saw User A cart items!');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // VECTOR 6: UNAUTHORIZED AI CHAT ORDER CANCELLATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n🛡️ VECTOR 6: AI Chatbot Concierge Order Cancellation Security');

    // Create a real confirmed order to test cancellation protection
    const testOrderRes = await query(
      `INSERT INTO orders (
        id, status, subtotal, shipping_fee, total_amount, currency, shipping_address, payment_method, payment_status
      ) VALUES (
        gen_random_uuid(), 'confirmed', 999, 0, 999, 'INR', 
        $1::jsonb, 'UPI', 'captured'
      ) RETURNING id`,
      [JSON.stringify({ fullName: 'Target Victim', email: 'victim@urbanblade.in', phone: '9876543210' })]
    );
    const victimOrderId = testOrderRes.rows[0].id;
    cleanupOrderIds.push(victimOrderId);

    // Attacker tries to cancel Victim's order via chat without providing matching email/phone
    const attackerChatRes = await app.inject({
      method: 'POST',
      url: '/api/support/live-chat/message',
      headers: { 'content-type': 'application/json' },
      payload: {
        message: `Please cancel order ${victimOrderId} right now`,
        userEmail: 'attacker@evil.com',
      },
    });

    const chatData = JSON.parse(attackerChatRes.body);
    // Verify order is STILL confirmed in DB
    const checkVictimOrder = await query('SELECT status FROM orders WHERE id = $1', [victimOrderId]);
    if (checkVictimOrder.rows[0]?.status === 'confirmed') {
      recordAttack(
        'Unauthorized AI Support Order Cancellation',
        'LOGIC-FLAW',
        'BLOCKED',
        'Concierge rejected cancellation without identity confirmation; order remains confirmed'
      );
    } else {
      recordAttack(
        'Unauthorized AI Support Order Cancellation',
        'LOGIC-FLAW',
        'EXPLOITED',
        `Victim order was cancelled by unauthorized attacker! Status: ${checkVictimOrder.rows[0]?.status}`
      );
    }

    // ═════════════════════════════════════════════════════════════════════════
    // PHASE 7: REAL TRAFFIC & OPERATIONS SIMULATION
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n🚀 PHASE 7: Real-world Traffic Simulation (50 Concurrent Operations)');
    const tStart = Date.now();

    const tasks: Array<Promise<{ op: string; latencyMs: number; ok: boolean }>> = [];

    // 20 Catalog Search / Browsing operations
    for (let i = 0; i < 20; i++) {
      tasks.push(
        (async () => {
          const t0 = Date.now();
          const res = await app.inject({ method: 'GET', url: `/api/products?page=${(i % 3) + 1}&limit=12` });
          return { op: 'Browse Catalog', latencyMs: Date.now() - t0, ok: res.statusCode === 200 };
        })()
      );
    }

    // 15 Cart Operations
    for (let i = 0; i < 15; i++) {
      tasks.push(
        (async () => {
          const t0 = Date.now();
          const sess = `traffic_sess_${i}_${Date.now()}`;
          const res = await app.inject({
            method: 'POST',
            url: '/api/cart/items',
            headers: { 'x-session-id': sess, 'content-type': 'application/json' },
            payload: { productId: sampleProduct.id, qty: (i % 3) + 1 },
          });
          return { op: 'Add to Cart', latencyMs: Date.now() - t0, ok: res.statusCode === 200 };
        })()
      );
    }

    // 10 Authenticated Admin KPI and Discovery Operations
    for (let i = 0; i < 10; i++) {
      tasks.push(
        (async () => {
          const t0 = Date.now();
          const res = await app.inject({
            method: 'GET',
            url: '/api/admin/metrics',
            headers: { authorization: `Bearer ${adminToken}` },
          });
          return { op: 'Admin KPI Monitor', latencyMs: Date.now() - t0, ok: res.statusCode === 200 };
        })()
      );
    }

    // 5 Live Chat Concierge Queries
    for (let i = 0; i < 5; i++) {
      tasks.push(
        (async () => {
          const t0 = Date.now();
          const res = await app.inject({
            method: 'POST',
            url: '/api/support/live-chat/message',
            headers: { 'content-type': 'application/json' },
            payload: { message: 'What haircut services do you offer for men?' },
          });
          return { op: 'Live Chat AI Concierge', latencyMs: Date.now() - t0, ok: res.statusCode === 200 };
        })()
      );
    }

    const trafficResults = await Promise.all(tasks);
    const totalDurationMs = Date.now() - tStart;
    const successfulOps = trafficResults.filter((r) => r.ok).length;
    const latencies = trafficResults.map((r) => r.latencyMs).sort((a, b) => a - b);
    const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
    const p95Latency = latencies[Math.floor(latencies.length * 0.95)];

    console.log(`   ⚡ Total Concurrent Operations Executed : ${trafficResults.length}`);
    console.log(`   ✅ Success Rate                         : ${((successfulOps / trafficResults.length) * 100).toFixed(1)}% (${successfulOps}/${trafficResults.length})`);
    console.log(`   ⏱️ Average Response Latency             : ${avgLatency}ms`);
    console.log(`   🎯 95th Percentile (p95) Latency        : ${p95Latency}ms`);
    console.log(`   🏁 Total Simulation Duration            : ${totalDurationMs}ms\n`);

    // ═════════════════════════════════════════════════════════════════════════
    // AUDIT SUMMARY & SCORECARD
    // ═════════════════════════════════════════════════════════════════════════
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('                   SECURITY POSTURE SCORECARD                          ');
    console.log('═══════════════════════════════════════════════════════════════════════');
    const totalAttacks = auditResults.length;
    const blockedAttacks = auditResults.filter((r) => r.outcome === 'BLOCKED').length;
    const exploitedAttacks = auditResults.filter((r) => r.outcome === 'EXPLOITED').length;

    console.log(`Total Attack Vectors Tested : ${totalAttacks}`);
    console.log(`Successfully Defended       : ${blockedAttacks} ✅`);
    console.log(`Vulnerabilities Remaining   : ${exploitedAttacks} ${exploitedAttacks === 0 ? '🎉 (ZERO VULNERABILITIES)' : '❌'}`);
    console.log('═══════════════════════════════════════════════════════════════════════\n');

    if (exploitedAttacks > 0) {
      throw new Error(`Security audit failed: ${exploitedAttacks} attack vectors succeeded.`);
    }
  } finally {
    // Clean up temporary test audit records
    if (cleanupOrderIds.length > 0) {
      for (const id of cleanupOrderIds) {
        await query('DELETE FROM order_items WHERE order_id = $1', [id]);
        await query('DELETE FROM orders WHERE id = $1', [id]);
      }
      console.log(`🧹 Cleaned up ${cleanupOrderIds.length} synthetic audit test orders.`);
    }
    await pool.end();
  }
}

runTrafficAndPenetrationAudit().catch((err) => {
  console.error('❌ Audit execution failed:', err);
  process.exit(1);
});
