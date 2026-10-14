import type { PoolClient } from 'pg';
import { withTransaction } from '../../db/pool.js';
import { invalidateCatalog } from '../../redis/cache.service.js';
import { restoreCommittedStock } from './refund.service.js';

export class OfflinePaymentError extends Error {}

async function ensureReferenceAvailable(
  client: PoolClient,
  orderId: string,
  kind: 'collection' | 'refund',
  reference: string,
) {
  const result = await client.query(
    `SELECT order_id FROM offline_payment_records WHERE kind = $1 AND reference = $2
     UNION ALL
     SELECT id FROM orders WHERE id <> $3 AND
       (($1::text = 'refund' AND refund_external_reference = $2)
        OR ($1::text = 'collection' AND transaction_id = $2
          AND payment_method IN ('Cash on Delivery', 'cash_on_delivery')))`,
    [kind, reference, orderId],
  );
  if (result.rows.some(row => row.order_id !== orderId)) {
    throw new OfflinePaymentError('PAYMENT_REFERENCE_IN_USE');
  }
}

async function record(client: PoolClient, order: { id: string; total_amount: string | number },
  kind: 'collection' | 'refund', reference: string, actorId: string) {
  await client.query(
    `INSERT INTO offline_payment_records(order_id, kind, reference, amount, recorded_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [order.id, kind, reference, order.total_amount, actorId],
  );
}

/** Record completed external money movements atomically; this never transfers funds. */
export async function recordCodCollection(orderId: string, reference: string, actorId: string) {
  return withTransaction(async client => {
    const current = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!current) throw new OfflinePaymentError('ORDER_NOT_FOUND');
    if (!['Cash on Delivery', 'cash_on_delivery'].includes(current.payment_method)) {
      throw new OfflinePaymentError('COLLECTION_NOT_ALLOWED');
    }
    const existing = (await client.query(
      "SELECT * FROM offline_payment_records WHERE order_id = $1 AND kind = 'collection'", [orderId],
    )).rows[0];
    if (existing) {
      if (existing.reference !== reference) throw new OfflinePaymentError('PAYMENT_REFERENCE_CONFLICT');
      return current;
    }
    // Preserve safe retries for collection records created before this ledger existed.
    if (current.payment_status === 'captured' && current.transaction_id === reference) return current;
    if (current.status !== 'delivered' || current.payment_status !== 'pending' || current.refund_status
      || current.return_status === 'received' || Number(current.total_amount) <= 0) {
      throw new OfflinePaymentError('COLLECTION_NOT_ALLOWED');
    }
    await ensureReferenceAvailable(client, orderId, 'collection', reference);
    await record(client, current, 'collection', reference, actorId);
    return (await client.query(
      `UPDATE orders SET payment_status = 'captured', transaction_id = $2,
        updated_at = NOW(), version = version + 1 WHERE id = $1 RETURNING *`, [orderId, reference],
    )).rows[0];
  });
}

export async function recordExternalRefund(orderId: string, reference: string, reason: string, actorId: string) {
  const order = await withTransaction(async client => {
    const current = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0];
    if (!current) throw new OfflinePaymentError('ORDER_NOT_FOUND');
    if (!['Cash on Delivery', 'cash_on_delivery', 'Cash', 'UPI', 'Card'].includes(current.payment_method)) {
      throw new OfflinePaymentError('MANUAL_REFUND_NOT_ALLOWED');
    }
    if (current.refund_status === 'processed') {
      if (current.refund_external_reference !== reference) throw new OfflinePaymentError('PAYMENT_REFERENCE_CONFLICT');
      return current;
    }
    if (current.payment_status !== 'captured' || current.refund_status === 'pending'
      || Number(current.total_amount) <= 0) throw new OfflinePaymentError('MANUAL_REFUND_NOT_ALLOWED');
    if (['shipped', 'delivered'].includes(current.status) && current.return_status !== 'received') {
      throw new OfflinePaymentError('RETURN_RECEIPT_REQUIRED');
    }
    await ensureReferenceAvailable(client, orderId, 'refund', reference);
    await record(client, current, 'refund', reference, actorId);
    await restoreCommittedStock(client, orderId);
    return (await client.query(
      `UPDATE orders SET status = CASE WHEN status = 'delivered' THEN status ELSE 'cancelled' END,
        payment_status = 'refunded', refund_status = 'processed', refund_amount = total_amount,
        refund_reason = $2, refund_external_reference = $3, refund_requested_at = NOW(),
        refunded_at = NOW(), updated_at = NOW(), version = version + 1 WHERE id = $1 RETURNING *`,
      [orderId, reason, reference],
    )).rows[0];
  });
  await invalidateCatalog().catch(() => {});
  return order;
}
