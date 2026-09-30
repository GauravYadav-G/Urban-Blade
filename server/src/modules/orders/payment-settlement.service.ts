import Razorpay from 'razorpay';
import { config } from '../../config.js';
import { query, withTransaction } from '../../db/pool.js';
import { claimPendingOrder, commitStockReservation } from './stock-reservation.service.js';

export function paymentGateway() {
  if (!config.razorpay.keyId || !config.razorpay.keySecret) throw new Error('PAYMENT_UNAVAILABLE');
  return new Razorpay({ key_id: config.razorpay.keyId, key_secret: config.razorpay.keySecret });
}

/** Both browser verification and signed webhooks use provider-confirmed payment data. */
export async function settleCapturedPayment(paymentId: string, expectedOrderId?: string) {
  const payment = await paymentGateway().payments.fetch(paymentId);
  const result = await query("SELECT * FROM orders WHERE idempotency_key = $1 AND payment_method = 'Razorpay'", [payment.order_id]);
  const order = result.rows[0];
  if (!order || (expectedOrderId && order.id !== expectedOrderId)) throw new Error('ORDER_MISMATCH');
  if (payment.status !== 'captured' || Number(payment.amount) !== Math.round(Number(order.total_amount) * 100) || payment.currency !== order.currency) {
    throw new Error('PAYMENT_NOT_CAPTURED');
  }
  await withTransaction(async client => {
    const locked = await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [order.id]);
    const current = locked.rows[0];
    if (current.payment_status === 'captured') {
      if (current.razorpay_payment_id !== paymentId) throw new Error('PAYMENT_MISMATCH');
      return;
    }
    const claimed = await claimPendingOrder(client, order.id, {
      status: 'confirmed', payment_status: 'captured',
      extraSet: 'transaction_id = $4, razorpay_payment_id = $4', params: [paymentId],
    });
    if (!claimed) throw new Error('ORDER_REQUIRES_RECONCILIATION');
    const stock = await commitStockReservation(client, order.id);
    if (!stock.activeReservations || stock.unapplied.length) throw new Error('STOCK_COMMIT_FAILED');
  });
  return order.id;
}
