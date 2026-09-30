import { pool, query, withTransaction } from '../../db/pool.js';
import { paymentGateway, settleCapturedPayment } from './payment-settlement.service.js';
import { cancelOrderAndReleaseStock } from './stock-reservation.service.js';

export async function reapAbandonedCheckouts(): Promise<number> {
  if (pool.ended) return 0;
  let count = 0;

  // 1. Recover or expire Razorpay orders
  const online = await query(`
    SELECT id, idempotency_key, created_at,
           (created_at < NOW() - INTERVAL '30 minutes') AS is_expired
    FROM orders
    WHERE status = 'accepted'
      AND payment_status = 'pending'
      AND payment_method = 'Razorpay'
    ORDER BY created_at
    LIMIT 50
  `);

  for (const order of online.rows) {
    try {
      let capturedPaymentId: string | null = null;
      let hasAuthorizedOrCaptured = false;

      if (order.idempotency_key) {
        try {
          const payments = await paymentGateway().orders.fetchPayments(order.idempotency_key);
          const captured = payments?.items?.find(payment => payment.status === 'captured');
          const authorized = payments?.items?.find(payment => payment.status === 'authorized');
          if (captured) {
            capturedPaymentId = captured.id;
            hasAuthorizedOrCaptured = true;
          } else if (authorized) {
            hasAuthorizedOrCaptured = true;
          }
        } catch {
          // If payment fetch fails (e.g. order not found on gateway or mock id in dev),
          // order has no gateway capture.
        }
      }

      if (capturedPaymentId) {
        await settleCapturedPayment(capturedPaymentId, order.id);
      } else if (order.is_expired && !hasAuthorizedOrCaptured) {
        // Grace period expired (30m) with no authorization or capture:
        // Safely cancel order and return reserved stock to available inventory.
        const result = await withTransaction(client => cancelOrderAndReleaseStock(client, order.id));
        if (result.cancelled) count++;
      }
    } catch (err: any) {
      console.error('Payment reconciliation failed', order.id, err.message);
    }
  }

  // 2. Expire non-Razorpay pending holds past 15-minute window
  const stale = await query(`
    SELECT id FROM orders
    WHERE status = 'accepted'
      AND payment_status = 'pending'
      AND (payment_method IS NULL OR payment_method <> 'Razorpay')
      AND created_at < NOW() - INTERVAL '15 minutes'
    ORDER BY created_at
    LIMIT 50
  `);

  for (const order of stale.rows) {
    try {
      const result = await withTransaction(client => cancelOrderAndReleaseStock(client, order.id));
      if (result.cancelled) count++;
    } catch (err: any) {
      console.error('Stale checkout release failed', order.id, err.message);
    }
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
