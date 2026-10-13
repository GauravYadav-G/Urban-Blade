import { query, withTransaction } from '../../db/pool.js';
import { paymentGateway, settleCapturedPayment } from './payment-settlement.service.js';
import { recordGatewayPayment } from './payment-snapshot.service.js';
import { restoreCommittedStock } from './refund.service.js';
import { invalidateCatalog } from '../../redis/cache.service.js';

type Gateway = ReturnType<typeof paymentGateway>;

export async function reconcileOrderPayment(orderId: string, gateway?: Gateway) {
  const order = (await query('SELECT * FROM orders WHERE id::text = $1', [orderId])).rows[0];
  if (!order) throw new Error('ORDER_NOT_FOUND');
  if (order.payment_method !== 'Razorpay') return order;
  if (!order.idempotency_key) throw new Error('GATEWAY_ORDER_MISSING');
  gateway ??= paymentGateway();
  const response = await gateway.orders.fetchPayments(order.idempotency_key);
  for (const payment of response.items || []) await recordGatewayPayment(payment);
  // A failed attempt does not fail the checkout. A later retry may still succeed.
  const paid = response.items?.find(p => p.status === 'captured' || p.status === 'refunded');
  const authorized = response.items?.find(p => p.status === 'authorized');
  const payment = paid || authorized;
  if (payment) {
    const verified = await gateway.payments.fetch(payment.id);
    await recordGatewayPayment(verified);
    if (verified.order_id !== order.idempotency_key || Number(verified.amount) !== Math.round(Number(order.total_amount) * 100) || verified.currency !== order.currency) throw new Error('PAYMENT_MISMATCH');
    if (verified.status === 'captured' || verified.status === 'authorized') await settleCapturedPayment(payment.id, order.id, gateway);
    const refundPaise = Number(verified.amount_refunded || 0);
    if (refundPaise > 0 || verified.status === 'refunded') {
      await withTransaction(async client => {
        const current = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id])).rows[0];
        if (current.razorpay_payment_id && current.razorpay_payment_id !== verified.id) throw new Error('PAYMENT_MISMATCH');
        const totalPaise = Math.round(Number(current.total_amount) * 100);
        // Provider reads can finish out of order. Confirmed refunded money and
        // terminal success must never be overwritten by an older snapshot.
        const snapshot = (await client.query('SELECT refunded_paise FROM gateway_payments WHERE id = $1', [verified.id])).rows[0];
        // refund_amount on a pending/failed request is the requested amount,
        // so only the gateway ledger proves that money has been returned.
        const confirmedRefundPaise = Math.max(refundPaise, Number(snapshot?.refunded_paise || 0),
          current.payment_status === 'refunded' || current.refund_status === 'processed' ? totalPaise : 0);
        const full = confirmedRefundPaise === totalPaise;
        if (full && (!['shipped','delivered'].includes(current.status) || current.return_status === 'received')) await restoreCommittedStock(client, order.id);
        await client.query(`UPDATE orders SET razorpay_payment_id = $2, transaction_id = $2,
          payment_status = CASE WHEN $3::boolean THEN 'refunded' ELSE 'captured' END,
          refund_status = CASE WHEN $3::boolean THEN 'processed' ELSE refund_status END,
          refund_amount = $4, refunded_at = CASE WHEN $3::boolean THEN COALESCE(refunded_at,NOW()) ELSE refunded_at END,
          payment_reconciliation_error = CASE WHEN $3::boolean THEN NULL ELSE payment_reconciliation_error END,
          status = CASE WHEN $3::boolean AND status NOT IN ('shipped','delivered') THEN 'cancelled' ELSE status END,
          payment_checked_at = NOW(), updated_at = NOW() WHERE id = $1`, [order.id, verified.id, full, confirmedRefundPaise / 100]);
      });
      await invalidateCatalog().catch(() => {});
    }
  }
  await query('UPDATE orders SET payment_checked_at = NOW() WHERE id = $1', [order.id]);
  return (await query('SELECT * FROM orders WHERE id = $1', [order.id])).rows[0];
}
