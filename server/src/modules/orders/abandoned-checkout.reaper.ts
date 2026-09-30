import { pool, query, withTransaction } from '../../db/pool.js';
import { paymentGateway, settleCapturedPayment } from './payment-settlement.service.js';
import { cancelOrderAndReleaseStock } from './stock-reservation.service.js';

export async function reapAbandonedCheckouts(): Promise<number> {
  if (pool.ended) return 0;
  // Recover payments even when the customer closes checkout before verification.
  const online = await query(`SELECT id, idempotency_key FROM orders WHERE status = 'accepted'
    AND payment_status = 'pending' AND payment_method = 'Razorpay' ORDER BY created_at LIMIT 50`);
  for (const order of online.rows) {
    try {
      const payments = await paymentGateway().orders.fetchPayments(order.idempotency_key);
      const captured = payments.items.find(payment => payment.status === 'captured');
      if (captured) await settleCapturedPayment(captured.id, order.id);
      // Pending online orders are retained until the provider confirms payment.
      // Do not release holds on a timer while delayed bank authorization is possible.
    } catch (err: any) { console.error('Payment reconciliation failed', order.id, err.message); }
  }
  const stale = await query(`SELECT id FROM orders
    WHERE status = 'accepted' AND payment_status = 'pending'
      AND payment_method <> 'Razorpay'
      AND created_at < NOW() - INTERVAL '15 minutes'
    ORDER BY created_at LIMIT 50`);
  let count = 0;
  for (const order of stale.rows) {
    const result = await withTransaction(client => cancelOrderAndReleaseStock(client, order.id));
    if (result.cancelled) count++;
  }
  return count;
}

export function startAbandonedCheckoutReaper(intervalMs = 60000): NodeJS.Timeout {
  const timer = setInterval(() => {
    reapAbandonedCheckouts().catch(err => console.error('Checkout cleanup failed', err.message));
  }, intervalMs);
  timer.unref();
  return timer;
}
