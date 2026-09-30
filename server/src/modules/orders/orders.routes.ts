import { FastifyInstance } from 'fastify';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { settleCapturedPayment } from './payment-settlement.service.js';
import { query, withTransaction } from '../../db/pool.js';
import { enqueueOrderJob, OrderJobPayload } from '../../queue/order-saga.queue.js';
import { config } from '../../config.js';
import { optionalAuth, requireAuth } from '../../core/auth.middleware.js';
import {
  cancelOrderAndReleaseStock,
  claimPendingOrder,
  commitStockReservation,
  releaseStockReservation,
  reserveStock,
} from './stock-reservation.service.js';

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
      `SELECT id, name, price, stock_quantity, stock_reserved, image_url, in_stock FROM products WHERE ${
        isUUID
          ? 'id = $1'
          : 'slug = $1 OR slug = $2 OR slug = $3 OR id::text = $1 OR name ILIKE $2 OR name ILIKE $3'
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
      productName: product.name,
      unitPrice: parseFloat(product.price),
      quantity: it.quantity,
      imageUrl: product.image_url,
    });
  }

  const subtotal = verifiedItems.reduce((acc, it) => acc + it.unitPrice * it.quantity, 0);

  // Authoritative Coupon Validation (zero client tampering)
  let validatedDiscount = 0;
  let cleanCoupon = '';
  if (couponCode) {
    cleanCoupon = couponCode.trim().toUpperCase();
    const KNOWN_COUPONS: Record<string, { type: 'percent' | 'flat'; val: number; min: number; max?: number }> = {
      BLADE10: { type: 'percent', val: 10, min: 499, max: 200 },
      WELCOME20: { type: 'percent', val: 20, min: 999, max: 400 },
      FIRST100: { type: 'flat', val: 100, min: 599 },
      VIP20: { type: 'percent', val: 20, min: 1499, max: 500 },
    };
    const rule = KNOWN_COUPONS[cleanCoupon];
    if (!rule || subtotal < rule.min) throw new Error('INVALID_COUPON: Coupon is invalid or the minimum order value has not been reached.');
    if (rule && subtotal >= rule.min) {
      validatedDiscount = rule.type === 'percent'
        ? Math.min(rule.max || 9999, Math.round((subtotal * rule.val) / 100))
        : Math.min(subtotal, rule.val);
    }
  }

  const taxableSubtotal = Math.max(0, subtotal - validatedDiscount);
  const shippingFee = taxableSubtotal >= 999 || subtotal >= 999 ? 0 : 99;
  const totalAmount = Math.round((taxableSubtotal + shippingFee) * 100) / 100;

  return { verifiedItems, subtotal, discountAmount: validatedDiscount, couponCode: cleanCoupon, shippingFee, totalAmount };
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
      if (typeof address.fullName !== 'string' || address.fullName.trim().length < 2 ||
          typeof address.phone !== 'string' || !/^[0-9]{10}$/.test(address.phone) ||
          typeof address.street !== 'string' || address.street.trim().length < 5 ||
          typeof address.city !== 'string' || address.city.trim().length < 2) {
        return reply.code(400).send({ error: 'INVALID_ADDRESS', message: 'Enter a complete delivery address and a 10-digit phone number.' });
      }
      address.email = request.user.email;
    }
    if (path.endsWith('/cancel-payment') || path.endsWith('/razorpay/verify')) {
      if (!toValidUuidOrNull(body.orderId)) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });
      const order = await query('SELECT user_id, payment_method FROM orders WHERE id = $1', [body.orderId]);
      if (path.endsWith('/cancel-payment') && order.rows[0]?.payment_method === 'Razorpay') return reply.code(409).send({ error: 'PAYMENT_IN_PROGRESS', message: 'Online payment reservations are reconciled automatically.' });
      if (!order.rows[0] || order.rows[0].user_id !== request.user.id) {
        return reply.code(404).send({ error: 'ORDER_NOT_FOUND' });
      }
    }
  });
  app.post<{ Body: { items: Array<{productId: string; quantity: number}>; couponCode?: string } }>('/orders/quote', async (request, reply) => {
    try { return await resolveAndVerifyItems(request.body.items, request.body.couponCode); }
    catch (err: any) { return reply.code(400).send({ error: 'INVALID_CHECKOUT', message: err.message }); }
  });

  // ─── 1. REAL-TIME TWO-PHASE CHECKOUT SESSION WITH ATOMIC INVENTORY LOCK ────
  app.post<{
    Body: {
      items: Array<{
        productId: string;
        quantity: number;
      }>;
      shippingAddress: {
        fullName: string;
        phone: string;
        street: string;
        city?: string;
        postalCode?: string;
      };
      paymentMethod?: 'upi' | 'card' | 'cash_on_delivery';
      userId?: string;
    };
  }>('/orders/checkout-session', async (request, reply) => {
    const { items, shippingAddress, paymentMethod = 'upi', couponCode, discountAmount, userId } = request.body as any;

    if (!items || items.length === 0) {
      return reply.status(400).send({ error: 'EMPTY_CART', message: 'Cart cannot be empty' });
    }
    if (!shippingAddress?.fullName || !shippingAddress?.phone) {
      return reply.status(400).send({ error: 'INVALID_ADDRESS', message: 'Customer name and phone are required' });
    }

    const orderId = crypto.randomUUID();
    const idempotencyKey = (request.headers['x-idempotency-key'] as string) || `checkout-${orderId}`;

    try {
      // 1. Authoritative resolution & stock validation from Neon DB
      const { verifiedItems, subtotal, discountAmount: validatedDiscount, couponCode: cleanCoupon, shippingFee, totalAmount } =
        await resolveAndVerifyItems(items, couponCode, discountAmount);

      // 2. Atomically reserve inventory and insert pending order shell in Neon PostgreSQL
      await withTransaction(async (client) => {
        // Payment-first: the order shell is inserted first, then stock is held
        // against it so the reservation ledger can reference the order row.
        const effectiveAddress = {
          ...shippingAddress,
          email: (shippingAddress as any)?.email || (request.body as any)?.userEmail || 'customer@urbanblade.in',
        };
        const resolvedUserUuid = await resolveUserId(userId, effectiveAddress.email);

        // Insert order record
        await client.query(
          `
          INSERT INTO orders (
            id, user_id, idempotency_key, status, subtotal, shipping_fee,
            total_amount, currency, shipping_address, payment_method, payment_status, transaction_id,
            coupon_code, discount_amount, created_at, updated_at
          ) VALUES (
            $1, $2, $3, 'accepted', $4, $5, $6, 'INR', $7, $8, 'pending', $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          );
          `,
          [
            orderId,
            resolvedUserUuid,
            idempotencyKey,
            subtotal,
            shippingFee,
            totalAmount,
            JSON.stringify(effectiveAddress),
            paymentMethod,
            `tx_init_${orderId.slice(0, 8)}`,
            cleanCoupon || null,
            validatedDiscount || 0,
          ]
        );

        // Reserve inventory against this order (ledger row + stock_reserved bump).
        await reserveStock(client, orderId, verifiedItems);

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

        // Insert order items
        for (const it of [...verifiedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await client.query(
            `
            INSERT INTO order_items (
              id, order_id, product_id, product_name, unit_price, quantity, image_url
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6
            );
            `,
            [orderId, it.productId, it.productName, it.unitPrice, it.quantity, it.imageUrl || '']
          );
        }
      });

      // 4. Generate Cryptographic Payment Intent Token (HMAC-SHA256)
      const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes window
      const signatureToken = crypto
        .createHmac('sha256', config.payment.signingSecret)
        .update(`${orderId}:${totalAmount}:${expiresAt}`)
        .digest('hex');

      return reply.status(201).send({
        orderId,
        subtotal,
        shippingFee,
        totalAmount,
        currency: 'INR',
        signatureToken,
        expiresAt,
        paymentMethod,
        items: verifiedItems,
        shippingAddress,
      });
    } catch (err: any) {
      if (err.message?.startsWith('INVALID_QUANTITY:')) {
        return reply.status(400).send({
          error: 'INVALID_QUANTITY',
          message: err.message.replace('INVALID_QUANTITY: ', ''),
        });
      }
      if (err.message?.startsWith('PRODUCT_NOT_FOUND:')) {
        return reply.status(404).send({
          error: 'PRODUCT_NOT_FOUND',
          message: err.message.replace('PRODUCT_NOT_FOUND: ', ''),
        });
      }
      if (err.message?.startsWith('INSUFFICIENT_STOCK:')) {
        return reply.status(400).send({
          error: 'INSUFFICIENT_STOCK',
          message: err.message.replace('INSUFFICIENT_STOCK: ', ''),
        });
      }
      if (err.message?.startsWith('INSUFFICIENT_STOCK_RACE:')) {
        const [, prodName, available] = err.message.split(':');
        return reply.status(409).send({
          error: 'CONCURRENT_STOCK_DEPLETION',
          message: prodName
            ? `Stock for "${prodName}" was just purchased by another customer (only ${available ?? 0} left).`
            : 'Stock was just purchased by another customer.',
        });
      }
      request.log.error(err, 'Failed to create checkout session');
      return reply.status(500).send({
        error: 'CHECKOUT_SESSION_FAILED',
        message: 'Could not create secure checkout session. Please try again.',
      });
    }
  });

  // ─── 2. CRYPTOGRAPHIC PAYMENT VERIFICATION & FINALIZATION ──────────────────
  app.post<{
    Body: {
      orderId: string;
      paymentId: string;
      signatureToken: string;
      expiresAt: number;
      paymentDetails?: {
        upiVpa?: string;
        cardLast4?: string;
        network?: string;
      };
    };
  }>('/orders/verify-payment', async (request, reply) => {
    const { orderId, paymentId, signatureToken, expiresAt, paymentDetails } = request.body;

    if (!orderId || !paymentId || !signatureToken || !expiresAt) {
      return reply.status(400).send({
        error: 'MISSING_VERIFICATION_PARAMS',
        message: 'Order ID, Payment ID, and cryptographic signature are required.',
      });
    }

    // 1. Session expiration check
    if (Date.now() > expiresAt) {
      return reply.status(410).send({
        error: 'PAYMENT_SESSION_EXPIRED',
        message: 'Payment session has expired. Please initiate checkout again.',
      });
    }

    try {
      // 2. Fetch order from Neon DB
      const orderRes = await query('SELECT * FROM orders WHERE id = $1 LIMIT 1', [orderId]);
      if (orderRes.rows.length === 0) {
        return reply.status(404).send({ error: 'ORDER_NOT_FOUND', message: 'Order not found' });
      }

      const order = orderRes.rows[0];
      const totalAmount = parseFloat(order.total_amount);

      // 3. Cryptographic HMAC Signature Verification (Timing-safe)
      const expectedSignature = crypto
        .createHmac('sha256', config.payment.signingSecret)
        .update(`${orderId}:${totalAmount}:${expiresAt}`)
        .digest('hex');

      const isSignatureValid =
        signatureToken.length === expectedSignature.length &&
        crypto.timingSafeEqual(Buffer.from(signatureToken, 'hex'), Buffer.from(expectedSignature, 'hex'));

      if (!isSignatureValid) {
        return reply.status(403).send({
          error: 'SECURITY_TAMPER_DETECTED',
          message: 'Payment verification failed: invalid or tampered security signature.',
        });
      }

      // 4. Commit the stock reservation and finalise the order atomically.
      //
      // claimPendingOrder() locks the order row and only flips it while it is
      // still accepted/pending. If it returns false, another request (a replay
      // of this same verify, the cancel endpoint, or the TTL reaper) already
      // resolved the order, so we must NOT touch stock a second time.
      const outcome = await withTransaction(async (client) => {
        const claimed = await claimPendingOrder(client, orderId, {
          status: 'confirmed',
          payment_status: 'captured',
          extraSet: 'transaction_id = $4',
          params: [paymentId],
        });
        if (!claimed) return { claimed: false, unapplied: [] as any[] };

        const stock = await commitStockReservation(client, orderId);
        return { claimed: true, unapplied: stock.unapplied };
      });

      if (!outcome.claimed) {
        const current = await query('SELECT status, payment_status FROM orders WHERE id = $1', [orderId]);
        const row = current.rows[0] || {};
        if (row.payment_status === 'captured') {
          // Idempotent success: safe to retry this endpoint after a double-tap.
          return reply.send({
            success: true,
            orderId,
            paymentId,
            transactionId: paymentId,
            receiptNumber: `RCPT-UB-${orderId.slice(0, 8).toUpperCase()}`,
            status: row.status ?? 'confirmed',
            paymentStatus: 'captured',
            totalAmount,
            currency: 'INR',
            alreadyProcessed: true,
          });
        }
        return reply.status(409).send({
          error: 'ORDER_NOT_PENDING',
          message: `This order is no longer awaiting payment (status: ${row.status ?? 'unknown'}, payment: ${row.payment_status ?? 'unknown'}).`,
        });
      }

      if (outcome.unapplied.length > 0) {
        // Should be unreachable: a live reservation can always be committed.
        // Surfaced loudly rather than silently mis-reporting a confirmed order.
        request.log.error(
          { orderId, unapplied: outcome.unapplied },
          'Stock commit partially failed after payment capture — manual reconciliation required'
        );
        throw new Error('STOCK_COMMIT_FAILED');
      }

      // Fetch updated order details
      const orderDetails = await query('SELECT shipping_address, payment_method FROM orders WHERE id = $1', [orderId]);
      const itemsRes = await query('SELECT * FROM order_items WHERE order_id = $1', [orderId]);

      const receiptNumber = `RCPT-UB-${orderId.slice(0, 8).toUpperCase()}`;

      return reply.send({
        success: true,
        orderId,
        paymentId,
        transactionId: paymentId,
        receiptNumber,
        status: 'confirmed',
        paymentStatus: 'captured',
        totalAmount,
        currency: 'INR',
        confirmedAt: new Date().toISOString(),
        shippingAddress: orderDetails.rows[0]?.shipping_address,
        items: itemsRes.rows,
        paymentDetails: paymentDetails || { method: orderDetails.rows[0]?.payment_method },
      });
    } catch (err: any) {
      request.log.error(err, 'Payment verification error');
      return reply.status(500).send({
        error: 'VERIFICATION_ERROR',
        message: 'Internal server error while finalizing order.',
      });
    }
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
  // ─── ASYNCHRONOUS ORDER PLACEMENT (AMAZON 202 SAGA IN < 15MS) ─────────────
  app.post<{
    Body: {
      items: Array<{
        productId: string;
        quantity: number;
      }>;
      shippingAddress: any;
      paymentMethod?: string;
      couponCode?: string;
      userId?: string;
    };
  }>('/orders', async (request, reply) => {
    const {
      items,
      shippingAddress,
      paymentMethod = 'cash_on_delivery',
      couponCode,
      userId,
    } = request.body as any;

    if (!items || items.length === 0) {
      return reply.status(400).send({ error: 'EMPTY_ORDER', message: 'Cart items are required' });
    }
    if (!shippingAddress?.fullName || !shippingAddress?.phone) {
      return reply.status(400).send({ error: 'INVALID_ADDRESS', message: 'Customer name and phone are required' });
    }

    // 1. Authoritative price and stock verification from database (zero client tampering)
    const { verifiedItems, subtotal, shippingFee, totalAmount, discountAmount, couponCode: cleanCoupon } =
      await resolveAndVerifyItems(items, couponCode);

    const orderId = crypto.randomUUID();
    const idempotencyKey =
      (request.headers['x-idempotency-key'] as string) || `auto-${orderId}`;

    const effectiveAddress = {
      ...shippingAddress,
      email: (shippingAddress as any)?.email || (request.body as any)?.userEmail || 'customer@urbanblade.in',
    };
    const resolvedUserUuid = await resolveUserId(userId, effectiveAddress.email);

    const orderPayload: OrderJobPayload = {
      orderId,
      idempotencyKey,
      items: verifiedItems,
      subtotal,
      shippingFee,
      totalAmount,
      currency: 'INR',
      shippingAddress: effectiveAddress,
      paymentMethod,
    };

    // 2. Insert Initial Pending Order Shell into DB
    try {
      await withTransaction(async (client) => {
        await client.query(
          `
          INSERT INTO orders (
            id, user_id, idempotency_key, status, subtotal, shipping_fee, 
            total_amount, currency, shipping_address, payment_method, payment_status, transaction_id,
            coupon_code, discount_amount
          ) VALUES (
            $1, $2, $3, 'accepted', $4, $5, $6, 'INR', $7, $8, 'pending', $9, $10, $11
          );
          `,
          [
            orderId,
            resolvedUserUuid,
            idempotencyKey,
            subtotal,
            shippingFee,
            totalAmount,
            JSON.stringify(effectiveAddress),
            paymentMethod,
            `tx_saga_${orderId.slice(0, 8)}`,
            cleanCoupon || null,
            discountAmount || 0,
          ]
        );

        // Track coupon usage if a coupon was applied
        if (cleanCoupon && discountAmount > 0 && resolvedUserUuid) {
          await client.query(
            `
            INSERT INTO coupon_usages (coupon_code, user_id, order_id, discount_amount)
            VALUES ($1, $2, $3, $4)
            `,
            [cleanCoupon, resolvedUserUuid, orderId, discountAmount]
          );
        }

        for (const it of [...verifiedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await client.query(
            `
            INSERT INTO order_items (
              id, order_id, product_id, product_name, unit_price, quantity, image_url
            ) VALUES (
              gen_random_uuid(), $1, $2, $3, $4, $5, $6
            );
            `,
            [orderId, it.productId, it.productName, it.unitPrice, it.quantity, it.imageUrl || '']
          );
        }
        // Reserve inventory against the accepted order so the units are held
        // while the saga runs; the queue commits them on success and the
        // reapers release them if the saga never lands.
        await reserveStock(client, orderId, verifiedItems);
      });
    } catch (err: any) {
      // Never acknowledge an order the database did not persist.
      if (err.message?.startsWith('INSUFFICIENT_STOCK_RACE:')) {
        const [, prodName, available] = err.message.split(':');
        return reply.status(409).send({
          error: 'CONCURRENT_STOCK_DEPLETION',
          message: `Stock for "${prodName}" was just purchased by another customer (only ${available ?? 0} left).`,
        });
      }
      request.log.error({ err }, 'Failed to persist accepted order');
      return reply.status(500).send({
        error: 'ORDER_PERSISTENCE_FAILED',
        message: 'We could not place this order. Please try again.',
      });
    }

    // 3. Offload Inventory Deduction & Saga Validation to BullMQ Queue
    await enqueueOrderJob(orderPayload);

    // 4. Return HTTP 202 Accepted immediately
    return reply.status(202).send({
      orderId,
      status: 'accepted',
      totalAmount,
      currency: 'INR',
      message: 'Order accepted for asynchronous fulfillment.',
      estimatedDelivery: '2–4 business days',
    });
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
      const { verifiedItems, subtotal, discountAmount: validatedDiscount, couponCode: cleanCoupon, shippingFee, totalAmount } =
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
      await withTransaction(async (client) => {
        const effectiveAddress = {
          ...shippingAddress,
          email: (shippingAddress as any).email || (request.body as any).userEmail || 'customer@urbanblade.in',
        };
        const resolvedUserUuid = await resolveUserId(userId, effectiveAddress.email);

        // Insert pending order
        await client.query(
          `INSERT INTO orders (
            id, user_id, idempotency_key, status, subtotal, shipping_fee, total_amount, currency,
            shipping_address, payment_method, payment_status, transaction_id, coupon_code, discount_amount
          ) VALUES ($1, $2, $3, 'accepted', $4, $5, $6, 'INR', $7, 'Razorpay', 'pending', $8, $9, $10)`,
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
        currency: 'INR',
        keyId: config.razorpay.keyId,
        items: verifiedItems,
        shippingAddress,
      });
    } catch (err: any) {
      request.log.error({ err }, 'Failed to create Razorpay checkout order');
      return reply.status(400).send({
        error: 'RAZORPAY_ORDER_FAILED',
        message: err.message || 'Unable to reserve inventory in Neon PostgreSQL',
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
        totalAmount: parseFloat(order.total_amount),
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
      const { verifiedItems, subtotal, discountAmount: validatedDiscount, couponCode: cleanCoupon, shippingFee, totalAmount } =
        await resolveAndVerifyItems(items, couponCode, discountAmount);
      const expectedTotal = (request.body as any).expectedTotal;
      if (typeof expectedTotal !== 'number' || Math.round(expectedTotal * 100) !== Math.round(totalAmount * 100)) {
        return reply.code(409).send({ error: 'PRICE_CHANGED', message: 'Prices have changed. Review your cart and try again.' });
      }
      const orderId = crypto.randomUUID();

      await withTransaction(async (client) => {
        for (const it of [...verifiedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
          // Lock the product row for update
          await client.query('SELECT 1 FROM products WHERE id = $1 FOR UPDATE', [it.productId]);
          const updateRes = await client.query(
            `UPDATE products
             SET stock_reserved = stock_reserved + $1,
                 version = version + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2 AND (stock_quantity - stock_reserved) >= $1
             RETURNING stock_quantity, stock_reserved;`,
            [it.quantity, it.productId]
          );

          if (updateRes.rowCount === 0) {
            throw new Error(`Atomic lock failed: Insufficient stock for ${it.productName}`);
          }
        }

        const effectiveAddress = {
          ...shippingAddress,
          email: (shippingAddress as any).email || (request.body as any).userEmail || 'customer@urbanblade.in',
        };
        const resolvedUserUuid = await resolveUserId(userId, effectiveAddress.email);
        const codTxId = `pay_cod_${orderId.slice(0, 8)}`;
        // Commit stock reservation for COD (confirmed immediately)
        for (const it of [...verifiedItems].sort((a, b) => a.productId.localeCompare(b.productId))) {
          await client.query(
            `
            UPDATE products
            SET stock_quantity = stock_quantity - $1,
                stock_reserved = stock_reserved - $1,
                in_stock = (stock_quantity - $1 > 0),
                version = version + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $2;
            `,
            [it.quantity, it.productId]
          );
        }

        await client.query(
          `INSERT INTO orders (
            id, user_id, idempotency_key, status, subtotal, shipping_fee, total_amount, currency,
            shipping_address, payment_method, payment_status, transaction_id, coupon_code, discount_amount
          ) VALUES ($1, $2, $3, 'confirmed', $4, $5, $6, 'INR', $7, 'Cash on Delivery', 'pending', $8, $9, $10)`,
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
        paymentId: codTxId,
        transactionId: codTxId,
        receiptNumber: `RCPT-UB-${orderId.slice(0, 8).toUpperCase()}`,
        status: 'confirmed',
        paymentStatus: 'pending',
        totalAmount,
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
          transactionId: codTxId,
          instruction: 'Pay upon delivery at your doorstep.',
        },
      };

      return reply.status(201).send(receipt);
    } catch (err: any) {
      return reply.status(400).send({
        error: 'COD_ORDER_FAILED',
        message: err.message || 'Unable to place Cash on Delivery order',
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
