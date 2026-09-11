import { pool, query, withTransaction } from '../../db/pool.js';

/**
 * Reclaims inventory from checkout sessions that were initiated ('accepted')
 * but never captured within 15 minutes.
 */
export async function reapAbandonedCheckouts(): Promise<number> {
  if (pool.ended) return 0;
  try {
    // Find unconfirmed orders older than 15 minutes
    const staleOrders = await query(`
      SELECT id, status, created_at 
      FROM orders 
      WHERE (status = 'accepted' OR payment_status = 'pending')
        AND status NOT IN ('confirmed', 'processing', 'shipped', 'delivered', 'cancelled')
        AND created_at < NOW() - INTERVAL '15 minutes'
      LIMIT 50;
    `);

    if (staleOrders.rows.length === 0) {
      return 0;
    }

    let reapedCount = 0;
    for (const order of staleOrders.rows) {
      await withTransaction(async (client) => {
        // Restock products
        const items = await client.query(
          `SELECT product_id, quantity FROM order_items WHERE order_id = $1`,
          [order.id]
        );

        for (const item of items.rows) {
          if (item.product_id) {
            await client.query(
              `UPDATE products 
               SET stock_quantity = stock_quantity + $1,
                   in_stock = true,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $2`,
              [item.quantity, item.product_id]
            );
          }
        }

        // Mark order as cancelled due to checkout timeout
        await client.query(
          `UPDATE orders 
           SET status = 'cancelled', 
               payment_status = 'failed',
               updated_at = CURRENT_TIMESTAMP 
           WHERE id = $1`,
          [order.id]
        );
      });
      reapedCount++;
    }

    if (reapedCount > 0) {
      console.log(`[InventoryReaper] Reclaimed inventory for ${reapedCount} abandoned checkout sessions.`);
    }
    return reapedCount;
  } catch (err: any) {
    if (pool.ended || err.message?.includes('after calling end')) {
      return 0;
    }
    console.error('[InventoryReaper] Error during checkout reap cycle:', err.message);
    return 0;
  }
}

export function startAbandonedCheckoutReaper(intervalMs = 60000): NodeJS.Timeout {
  // Initial sweep after server boots
  setTimeout(() => {
    reapAbandonedCheckouts().catch(() => {});
  }, 10000);

  return setInterval(() => {
    reapAbandonedCheckouts().catch(() => {});
  }, intervalMs);
}
