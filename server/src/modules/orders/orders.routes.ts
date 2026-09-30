import type { PoolClient } from 'pg';
import { FastifyInstance, FastifyRequest } from 'fastify';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { calculateTotals, couponDiscount, getSiteSettings } from '../commerce/commerce.service.js';
import { orderReceipt } from './receipt.service.js';
import { settleCapturedPayment, paymentGateway } from './payment-settlement.service.js';
import { query, withTransaction } from '../../db/pool.js';
import { config } from '../../config.js';
import { optionalAuth, requireAuth } from '../../core/auth.middleware.js';
import {
  cancelOrderAndReleaseStock,
  claimPendingOrder,
  commitStockReservation,
  releaseStockReservation,
  reserveStock,
} from './stock-reservation.service.js';

function checkoutTransaction<T>(request: FastifyRequest, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = (request as any).checkoutClient as PoolClient | undefined;
  return client ? fn(client) : withTransaction(fn);
}

function toValidUuidOrNull(val?: string | null): string | null {
  if (!val || typeof val !== 'string') return null;
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val.trim());
  return isUuid ? val.trim() : null;
}

async function resolveUserId(userId?: string | null, email?: string | null): Promise<string | null> {
  const directUuid = toValidUuidOrNull(userId);
  if (directUuid) return directUuid;
  const targetEmail = (email || (userId && userId.includes('@') ? userId : null))?.trim().toLowerCase();
  if (targetEmail) {
    try {
      const uRes = await query('SELECT id FROM users WHERE email ILIKE $1 LIMIT 1', [targetEmail]);
      if (uRes.rows[0]?.id) return uRes.rows[0].id;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export async function resolveAndVerifyItems(
  items: Array<{ productId: string; quantity: number }>,
  couponCode?: string,
  _untrustedDiscountAmount?: number
) {
  if (!Array.isArray(items) || !items.length || items.length > 100) throw new Error('INVALID_CART');
  const seen = new Set<string>();
  const verifiedItems: Array<{
    productId: string;
    slug?: string;
    productName: string;
    unitPrice: number;
    quantity: number;
    imageUrl: string;
  }> = [];

  for (const it of items) {
    if (!it || typeof it.productId !== 'string' || it.productId.length > 255) throw new Error('INVALID_PRODUCT');
    if (!it.quantity || typeof it.quantity !== 'number' || !Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 100) {
      throw new Error(`INVALID_QUANTITY: Item quantity must be a positive whole number.`);
    }

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(it.productId);
    const cleanSlug = it.productId.replace(/^(hc|bd|sk|tl|gf|sv)-/, '');
    const slugCandidate = (it as any).slug || cleanSlug;
    const prodRes = await query(
      `SELECT id, slug, name, price, stock_quantity, stock_reserved, image_url, in_stock FROM products WHERE ${
        isUUID
          ? 'id = $1'
          : 'slug = $1 OR slug = $2 OR slug = $3 OR id::text = $1 '
      } LIMIT 1`,
      isUUID ? [it.productId] : [it.productId, cleanSlug, slugCandidate]
    );

    let product = prodRes.rows[0];
    if (!product) {
      throw new Error(`PRODUCT_NOT_FOUND: Product "${it.productId}" was not found in catalog.`);
    }

    if (!product.in_stock) throw new Error('PRODUCT_UNAVAILABLE');
    if (seen.has(product.id)) throw new Error('DUPLICATE_PRODUCT: Combine quantities into one cart line.');
    seen.add(product.id);

    // Sellable units exclude stock already reserved by other open checkouts, so
    // this pre-check agrees with the atomic guard applied at reservation time.
    const onHand = parseInt(product.stock_quantity, 10);
    const reserved = parseInt(product.stock_reserved ?? '0', 10) || 0;
    const available = Math.max(onHand - reserved, 0);
    if (available < it.quantity) {
      throw new Error(`INSUFFICIENT_STOCK: Only ${available} unit(s) of "${product.name}" are currently available.`);
    }

    verifiedItems.push({
      productId: product.id,
      slug: product.slug,
      productName: product.name,
      unitPrice: parseFloat(product.price),
      quantity: it.quantity,
      imageUrl: product.image_url,
    });
  }

  const subtotal = verifiedItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);

  const settings = await getSiteSettings();
  if (settings.operations?.acceptingOrders === false) throw new Error('STORE_CLOSED: Orders are temporarily paused.');
  const coupon = await couponDiscount(couponCode, subtotal);
  return { verifiedItems, couponCode: coupon.couponCode, ...calculateTotals(subtotal, coupon.discount, settings.ecommerce) };
}

export async function ordersRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (request.method !== 'POST') return;
    const path = request.url.split('?')[0];
    if (['/api/orders/checkout-session', '/api/orders/verify-payment', '/api/orders'].includes(path)) {
      return reply.code(410).send({ error: 'CHECKOUT_RETIRED', message: 'Use Razorpay checkout or Cash on Delivery.' });
    }
    await requireAuth(request, reply);
    if (reply.sent) return;
    const body = request.body as any;
    if (!body || typeof body !== 'object') return reply.code(400).send({ error: 'INVALID_BODY' });
    body.userId = request.user.id;
    if (body.shippingAddress) {
      const address = body.shippingAddress;
      if (typeof address.fullName !== 'string' || address.fullName.trim().length < 2 || address.fullName.length > 100 ||
          typeof address.phone !== 'string' || !/^[0-9]{10}$/.test(address.phone) ||
          typeof address.street !== 'string' || address.street.trim().length < 5 || address.street.length > 500 ||
          typeof address.city !== 'string' || address.city.trim().length < 2 || address.city.length > 100 ||
          (address.postalCode !== undefined && (typeof address.postalCode !== 'string' || !/^[1-9][0-9]{5}$/.test(address.postalCode))) ||
          (address.state !== undefined && (typeof address.state !== 'string' || address.state.trim().length < 2 || address.state.length > 100))) {
        return reply.code(400).send({ error: 'INVALID_ADDRESS', message: 'Enter a complete delivery address and a 10-digit phone number.' });
      }
      address.email = request.user.email;
    }
    if (path.endsWith('/cancel-payment') || path.endsWith('/razorpay/verify')) {
      if (!toValidUuidOrNull(body.orderId)) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });
      const order = await query('SELECT user_id, payment_method FROM orders WHERE id = $1', [body.orderId]);
      if (!order.rows[0] || order.rows[0].user_id !== request.user.id) {
        return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
      }
      if (path.endsWith('/cancel-payment') && order.rows[0]?.payment_method === 'Razorpay') return reply.code(409).send({ error: 'PAYMENT_IN_PROGRESS', message: 'Online payment reservations are reconciled automatically.' });

    }
  });
  app.post<{ Body: { items: Array<{productId: string; quantity: number}>; couponCode?: string } }>('/orders/quote', async (request, reply) => {
    try { return await resolveAndVerifyItems(request.body.items, request.body.couponCode); }
    catch (err: any) { return reply.code(400).send({ error: 'INVALID_CHECKOUT', message: err.message }); }
  });

  app.post<{ Params: { orderId: string } }>('/orders/:orderId/reconcile', async (request, reply) => {
    const result = await query('SELECT * FROM orders WHERE id::text = $1 AND user_id = $2', [request.params.orderId, request.user.id]);
    let order = result.rows[0];
    if (!order) return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
    if (order.payment_method === 'Razorpay' && order.payment_status !== 'captured') {
      try {
        const payments = await paymentGateway().orders.fetchPayments(order.idempotency_key);
        const paid = payments.items.find(p => p.status === 'captured' || p.status === 'authorized');
        if (paid) await settleCapturedPayment(paid.id, order.id);
      } catch (err) {
        request.log.error({ err, orderId: order.id }, 'Payment confirmation pending');
        return reply.code(503).send({ error: 'CONFIRMATION_PENDING', message: 'Payment status is still being checked. Do not pay again.' });
      }
      order = (await query('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];
    }
    if (order.payment_status === 'captured' || (order.payment_method === 'Cash on Delivery' && order.status !== 'cancelled')) return { receipt: await orderReceipt(order) };
    return { pending: order.status !== 'cancelled', cancelled: order.status === 'cancelled' };
  });

  // ─── RETIRED ENDPOINTS (HTTP 410 GONE) ──────────────────────────────────────
  app.post('/orders/checkout-session', async (_request, reply) => {
    return reply.code(410).send({ error: 'CHECKOUT_RETIRED', message: 'Use Razorpay checkout or Cash on Delivery.' });
  });

  app.post('/orders/verify-payment', async (_request, reply) => {
    return reply.code(410).send({ error: 'CHECKOUT_RETIRED', message: 'Use Razorpay checkout or Cash on Delivery.' });
  });

  // ─── 3. PAYMENT CANCELLATION & AUTOMATIC INVENTORY RESTORATION ─────────────
  app.post<{
    Body: {
      orderId: string;
      reason?: string;
    };
  }>('/orders/cancel-payment', async (request, reply) => {
    const { orderId, reason = 'User cancelled checkout' } = request.body;

    if (!orderId) {
      return reply.status(400).send({ error: 'ORDER_ID_REQUIRED', message: 'Order ID is required' });
    }

    try {
      // Verify the order actually exists / is releasable before claiming success.
      const result = await withTransaction(async (client) =>
        cancelOrderAndReleaseStock(client, orderId, { allowedStatuses: ['accepted', 'processing'] })
      );

      if (!result.cancelled) {
        const current = await query('SELECT status, payment_status FROM orders WHERE id = $1', [orderId]);
        if (current.rowCount === 0) {
          return reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
        }
        const row = current.rows[0];
        return reply.status(409).send({
          error: 'ORDER_NOT_CANCELLABLE',
          message: `This order can no longer be cancelled here (status: ${row.status}, payment: ${row.payment_status}).`,
          status: row.status,
          paymentStatus: row.payment_status,
        });
      }

      return reply.send({
        success: true,
        orderId,
        status: 'cancelled',
        reservationsReleased: result.released,
        message: 'Order reservation cancelled and inventory restored.',
      });
    } catch (err: any) {
      request.log.error(err, 'Failed to cancel order reservation');
      return reply.status(500).send({
        error: 'CANCEL_FAILED',
        message: 'Failed to cancel checkout reservation.',
      });
    }
  });
  app.post('/orders', async (_request, reply) => {
    return reply.code(410).send({ error: 'CHECKOUT_RETIRED', message: 'Use Razorpay checkout or Cash on Delivery.' });
  });

  // ─── RAZORPAY 1: CREATE RAZORPAY ORDER WITH ATOMIC NEON DB STOCK LOCK ──────
  app.post<{
    Body: {
      items: Array<{ productId: string; quantity: number }>;
      shippingAddress: { fullName: string; phone: string; street: string; city?: string };
      userId?: string;
      couponCode?: string;
      discountAmount?: number;
    };
  }>('/orders/razorpay/create-order', async (request, reply) => {
    const { items, shippingAddress, userId, couponCode, discountAmount } = request.body;

    if (!items || items.length === 0) {
      return reply.status(400).send({ error: 'EMPTY_CART', message: 'Cart cannot be empty' });
    }
    if (!shippingAddress?.fullName || !shippingAddress?.phone) {
      return reply.status(400).send({ error: 'INVALID_ADDRESS', message: 'Customer name and phone are required' });
    }

    try {
      const { verifiedItems, subtotal, discountAmount: validatedDiscount, couponCode: cleanCoupon, shippingFee, totalAmount, taxAmount, taxInclusive, taxRatePercent } =
        await resolveAndVerifyItems(items, couponCode, discountAmount);
      const expectedTotal = (request.body as any).expectedTotal;
      if (typeof expectedTotal !== 'number' || Math.round(expectedTotal * 100) !== Math.round(totalAmount * 100)) {
        return reply.code(409).send({ error: 'PRICE_CHANGED', message: 'Prices have changed. Review your cart and try again.' });
      }
      const amountInPaise = Math.round(totalAmount * 100);
      const orderId = crypto.randomUUID();

      if (!config.razorpay.keyId || !config.razorpay.keySecret) {
        return reply.code(503).send({ error: 'PAYMENT_UNAVAILABLE', message: 'Online payments are not configured. Please use Cash on Delivery.' });
      }
      const rzp = new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
      const gatewayOrder = await rzp.orders.create({ amount: amountInPaise, currency: 'INR', receipt: orderId });
      const razorpayOrderId = gatewayOrder.id;
      if (!razorpayOrderId) throw new Error('PAYMENT_GATEWAY_UNAVAILABLE');

      // Atomically reserve inventory in Neon PostgreSQL (payment-first: reserve only)
      await checkoutTransaction(request, async (client) => {
        const effectiveAddress = {
          ...shippingAddress,
          email: (shippingAddress as any).email || (request.body as any).userEmail || 'customer@urbanblade.in',
        };
        const resolvedUserUuid = await resolveUserId(userId, effectiveAddress.email);

        // Insert pending order
        await client.query(
          `INSERT INTO orders (
            id, user_id, idempotency_key, status, subtotal, shipping_fee, total_amount, currency,
            shipping_address, payment_method, payment_status, transaction_id, coupon_code, discount_amount, tax_amount, tax_inclusive, tax_rate_percent
          ) VALUES ($1, $2, $3, 'accepted', $4, $5, $6, 'INR', $7, 'Razorpay', 'pending', $8, $9, $10, $11, $12, $13)`,
          [
            orderId,
            resolvedUserUuid,
            razorpayOrderId,
            subtotal,
            shippingFee,
            totalAmount,
            JSON.stringify(effectiveAddress),
            razorpayOrderId,
            cleanCoupon || null,
            validatedDiscount || 0,
            taxAmount, taxInclusive, taxRatePercent,
          ]
        );

        // Track coupon usage if a coupon was applied
        if (cleanCoupon && validatedDiscount > 0 && resolvedUserUuid) {
          await client.query(
            `
            INSERT INTO coupon_usages (coupon_code, user_id, order_id, discount_amount)
            VALUES ($1, $2, $3, $4)
            `,
            [cleanCoupon, resolvedUserUuid, orderId, validatedDiscount]
          );
        }

        // Reserve inventory against this order (ledger row + stock_reserved bump).
        await reserveStock(client, orderId, verifiedItems);

        // Insert order line items
        for (const it of [...verifiedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await client.query(
            `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, image_url)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [orderId, it.productId, it.productName, it.unitPrice, it.quantity, it.imageUrl || '']
          );
        }
      });

      return reply.status(201).send({
        orderId,
        razorpayOrderId,
        amount: amountInPaise,
        totalAmount,
        subtotal, shippingFee, discountAmount: validatedDiscount, couponCode: cleanCoupon, taxAmount, taxInclusive, taxRatePercent,
        currency: 'INR',
        keyId: config.razorpay.keyId,
        items: verifiedItems,
        shippingAddress,
      });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to create Razorpay checkout order');
      return reply.status(400).send({
        error: 'RAZORPAY_ORDER_FAILED',
        message: /^(INVALID_|INSUFFICIENT_|PRODUCT_|DUPLICATE_|STORE_CLOSED)/.test(err.message || '') ? err.message : 'Unable to start online payment. Please retry or contact support.',
      });
    }
  });

  // ─── RAZORPAY 2: CRYPTOGRAPHICALLY VERIFY PAYMENT & CAPTURE IN NEON DB ──────
  app.post<{
    Body: {
      orderId: string;
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    };
  }>('/orders/razorpay/verify', async (request, reply) => {
    const { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = request.body;

    if (!orderId || !razorpayPaymentId) {
      return reply.status(400).send({ error: 'MISSING_PAYMENT_DATA', message: 'Order ID and Razorpay Payment ID are required' });
    }

    try {
      const stored = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
      const storedOrder = stored.rows[0];
      if (!storedOrder || storedOrder.payment_method !== 'Razorpay' || storedOrder.idempotency_key !== razorpayOrderId) {
        return reply.code(400).send({ error: 'ORDER_MISMATCH' });
      }
      if (!config.razorpay.keySecret) return reply.code(503).send({ error: 'PAYMENT_UNAVAILABLE' });
      const expectedSignature = crypto.createHmac('sha256', config.razorpay.keySecret)
        .update(`${storedOrder.idempotency_key}|${razorpayPaymentId}`).digest('hex');
      if (typeof razorpaySignature !== 'string' || !/^[a-f0-9]{64}$/.test(razorpaySignature) ||
          !crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(razorpaySignature))) {
        return reply.code(400).send({ error: 'INVALID_SIGNATURE', message: 'Payment verification failed.' });
      }
      await settleCapturedPayment(razorpayPaymentId, orderId);
      const current = await query('SELECT * FROM orders WHERE id = $1', [orderId]);
      const order = current.rows[0];
      if (order.payment_status !== 'captured' || order.razorpay_payment_id !== razorpayPaymentId) {
        return reply.code(409).send({ error: 'ORDER_NOT_PENDING', message: 'Order requires payment reconciliation. Please contact support.' });
      }
      const itemsRes = await query(
        `SELECT id, product_name, unit_price, quantity, image_url FROM order_items WHERE order_id = $1`,
        [order.id]
      );

      const receipt = {
        success: true,
        orderId: order.id,
        paymentId: razorpayPaymentId,
        transactionId: razorpayPaymentId,
        receiptNumber: `RCPT-UB-${order.id.slice(0, 8).toUpperCase()}`,
        status: 'confirmed',
        paymentStatus: 'captured',
        totalAmount: Number(order.total_amount),
        subtotal: Number(order.subtotal), shippingFee: Number(order.shipping_fee), discountAmount: Number(order.discount_amount),
        couponCode: order.coupon_code, taxAmount: Number(order.tax_amount), taxInclusive: order.tax_inclusive, taxRatePercent: Number(order.tax_rate_percent),
        currency: order.currency || 'INR',
        confirmedAt: order.updated_at || new Date().toISOString(),
        shippingAddress: order.shipping_address,
        items: itemsRes.rows,
        paymentDetails: {
          method: 'Razorpay',
          gateway: 'Razorpay Standard Checkout',
          transactionId: razorpayPaymentId,
          razorpayPaymentId,
          razorpayOrderId,
        },
      };

      return reply.send(receipt);
    } catch (err: any) {
      request.log.error({ err }, 'Error during Razorpay payment verification');
      return reply.status(500).send({ error: 'VERIFICATION_FAILED', message: err.message });
    }
  });

  // ─── RAZORPAY 3: CASH ON DELIVERY (COD) DIRECT ORDER ────────────────────────
  app.post<{
    Body: {
      items: Array<{ productId: string; quantity: number }>;
      shippingAddress: { fullName: string; phone: string; street: string; city?: string };
      userId?: string;
      couponCode?: string;
      discountAmount?: number;
    };
  }>('/orders/cod-order', async (request, reply) => {
    const { items, shippingAddress, userId, couponCode, discountAmount } = request.body;

    if (!items || items.length === 0) {
      return reply.status(400).send({ error: 'EMPTY_CART', message: 'Cart cannot be empty' });
    }
    if (!shippingAddress?.fullName || !shippingAddress?.phone) {
      return reply.status(400).send({ error: 'INVALID_ADDRESS', message: 'Customer name and phone are required' });
    }

    try {
      const { verifiedItems, subtotal, discountAmount: validatedDiscount, couponCode: cleanCoupon, shippingFee, totalAmount, taxAmount, taxInclusive, taxRatePercent } =
        await resolveAndVerifyItems(items, couponCode, discountAmount);
      const expectedTotal = (request.body as any).expectedTotal;
      if (typeof expectedTotal !== 'number' || Math.round(expectedTotal * 100) !== Math.round(totalAmount * 100)) {
        return reply.code(409).send({ error: 'PRICE_CHANGED', message: 'Prices have changed. Review your cart and try again.' });
      }
      const orderId = crypto.randomUUID();

      await checkoutTransaction(request, async (client) => {
        const effectiveAddress = {
          ...shippingAddress,
          email: (shippingAddress as any).email || (request.body as any).userEmail || 'customer@urbanblade.in',
        };
        const resolvedUserUuid = await resolveUserId(userId, effectiveAddress.email);
        const codTxId = `pay_cod_${orderId.slice(0, 8)}`;
        await client.query(
          `INSERT INTO orders (
            id, user_id, idempotency_key, status, subtotal, shipping_fee, total_amount, currency,
            shipping_address, payment_method, payment_status, transaction_id, coupon_code, discount_amount, tax_amount, tax_inclusive, tax_rate_percent
          ) VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, 'INR', $7, 'Cash on Delivery', 'pending', $8, $9, $10, $11, $12, $13)`,
          [
            orderId,
            resolvedUserUuid,
            `cod-${orderId}`,
            subtotal,
            shippingFee,
            totalAmount,
            JSON.stringify(effectiveAddress),
            codTxId,
            cleanCoupon || null,
            validatedDiscount || 0,
            taxAmount, taxInclusive, taxRatePercent,
          ]
        );

        await reserveStock(client, orderId, verifiedItems);
        await commitStockReservation(client, orderId);

        // Track coupon usage if a coupon was applied
        if (cleanCoupon && validatedDiscount > 0 && resolvedUserUuid) {
          await client.query(
            `
            INSERT INTO coupon_usages (coupon_code, user_id, order_id, discount_amount)
            VALUES ($1, $2, $3, $4)
            `,
            [cleanCoupon, resolvedUserUuid, orderId, validatedDiscount]
          );
        }

        for (const it of [...verifiedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await client.query(
            `INSERT INTO order_items (id, order_id, product_id, product_name, unit_price, quantity, image_url)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
            [orderId, it.productId, it.productName, it.unitPrice, it.quantity, it.imageUrl || '']
          );
        }
      });

      const codTxId = `pay_cod_${orderId.slice(0, 8)}`;
      const receipt = {
        success: true,
        orderId,
        paymentId: '',
        transactionId: '',
        receiptNumber: `RCPT-UB-${orderId.slice(0, 8).toUpperCase()}`,
        status: 'confirmed',
        paymentStatus: 'pending',
        totalAmount,
        subtotal, shippingFee, discountAmount: validatedDiscount, couponCode: cleanCoupon, taxAmount, taxInclusive, taxRatePercent,
        currency: 'INR',
        confirmedAt: new Date().toISOString(),
        shippingAddress,
        items: verifiedItems.map((it, idx) => ({
          id: `item-${idx}`,
          product_name: it.productName,
          unit_price: it.unitPrice,
          quantity: it.quantity,
          image_url: it.imageUrl,
        })),
        paymentDetails: {
          method: 'Cash on Delivery',
          transactionId: '',
          instruction: 'Pay upon delivery at your doorstep.',
        },
      };

      return reply.status(201).send(receipt);
    } catch (err: any) {
      return reply.status(400).send({
        error: 'COD_ORDER_FAILED',
        message: /^(INVALID_|INSUFFICIENT_|PRODUCT_|DUPLICATE_|STORE_CLOSED)/.test(err.message || '') ? err.message : 'Unable to place your order. Please retry.',
      });
    }
  });

  // ─── GET ORDER BY ID (PROTECTED WITH OWNERSHIP VERIFICATION) ─────────────
  app.get<{ Params: { orderId: string } }>(
    '/orders/:orderId',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { orderId } = request.params;
      const user = request.user;

      if (!user) {
        return reply.status(401).send({
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Please sign in to view order details.',
        });
      }

      try {
        const orderRes = await query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [orderId]);
        if (orderRes.rows.length === 0) {
          return reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
        }

        const order = orderRes.rows[0];
        const shipping = typeof order.shipping_address === 'string' ? JSON.parse(order.shipping_address) : order.shipping_address;

        // BOLA / IDOR ownership validation
        if (user && user.role !== 'admin' && user.role !== 'vendor') {
          const isOwner = order.user_id === user.id;
          if (!isOwner) {
            return reply.status(403).send({
              error: 'FORBIDDEN',
              message: 'You do not have permission to view another customer order.',
            });
          }
        }

        if (user.role === 'vendor') {
          const vendorName = (user.vendorName || user.name).trim();
          const vendorOrder = await query(
            `SELECT 1
             FROM order_items oi
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE oi.order_id = $1
               AND LOWER(p.vendor) = LOWER($2)
             LIMIT 1`,
            [orderId, vendorName]
          );
          if (vendorOrder.rows.length === 0) {
            return reply.status(403).send({
              error: 'FORBIDDEN',
              message: 'This order does not contain products from your vendor account.',
            });
          }
        }

        const itemsRes = user.role === 'vendor'
          ? await query(
              `SELECT oi.*, p.vendor
               FROM order_items oi
               JOIN products p ON p.id = oi.product_id
               WHERE oi.order_id = $1 AND LOWER(p.vendor) = LOWER($2)`,
              [orderId, (user.vendorName || user.name).trim()]
            )
          : await query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);
        const vendorSubtotal = user.role === 'vendor'
          ? itemsRes.rows.reduce(
              (sum, item) => sum + Number(item.unit_price) * Number(item.quantity),
              0
            )
          : null;
        return reply.send({
          ...order,
          subtotal: vendorSubtotal ?? Number(order.subtotal),
          total_amount: vendorSubtotal ?? Number(order.total_amount),
          discount_amount: user.role === 'vendor' ? 0 : Number(order.discount_amount || 0),
          coupon_code: user.role === 'vendor' ? null : order.coupon_code,
          shipping_address: shipping,
          items: itemsRes.rows,
        });
      } catch (err: any) {
        return reply.status(500).send({ error: 'FETCH_FAILED', message: err.message });
      }
    }
  );

  // ─── GET USER ORDERS HISTORY (SCOPED TO AUTHENTICATED USER) ───────────────
  app.get<{ Querystring: { email?: string; userId?: string } }>(
    '/orders',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const { email, userId } = request.query || {};
      const user = request.user;

      // Access control & IDOR prevention:
      // If user is authenticated as customer, enforce that they can ONLY see their own orders!
      let filterUserId: string | null = null;
      let filterEmail: string | null = null;

      if (user && user.role !== 'admin' && user.role !== 'vendor') {
        filterUserId = user.id;
        filterEmail = user.email;
      } else if (user?.role === 'admin') {
        filterUserId = userId || null;
        filterEmail = email || null;
      } else if (user?.role === 'vendor') {
        // Vendor scope is applied below from the signed token, never from a
        // caller-controlled query parameter.
      } else {
        // Guests may recover order history by the exact checkout email only.
        // Arbitrary user IDs are not accepted because they enable enumeration.
        if (!email) {
          return reply.status(401).send({
            error: 'AUTHENTICATION_REQUIRED',
            message: 'Please sign in or provide your registered order email to view orders.',
          });
        }
        filterEmail = email || null;
      }

      try {
        const isVendorView = user?.role === 'vendor';
        const subtotalSelect = isVendorView
          ? `COALESCE(SUM(CASE WHEN LOWER(p.vendor) = LOWER($1)
              THEN oi.unit_price * oi.quantity ELSE 0 END), 0)::numeric`
          : 'o.subtotal::numeric';
        const totalSelect = isVendorView
          ? `COALESCE(SUM(CASE WHEN LOWER(p.vendor) = LOWER($1)
              THEN oi.unit_price * oi.quantity ELSE 0 END), 0)::numeric`
          : 'o.total_amount::numeric';
        const itemScope = isVendorView ? 'AND LOWER(p.vendor) = LOWER($1)' : '';
        let sql = `
          SELECT 
            o.id, 
            o.user_id,
            o.status, 
            ${subtotalSelect} AS subtotal,
            ${totalSelect} AS total_amount,
            ${isVendorView ? '0::numeric' : 'o.discount_amount::numeric'} AS discount_amount,
            o.coupon_code,
            o.tracking_number,
            o.currency,
            o.payment_method, 
            o.payment_status, 
            o.transaction_id,
            o.shipping_address, 
            o.created_at,
            o.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', oi.id,
                  'product_id', oi.product_id,
                  'product_name', oi.product_name,
                  'unit_price', oi.unit_price::numeric,
                  'quantity', oi.quantity,
                  'image_url', oi.image_url,
                  'vendor', p.vendor
                )
              ) FILTER (WHERE oi.id IS NOT NULL ${itemScope}), '[]'
            ) as items
          FROM orders o
          LEFT JOIN order_items oi ON oi.order_id = o.id
          LEFT JOIN products p ON p.id = oi.product_id
        `;

        const params: any[] = [];
        const conditions: string[] = [];

        if (filterUserId && filterEmail) {
          params.push(filterUserId);
          conditions.push(`o.user_id::text = $1`);
        } else if (filterUserId) {
          params.push(filterUserId);
          conditions.push(`o.user_id::text = $1`);
        } else if (filterEmail) {
          params.push(filterEmail.trim().toLowerCase());
          conditions.push(`LOWER(COALESCE(o.shipping_address->>'email', '')) = $1`);
        }

        if (user?.role === 'vendor') {
          params.push((user.vendorName || user.name).trim());
          const vendorParam = `$${params.length}`;
          conditions.push(`EXISTS (
            SELECT 1
            FROM order_items vendor_oi
            LEFT JOIN products vendor_p ON vendor_p.id = vendor_oi.product_id
            WHERE vendor_oi.order_id = o.id
              AND LOWER(vendor_p.vendor) = LOWER(${vendorParam})
          )`);
        }

        if (conditions.length > 0) {
          sql += ` WHERE ${conditions.join(' AND ')} `;
        }

        sql += ` GROUP BY o.id ORDER BY o.created_at DESC LIMIT 50; `;
        const res = await query(sql, params);
        const mapped = res.rows.map((r) => ({
          ...r,
          subtotal: Number(r.subtotal),
          total_amount: Number(r.total_amount),
          discount_amount: Number(r.discount_amount || 0),
          shipping_address: typeof r.shipping_address === 'string' ? JSON.parse(r.shipping_address) : r.shipping_address,
        }));
        return reply.send(mapped);
      } catch (err: any) {
        request.log.error(err, 'Failed to fetch user orders');
        return reply.send([]);
      }
    }
  );
}
