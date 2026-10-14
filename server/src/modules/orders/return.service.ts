import type { PoolClient, QueryResultRow } from 'pg';
import { withTransaction } from '../../db/pool.js';
import { restoreCommittedStock } from './refund.service.js';

export type ReturnStatus = 'requested' | 'approved' | 'rejected' | 'received';

interface ReturnOrder extends QueryResultRow {
  id: string;
  user_id: string | null;
  status: string;
  payment_method: string;
  payment_status: string;
  refund_status: string | null;
  refund_amount: string | number | null;
  return_status: ReturnStatus | null;
  return_reason: string | null;
  return_restock: boolean | null;
  payment_reconciliation_error: string | null;
}

export class ReturnFlowError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
    this.name = 'ReturnFlowError';
  }
}

// Explicit projection keeps payment signatures and private order notes out of
// customer responses while keeping order/detail/queue responses consistent.
const returnOrderProjection = `o.id, o.user_id, o.status, o.subtotal, o.total_amount,
  o.shipping_fee, o.tax_amount, o.tax_rate_percent, o.tax_inclusive,
  o.discount_amount, o.coupon_code, o.currency, o.shipping_address,
  o.payment_method, o.payment_status, o.transaction_id, o.razorpay_payment_id,
  o.idempotency_key AS gateway_order_id, o.payment_reconciliation_error, o.payment_checked_at,
  o.tracking_number, o.carrier, o.created_at, o.updated_at, o.version,
  o.return_status, o.return_reason, o.return_review_note, o.return_requested_at,
  o.return_requested_by, o.return_reviewed_at, o.return_reviewed_by,
  o.return_received_at, o.return_restock,
  o.refund_status, o.refund_id, o.refund_amount, o.refund_reason,
  o.refund_requested_at, o.refunded_at, o.refund_failure_reason, o.refund_external_reference,
  COALESCE((SELECT json_agg(json_build_object(
    'id', oi.id, 'product_id', oi.product_id, 'product_name', oi.product_name,
    'unit_price', oi.unit_price, 'quantity', oi.quantity, 'image_url', oi.image_url,
    'vendor', p.vendor) ORDER BY oi.id)
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = o.id), '[]'::json) AS items`;

async function orderSnapshot(client: PoolClient, orderId: string): Promise<ReturnOrder> {
  const result = await client.query<ReturnOrder>(`SELECT ${returnOrderProjection} FROM orders o WHERE o.id = $1`, [orderId]);
  if (!result.rows[0]) throw new ReturnFlowError('ORDER_NOT_FOUND', 'This order could not be found.', 404);
  return result.rows[0];
}

async function lockOrder(client: PoolClient, orderId: string, ownerId?: string): Promise<ReturnOrder> {
  const result = await client.query<ReturnOrder>(
    `SELECT * FROM orders WHERE id = $1 ${ownerId ? 'AND user_id = $2' : ''} FOR UPDATE`,
    ownerId ? [orderId, ownerId] : [orderId]
  );
  if (!result.rows[0]) throw new ReturnFlowError('ORDER_NOT_FOUND', 'This order could not be found.', 404);
  return result.rows[0];
}

async function recordEvent(client: PoolClient, orderId: string, actorId: string,
  source: 'customer' | 'admin', previous: ReturnStatus | null, status: ReturnStatus,
  note: string, restock: boolean | null = null): Promise<void> {
  await client.query(`INSERT INTO order_return_events
    (order_id, actor_id, source, previous_status, status, note, restock)
    VALUES ($1, $2, $3, $4, $5, $6, $7)`, [orderId, actorId, source, previous, status, note, restock]);
}

export async function requestOrderReturn(orderId: string, reason: string,
  actorId: string, source: 'customer' | 'admin') {
  return withTransaction(async client => {
    const current = await lockOrder(client, orderId, source === 'customer' ? actorId : undefined);
    // A replay must neither overwrite the customer's reason nor add audit rows.
    if (current.return_status) return { order: await orderSnapshot(client, orderId), changed: false };
    const unpaidCod = current.payment_status === 'pending' && ['Cash on Delivery', 'cash_on_delivery'].includes(current.payment_method);
    if (current.status !== 'delivered' || (!unpaidCod && current.payment_status !== 'captured') ||
      current.refund_status === 'pending' || current.refund_status === 'processed' ||
      Number(current.refund_amount || 0) > 0 || current.payment_reconciliation_error) {
      throw new ReturnFlowError('ORDER_NOT_RETURNABLE', 'Returns are available for delivered orders. Resolve any payment or refund review first.');
    }
    await client.query(`UPDATE orders SET return_status = 'requested', return_reason = $2,
      return_requested_at = NOW(), return_requested_by = $3, updated_at = NOW(), version = version + 1
      WHERE id = $1`, [orderId, reason, actorId]);
    await recordEvent(client, orderId, actorId, source, null, 'requested', reason);
    return { order: await orderSnapshot(client, orderId), changed: true };
  });
}

async function validateRestockLedger(client: PoolClient, orderId: string): Promise<void> {
  const reservations = await client.query<{ product_id: string; quantity: number }>(
    "SELECT product_id, quantity FROM stock_reservations WHERE order_id = $1 AND status = 'committed' ORDER BY product_id FOR UPDATE", [orderId]
  );
  const items = await client.query<{ product_id: string | null; quantity: number }>(
    'SELECT product_id, SUM(quantity)::int AS quantity FROM order_items WHERE order_id = $1 GROUP BY product_id ORDER BY product_id', [orderId]
  );
  // Imported orders may have only a reservation ledger. Where item records
  // exist, every returned unit must match that ledger before stock can be added.
  const matches = reservations.rows.length > 0 && (items.rows.length === 0 ||
    (items.rows.length === reservations.rows.length && items.rows.every(item => item.product_id &&
      reservations.rows.some(reservation => reservation.product_id === item.product_id && Number(reservation.quantity) === Number(item.quantity)))));
  if (!matches) throw new ReturnFlowError('RETURN_INVENTORY_REVIEW_REQUIRED',
    'The stock ledger does not match this return. Reconcile inventory before receiving it for restocking.');
}

export async function reviewOrderReturn(orderId: string, actorId: string,
  review: { status: Exclude<ReturnStatus, 'requested'>; note: string; restock?: boolean }) {
  if (review.status === 'received' && review.restock === undefined) {
    throw new ReturnFlowError('RESTOCK_DECISION_REQUIRED', 'Choose whether inspected goods can be restocked.', 400);
  }
  return withTransaction(async client => {
    const current = await lockOrder(client, orderId);
    if (current.return_status === review.status) {
      if (review.status === 'received' && current.return_restock !== review.restock) {
        throw new ReturnFlowError('RETURN_RECEIPT_CONFLICT', 'This return already has a different stock decision. Refresh the return and review its history.');
      }
      return { order: await orderSnapshot(client, orderId), changed: false };
    }
    const allowed: Partial<Record<ReturnStatus, string[]>> = { requested: ['approved', 'rejected'], approved: ['received'] };
    if (!current.return_status || !allowed[current.return_status]?.includes(review.status)) {
      throw new ReturnFlowError('INVALID_RETURN_TRANSITION', 'Request and approve a return before recording receipt. Completed or rejected returns cannot be changed.');
    }
    if (review.status === 'received') {
      if (review.restock) {
        await validateRestockLedger(client, orderId);
        await restoreCommittedStock(client, orderId);
        (client as PoolClient & { catalogChanged?: boolean }).catalogChanged = true;
      } else {
        // Mark inspected damaged goods resolved so a later refund cannot add
        // them to sellable stock. The distinct persisted decision lives here
        // and in the immutable return event, rather than in the ledger status.
        await client.query("UPDATE stock_reservations SET status = 'restored', resolved_at = NOW() WHERE order_id = $1 AND status = 'committed'", [orderId]);
      }
    }
    await client.query(`UPDATE orders SET return_status = $2::varchar, return_review_note = $3,
      return_reviewed_at = NOW(), return_reviewed_by = $4,
      return_received_at = CASE WHEN $2::text = 'received' THEN NOW() ELSE return_received_at END,
      return_restock = CASE WHEN $2::text = 'received' THEN $5::boolean ELSE return_restock END,
      updated_at = NOW(), version = version + 1 WHERE id = $1`,
    [orderId, review.status, review.note, actorId, review.restock ?? null]);
    await recordEvent(client, orderId, actorId, 'admin', current.return_status, review.status, review.note,
      review.status === 'received' ? review.restock ?? null : null);
    return { order: await orderSnapshot(client, orderId), changed: true };
  });
}

export async function getOrderReturn(orderId: string, ownerId?: string) {
  return withTransaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const order = await orderSnapshot(client, orderId);
    if (ownerId && order.user_id !== ownerId) throw new ReturnFlowError('ORDER_NOT_FOUND', 'This order could not be found.', 404);
    const events = await client.query(`SELECT e.id, e.previous_status, e.status, e.note,
      e.restock, e.actor_id, u.name AS actor_name, e.source, e.created_at
      FROM order_return_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.order_id = $1 ORDER BY e.event_sequence`, [orderId]);
    return { order, events: events.rows };
  });
}

export async function listOrderReturns(filters: { status: ReturnStatus | 'all'; page: number; limit: number; q?: string }) {
  return withTransaction(async client => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const conditions = ['o.return_status IS NOT NULL'];
    const params: Array<string | number> = [];
    if (filters.status !== 'all') {
      params.push(filters.status);
      conditions.push(`o.return_status = $${params.length}`);
    }
    if (filters.q) {
      params.push(`%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);
      const search = `$${params.length}`;
      conditions.push(`(o.id::text ILIKE ${search} OR o.return_reason ILIKE ${search}
        OR o.shipping_address->>'fullName' ILIKE ${search} OR o.shipping_address->>'name' ILIKE ${search}
        OR o.shipping_address->>'email' ILIKE ${search} OR o.shipping_address->>'phone' ILIKE ${search}
        OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.product_name ILIKE ${search}))`);
    }
    const where = conditions.join(' AND ');
    const count = await client.query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM orders o WHERE ${where}`, params);
    const limitParam = params.length + 1;
    const result = await client.query<ReturnOrder>(`SELECT ${returnOrderProjection} FROM orders o WHERE ${where}
      ORDER BY CASE o.return_status WHEN 'requested' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        o.return_requested_at DESC NULLS LAST, o.id
      LIMIT $${limitParam} OFFSET $${limitParam + 1}`, [...params, filters.limit, (filters.page - 1) * filters.limit]);
    return { data: result.rows, total: count.rows[0].total, page: filters.page, limit: filters.limit };
  });
}
