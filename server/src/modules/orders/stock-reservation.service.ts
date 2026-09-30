import type { PoolClient } from 'pg';

/**
 * Stock Reservation Service — the single source of truth for inventory holds.
 *
 * Model (payment-first, reserve-then-commit):
 *   reserve  : stock_reserved += qty      (checkout opened, awaiting payment)
 *   commit   : stock_quantity -= qty      (payment captured / COD confirmed)
 *              stock_reserved -= qty
 *   release  : stock_reserved -= qty      (cancelled / expired / abandoned)
 *
 * `products.stock_reserved` is only an aggregate counter, so it cannot tell us
 * *which* order holds which units, nor when a hold was opened. The
 * `stock_reservations` ledger records one row per (order, product) and is what
 * makes every transition below idempotent and TTL-safe:
 *
 *   - Only rows with status = 'active' are ever consumed, so releasing an
 *     already-released (or never-made) reservation matches zero rows and is a
 *     no-op instead of driving stock_reserved negative and tripping its CHECK
 *     constraint — which previously rolled the whole transaction back and left
 *     captured payments impossible to confirm.
 *   - TTL is measured per reservation (created_at), never from
 *     products.updated_at, which is a clock shared by every hold on a product.
 *
 * Lock ordering is always order row -> product rows (ascending product_id) so
 * concurrent transactions cannot deadlock.
 */

export interface StockLine {
  productId: string;
  quantity: number;
  productName?: string;
}

export interface ReservationLedgerResult {
  /** Number of active holds the caller acted on. */
  activeReservations: number;
  /** Products whose stock could not be adjusted (should be ~0 outside data corruption). */
  unapplied: Array<{ productId: string; quantity: number }>;
}

/**
 * Sorts by productId so a cart of [A,B] and a cart of [B,A] take row locks in
 * the same order instead of deadlocking.
 */
function byProductId(items: StockLine[]): StockLine[] {
  return [...items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

/**
 * Phase 1 — reserve. Must run inside the caller's transaction, after the order
 * row has been inserted (the ledger has a foreign key to it).
 *
 * Throws INSUFFICIENT_STOCK_RACE when a product can no longer cover the request
 * so the caller rolls the whole order back.
 */
export async function reserveStock(client: PoolClient, orderId: string, items: StockLine[]): Promise<void> {
  // The aggregate counter is the row-level availability gate...
  for (const item of byProductId(items)) {
    const res = await client.query(
      `
      UPDATE products
      SET stock_reserved = stock_reserved + $1,
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND in_stock = TRUE
        AND (stock_quantity - stock_reserved) >= $1
      RETURNING id;
      `,
      [item.quantity, item.productId]
    );

    if (res.rowCount === 0) {
      // Re-read so the customer sees a real number rather than a bare failure.
      const current = await client.query(
        'SELECT GREATEST(stock_quantity - stock_reserved, 0) AS available FROM products WHERE id = $1',
        [item.productId]
      );
      const available = current.rowCount ? parseInt(current.rows[0].available, 10) : 0;
      throw new Error(`INSUFFICIENT_STOCK_RACE:${item.productName ?? item.productId}:${available}`);
    }
  }

  // ...then record who is holding those units.
  for (const item of items) {
    await client.query(
      `
      INSERT INTO stock_reservations (order_id, product_id, quantity, status)
      VALUES ($1, $2, $3, 'active')
      ON CONFLICT (order_id, product_id) DO NOTHING;
      `,
      [orderId, item.productId, item.quantity]
    );
  }
}

/**
 * Locks the still-live reservations of an order (ascending product_id) and
 * returns them. An empty array means this order never reserved anything, or it
 * was already committed/released — in which case the caller must not touch
 * stock, which is precisely what makes these helpers idempotent.
 */
async function lockActiveReservations(client: PoolClient, orderId: string): Promise<StockLine[]> {
  const res = await client.query(
    `
    SELECT product_id, quantity
    FROM stock_reservations
    WHERE order_id = $1 AND status = 'active'
    ORDER BY product_id
    FOR UPDATE;
    `,
    [orderId]
  );
  return res.rows.map((r: any) => ({ productId: r.product_id, quantity: parseInt(r.quantity, 10) }));
}

/**
 * Phase 2 — commit. Turns a hold into a real sale: the units leave
 * stock_quantity and stop being reserved, atomically.
 */
export async function commitStockReservation(client: PoolClient, orderId: string): Promise<ReservationLedgerResult> {
  const active = await lockActiveReservations(client, orderId);
  const unapplied: ReservationLedgerResult['unapplied'] = [];

  for (const line of active) {
    const res = await client.query(
      `
      UPDATE products
      SET stock_quantity = stock_quantity - $1,
          stock_reserved = stock_reserved - $1,
          -- Every SET expression sees the pre-update row values, so the new
          -- on-hand count must be spelled out as (stock_quantity - qty).
          in_stock = (stock_quantity - $1 > 0),
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND stock_quantity >= $1
        AND stock_reserved >= $1
      RETURNING id;
      `,
      [line.quantity, line.productId]
    );

    if (res.rowCount === 0) unapplied.push(line);
  }

  if (unapplied.length === 0 && active.length > 0) {
    await client.query(
      `
      UPDATE stock_reservations
      SET status = 'committed', resolved_at = CURRENT_TIMESTAMP
      WHERE order_id = $1 AND status = 'active';
      `,
      [orderId]
    );
  }

  if (unapplied.length) throw new Error('STOCK_LEDGER_INCONSISTENT');
  return { activeReservations: active.length, unapplied };
}

/**
 * Phase 3 — release. Returns held units to the pool without touching
 * stock_quantity. Safe to call repeatedly, and on orders that never reserved.
 */
export async function releaseStockReservation(client: PoolClient, orderId: string): Promise<ReservationLedgerResult> {
  const active = await lockActiveReservations(client, orderId);
  const unapplied: ReservationLedgerResult['unapplied'] = [];

  for (const line of active) {
    const res = await client.query(
      `
      UPDATE products
      SET stock_reserved = stock_reserved - $1,
          -- Availability after the release is on-hand plus the units being freed.
          in_stock = (stock_quantity > 0),
          version = version + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
        AND stock_reserved >= $1
      RETURNING id;
      `,
      [line.quantity, line.productId]
    );

    if (res.rowCount === 0) unapplied.push(line);
  }

  if (unapplied.length === 0 && active.length > 0) {
    await client.query(
      `
      UPDATE stock_reservations
      SET status = 'released', resolved_at = CURRENT_TIMESTAMP
      WHERE order_id = $1 AND status = 'active';
      `,
      [orderId]
    );
  }

  if (unapplied.length) throw new Error('STOCK_LEDGER_INCONSISTENT');
  return { activeReservations: active.length, unapplied };
}

/**
 * Compare-and-set on the order row.
 *
 * Locks the order and flips it only while it is still 'accepted' + 'pending'.
 * Returns false when someone else already won the race (duplicate verify POST,
 * reaper, cancel), which tells the caller to skip the stock mutation entirely —
 * closing the double-decrement window that existed when the order was read
 * outside the transaction with an unguarded `WHERE id = $1` update.
 */
export async function claimPendingOrder(
  client: PoolClient,
  orderId: string,
  next: {
    status: string;
    payment_status: string;
    extraSet?: string;
    params?: any[];
  }
): Promise<boolean> {
  const existing = await client.query(
    'SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE',
    [orderId]
  );
  if (existing.rowCount === 0) return false;

  const row = existing.rows[0];
  if (row.status !== 'accepted' || row.payment_status !== 'pending') return false;

  const setClauses = [
    'status = $2',
    'payment_status = $3',
    'version = version + 1',
    'updated_at = CURRENT_TIMESTAMP',
  ];
  const values: any[] = [orderId, next.status, next.payment_status];

  if (next.extraSet) {
    setClauses.push(next.extraSet);
    values.push(...(next.params ?? []));
  }

  const updated = await client.query(
    `
    UPDATE orders
    SET ${setClauses.join(', ')}
    WHERE id = $1
      AND status = 'accepted'
      AND payment_status = 'pending'
    RETURNING id;
    `,
    values
  );

  return (updated.rowCount ?? 0) > 0;
}

/**
 * Cancel an order and release its holds. Used by the abandoned-checkout reaper
 * and the cancel endpoints. Guards against releasing stock for anything that was
 * already paid for, and CAS's the status so a concurrent verify cannot have both
 * the payment confirmed AND the order cancelled.
 */
export async function cancelOrderAndReleaseStock(
  client: PoolClient,
  orderId: string,
  opts: { allowedStatuses?: string[] } = {}
): Promise<{ cancelled: boolean; released: number }> {
  const allowed = opts.allowedStatuses ?? ['accepted', 'processing'];

  const existing = await client.query(
    'SELECT status, payment_status FROM orders WHERE id = $1 FOR UPDATE',
    [orderId]
  );
  if (existing.rowCount === 0) return { cancelled: false, released: 0 };

  const row = existing.rows[0];
  // Never release stock for an order that was already paid for.
  if (row.payment_status === 'captured' || row.payment_status === 'refunded') {
    return { cancelled: false, released: 0 };
  }
  if (!allowed.includes(row.status)) return { cancelled: false, released: 0 };

  const updated = await client.query(
    `
    UPDATE orders
    SET status = 'cancelled',
        payment_status = 'failed',
        version = version + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = $1
      AND status = $2
      AND payment_status = 'pending'
    RETURNING id;
    `,
    [orderId, row.status]
  );
  if ((updated.rowCount ?? 0) === 0) return { cancelled: false, released: 0 };

  const { activeReservations } = await releaseStockReservation(client, orderId);
  const committed = await client.query("SELECT product_id, quantity FROM stock_reservations WHERE order_id = $1 AND status = 'committed' ORDER BY product_id FOR UPDATE", [orderId]);
  for (const item of committed.rows) {
    await client.query('UPDATE products SET stock_quantity = stock_quantity + $1, in_stock = TRUE, version = version + 1 WHERE id = $2', [item.quantity, item.product_id]);
  }
  await client.query("UPDATE stock_reservations SET status = 'restored', resolved_at = NOW() WHERE order_id = $1 AND status = 'committed'", [orderId]);
  return { cancelled: true, released: activeReservations };
}

/**
 * Resolves an order that callers may reference either by its own id or by the
 * external payment reference stored in idempotency_key (Razorpay's flow does
 * this), locking the row so the returned id can be safely claimed afterwards.
 * Also normalises the id, which the previous inline SQL did with an unindexable
 * `id::text = $1` comparison.
 */
export async function resolveOrderIdForUpdate(
  client: PoolClient,
  reference: string,
  altReference?: string | null
): Promise<string | null> {
  const res = await client.query(
    `SELECT id::text AS id FROM orders
     WHERE id::text = $1 OR ($2 IS NOT NULL AND idempotency_key = $2)
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [reference, altReference ?? null]
  );
  return res.rowCount ? res.rows[0].id : null;
}
