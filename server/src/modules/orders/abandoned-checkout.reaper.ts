import { pool, query, withTransaction } from '../../db/pool.js';
import { paymentGateway, settleCapturedPayment } from './payment-settlement.service.js';
import { cancelOrderAndReleaseStock } from './stock-reservation.service.js';

export async function reapAbandonedCheckouts(gateway = paymentGateway): Promise<number> {
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

      if (!order.idempotency_key) continue;
      if (order.idempotency_key) {
        try {
          const payments = await gateway().orders.fetchPayments(order.idempotency_key);
          if (!Array.isArray(payments?.items) || Number(payments.count || 0) > payments.items.length) continue;
          const captured = payments?.items?.find(payment => payment.status === 'captured');
          const authorized = payments?.items?.find(payment => payment.status === 'authorized');
          if (captured) {
            capturedPaymentId = captured.id;
            hasAuthorizedOrCaptured = true;
          } else if (authorized) {
            capturedPaymentId = authorized.id;
            hasAuthorizedOrCaptured = true;
          }
          if (payments?.items?.some(payment => !['failed', 'refunded', 'captured'].includes(payment.status))) hasAuthorizedOrCaptured = true;
        } catch {
          // Unknown gateway state is not evidence of non-payment. Keep the hold.
          continue;
        }
      }

      if (capturedPaymentId) {
        await settleCapturedPayment(capturedPaymentId, order.id, gateway());
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
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    reapAbandonedCheckouts().catch(err => console.error('Checkout cleanup failed', err.message)).finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return timer;
}
