import { pool, query, withTransaction } from '../../db/pool.js';
import { paymentGateway, settleCapturedPayment } from './payment-settlement.service.js';
import { cancelOrderAndReleaseStock } from './stock-reservation.service.js';

export const PAYMENT_STOCK_HOLD_SECONDS = 120;
const VERIFICATION_RECOVERY_SECONDS = 30;
const REAPER_BATCH_SIZE = 50;

type ExpiredPaymentHold = {
  id: string;
  idempotency_key: string | null;
};

async function releaseOrderStock(orderId: string): Promise<boolean> {
  const result = await withTransaction(client => cancelOrderAndReleaseStock(client, orderId));
  return result.cancelled;
}

export async function reapAbandonedCheckouts(gateway = paymentGateway): Promise<number> {
  if (pool.ended) return 0;
  let count = 0;

  // Persistently claim expired holds so the final verification runs once even
  // when several application instances run this job at the same time.
  const online = await query<ExpiredPaymentHold>(`
    WITH expired AS (
      SELECT id
      FROM orders
      WHERE status = 'accepted'
        AND payment_status IN ('pending', 'failed')
        AND payment_method = 'Razorpay'
        AND payment_verification_started_at IS NULL
        AND created_at < NOW() - ($1 * INTERVAL '1 second')
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT $2
    )
    UPDATE orders AS orders_to_verify
    SET payment_verification_started_at = NOW(), updated_at = NOW()
    FROM expired
    WHERE orders_to_verify.id = expired.id
    RETURNING orders_to_verify.id, orders_to_verify.idempotency_key
  `, [PAYMENT_STOCK_HOLD_SECONDS, REAPER_BATCH_SIZE]);

  for (const order of online.rows) {
    try {
      let paymentSettled = false;

      if (order.idempotency_key) {
        try {
          const gatewayClient = gateway();
          const payments = await gatewayClient.orders.fetchPayments(order.idempotency_key);
          if (Array.isArray(payments?.items) && Number(payments.count || 0) <= payments.items.length) {
            const payable = payments.items.find(payment =>
              payment.status === 'captured' || payment.status === 'authorized'
            );
            if (payable?.id) {
              await settleCapturedPayment(payable.id, order.id, gatewayClient);
              paymentSettled = true;
            }
          }
        } catch (error: any) {
          // This is deliberately the one final verification attempt. A failed
          // or ambiguous response must not turn this into an unlimited hold.
          console.error('Final payment verification failed', order.id, error?.message || error);
        }
      }

      if (!paymentSettled && await releaseOrderStock(order.id)) count++;
    } catch (error: any) {
      console.error('Payment reconciliation failed', order.id, error?.message || error);
    }
  }

  // Recover a process crash after the persistent claim without performing a
  // second gateway check. Late captures are reconciled atomically elsewhere.
  const abandonedClaims = await query<{ id: string }>(`
    SELECT id
    FROM orders
    WHERE status = 'accepted'
      AND payment_status IN ('pending', 'failed')
      AND payment_method = 'Razorpay'
      AND payment_verification_started_at < NOW() - ($1 * INTERVAL '1 second')
    ORDER BY payment_verification_started_at
    LIMIT $2
  `, [VERIFICATION_RECOVERY_SECONDS, REAPER_BATCH_SIZE]);

  for (const order of abandonedClaims.rows) {
    try {
      if (await releaseOrderStock(order.id)) count++;
    } catch (error: any) {
      console.error('Claimed checkout release failed', order.id, error?.message || error);
    }
  }

  // Every payment method gets the same bounded inventory lease.
  const stale = await query<{ id: string }>(`
    SELECT id
    FROM orders
    WHERE status = 'accepted'
      AND payment_status IN ('pending', 'failed')
      AND (payment_method IS NULL OR payment_method NOT IN ('Razorpay', 'Cash on Delivery', 'cash_on_delivery'))
      AND created_at < NOW() - ($1 * INTERVAL '1 second')
    ORDER BY created_at
    LIMIT $2
  `, [PAYMENT_STOCK_HOLD_SECONDS, REAPER_BATCH_SIZE]);

  for (const order of stale.rows) {
    try {
      if (await releaseOrderStock(order.id)) count++;
    } catch (error: any) {
      console.error('Stale checkout release failed', order.id, error?.message || error);
    }
  }

  return count;
}

export function startAbandonedCheckoutReaper(intervalMs = 5000): NodeJS.Timeout {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    reapAbandonedCheckouts()
      .catch(error => console.error('Checkout cleanup failed', error?.message || error))
      .finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
  return timer;
}
