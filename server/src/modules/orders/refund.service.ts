import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool.js';
import { invalidateCatalog } from '../../redis/cache.service.js';
import { paymentGateway } from './payment-settlement.service.js';
import { releaseStockReservation } from './stock-reservation.service.js';

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
        refund_failure_reason = NULL, version = version + 1, updated_at = NOW()
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
  gateway: RefundGateway = paymentGateway()
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

  try {
    let refund: GatewayRefund | undefined;
    if (claim.action === 'reconcile') {
      refund = await gateway.payments.fetchRefund(claim.order.razorpay_payment_id, claim.order.refund_id) as GatewayRefund;
    } else {
      // A previous network timeout may have created the refund without storing
      // its response. Recover it by our stable receipt before creating another.
      const existing = await gateway.payments.fetchMultipleRefund(claim.order.razorpay_payment_id);
      refund = existing.items.find(item => item.receipt === claim.order.refund_receipt) as GatewayRefund | undefined;
      if (!refund && claim.action === 'recover') {
        // Never create another refund after an ambiguous timeout or process crash.
        // A signed webhook or provider lookup will reconcile the first attempt.
        return claim.order;
      }
      if (!refund) {
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
      `UPDATE orders SET refund_failure_reason = $2, updated_at = NOW()
       WHERE id = $1 AND refund_status = 'pending' AND refund_id IS NULL`,
      [orderId, String(error?.message || 'Refund request failed').slice(0, 500)]
    );
    throw error;
  }
}

export async function applyRefundWebhook(refund: GatewayRefund) {
  const result = await query('SELECT id FROM orders WHERE refund_id = $1 OR razorpay_payment_id = $2 ORDER BY created_at DESC LIMIT 1', [refund.id, refund.payment_id]);
  if (!result.rowCount) throw new Error('ORDER_MISMATCH');
  return applyGatewayRefund(result.rows[0].id, refund);
}
