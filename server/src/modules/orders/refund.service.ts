import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { invalidateCatalog } from '../../redis/cache.service.js';
import { paymentGateway } from './payment-settlement.service.js';
import { releaseStockReservation } from './stock-reservation.service.js';
import { recordGatewayPayment } from './payment-snapshot.service.js';

type RefundGateway = ReturnType<typeof paymentGateway>;
type RefundState = 'pending' | 'processed' | 'failed';

type GatewayRefund = {
  id: string;
  payment_id: string;
  status: RefundState;
  amount?: number;
  receipt?: string | null;
  notes?: Record<string, unknown>;
};

export async function restoreCommittedStock(client: PoolClient, orderId: string): Promise<number> {
  await releaseStockReservation(client, orderId);
  const committed = await client.query(
    "SELECT product_id, quantity FROM stock_reservations WHERE order_id = $1 AND status = 'committed' ORDER BY product_id FOR UPDATE",
    [orderId]
  );
  for (const item of committed.rows) {
    if (item.product_id) {
      await client.query(
        'UPDATE products SET stock_quantity = stock_quantity + $1, version = version + 1 WHERE id = $2',
        [item.quantity, item.product_id]
      );
    }
  }
  await client.query(
    "UPDATE stock_reservations SET status = 'restored', resolved_at = NOW() WHERE order_id = $1 AND status = 'committed'",
    [orderId]
  );
  return committed.rows.length;
}

async function applyGatewayRefund(orderId: string, refund: GatewayRefund) {
  const result = await withTransaction(async client => {
    const locked = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = locked.rows[0];
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (refund.payment_id !== order.razorpay_payment_id) throw new Error('REFUND_PAYMENT_MISMATCH');
    const expectedAmount = Math.round(Number(order.total_amount) * 100);
    if (!Number.isInteger(refund.amount) || Number(refund.amount) !== expectedAmount) throw new Error('REFUND_AMOUNT_MISMATCH');

    if (!['pending', 'processed', 'failed'].includes(refund.status)) throw new Error('INVALID_REFUND_STATUS');
    if (order.refund_id && order.refund_id !== refund.id) throw new Error('REFUND_ID_MISMATCH');
    if (order.refund_status === 'processed' || refund.status === 'processed') {
      // Also repair an older imported snapshot when a settled event is replayed.
      await client.query(`UPDATE gateway_payments SET status = 'refunded',
        refunded_paise = GREATEST(refunded_paise, $2), checked_at = NOW() WHERE id = $1`,
      [refund.payment_id, expectedAmount]);
    }
    // Terminal success must survive delayed and duplicate gateway notifications.
    if (order.refund_status === 'processed') return { order, restored: false };
    if (order.refund_status === 'failed' && refund.status === 'pending') return { order, restored: false };
    if (refund.status === 'failed') {
      const failed = await client.query(
        `UPDATE orders SET refund_status = 'failed', refund_id = $2,
          refund_failure_reason = 'Gateway reported refund failure', updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [orderId, refund.id]
      );
      return { order: failed.rows[0], restored: false };
    }

    const restoredCount = ['shipped', 'delivered'].includes(order.status) && order.return_status !== 'received' ? 0 : await restoreCommittedStock(client, orderId);
    const updated = await client.query(
      `UPDATE orders SET status = CASE WHEN status IN ('shipped', 'delivered') THEN status ELSE 'cancelled' END, refund_status = $2::varchar, refund_id = $3,
        refund_amount = total_amount,
        payment_status = CASE WHEN $2::text = 'processed' THEN 'refunded' ELSE payment_status END,
        refunded_at = CASE WHEN $2::text = 'processed' THEN COALESCE(refunded_at, NOW()) ELSE refunded_at END,
        refund_failure_reason = NULL,
        payment_reconciliation_error = CASE WHEN $2::text = 'processed' THEN NULL ELSE payment_reconciliation_error END,
        version = version + 1, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [orderId, refund.status, refund.id]
    );
    return { order: updated.rows[0], restored: restoredCount > 0 };
  });
  if (result.restored) await invalidateCatalog().catch(() => {});
  return result.order;
}

export async function initiateOrderRefund(
  orderId: string,
  reason: string,
  gateway?: RefundGateway
) {
  const claim = await withTransaction(async client => {
    const locked = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const order = locked.rows[0];
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.payment_method !== 'Razorpay') throw new Error('ONLINE_REFUND_ONLY');
    if (order.payment_status === 'refunded' || order.refund_status === 'processed') {
      return { action: 'complete' as const, order };
    }
    if (order.payment_status !== 'captured' || !order.razorpay_payment_id) throw new Error('PAYMENT_NOT_CAPTURED');
    if (['shipped', 'delivered'].includes(order.status) && order.return_status !== 'received') throw new Error('ORDER_ALREADY_FULFILLED');
    if (order.refund_id) return { action: 'reconcile' as const, order };
    if (order.refund_status === 'pending') {
      return { action: 'recover' as const, order };
    }

    const receipt = order.refund_receipt || `refund_${String(order.id).replaceAll('-', '')}`;
    const updated = await client.query(
      `UPDATE orders SET refund_status = 'pending', refund_receipt = $2,
        refund_reason = $3, refund_requested_at = NOW(), refund_failure_reason = NULL,
        updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId, receipt, reason]
    );
    return { action: 'create' as const, order: updated.rows[0] };
  });

  if (claim.action === 'complete') return claim.order;

  // Only a fresh claim can be retried after a pre-submission lookup failure.
  // Once the refund POST starts, a timeout is ambiguous and must stay pending.
  let requestStarted = false;
  let refundFound = false;
  try {
    gateway ??= paymentGateway();
    let refund: GatewayRefund | undefined;
    if (claim.action === 'reconcile') {
      refund = await gateway.payments.fetchRefund(claim.order.razorpay_payment_id, claim.order.refund_id) as GatewayRefund;
    } else {
      // A previous network timeout may have created the refund without storing
      // its response. Recover it by our stable receipt before creating another.
      const existing = await gateway.payments.fetchMultipleRefund(claim.order.razorpay_payment_id);
      refund = existing.items.find(item => item.receipt === claim.order.refund_receipt) as GatewayRefund | undefined;
      refundFound = Boolean(refund);
      if (!refund && claim.action === 'recover') {
        // Never create another refund after an ambiguous timeout or process crash.
        // A signed webhook or provider lookup will reconcile the first attempt.
        return claim.order;
      }
      if (!refund) {
        // A dashboard refund may have happened since our last reconciliation.
        // Never submit the full order amount on top of an existing repayment.
        const payment = await gateway.payments.fetch(claim.order.razorpay_payment_id);
        await recordGatewayPayment(payment);
        if (payment.id !== claim.order.razorpay_payment_id
          || Number(payment.amount) !== Math.round(Number(claim.order.total_amount) * 100)
          || payment.currency !== claim.order.currency
          || (claim.order.idempotency_key && payment.order_id !== claim.order.idempotency_key)) {
          throw new Error('PAYMENT_MISMATCH');
        }
        if (Number(payment.amount_refunded || 0) > 0 || payment.status === 'refunded'
          || existing.items.some(item => ['pending', 'processed'].includes(item.status))) {
          throw new Error('PARTIAL_REFUND_REQUIRES_REVIEW');
        }
        if (payment.status !== 'captured') throw new Error('PAYMENT_NOT_CAPTURED');
        requestStarted = true;
        refund = await gateway.payments.refund(claim.order.razorpay_payment_id, {
          amount: Math.round(Number(claim.order.total_amount) * 100),
          speed: 'normal',
          receipt: claim.order.refund_receipt,
          notes: { order_id: orderId, reason },
        }) as GatewayRefund;
      }
    }
    return await applyGatewayRefund(orderId, refund);
  } catch (error: any) {
    await query(
      `UPDATE orders SET refund_failure_reason = $2,
        refund_status = CASE WHEN $3::boolean THEN 'failed' ELSE refund_status END, updated_at = NOW()
       WHERE id = $1 AND refund_status = 'pending' AND refund_id IS NULL`,
      [orderId, String(error?.message || 'Refund request failed').slice(0, 500),
        claim.action === 'create' && !requestStarted && !refundFound]
    );
    throw error;
  }
}

export async function applyRefundWebhook(refund: GatewayRefund) {
  const result = await query('SELECT id FROM orders WHERE refund_id = $1 OR razorpay_payment_id = $2 ORDER BY created_at DESC LIMIT 1', [refund.id, refund.payment_id]);
  if (!result.rowCount) throw new Error('ORDER_MISMATCH');
  return applyGatewayRefund(result.rows[0].id, refund);
}
