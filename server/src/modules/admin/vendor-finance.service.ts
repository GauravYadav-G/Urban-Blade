import type { PoolClient } from 'pg';
import { query } from '../../db/pool.js';

// Merchandise earnings exclude shipping/tax and allocate the order discount.
// Only delivered, paid orders without an open/accepted return are payable.
export async function vendorBalances(client?: PoolClient) {
  const sql = `SELECT v.id, v.name, v.commission_rate, v.payout_account,
    COALESCE(s.gross_sales, 0)::numeric AS gross_sales,
    ROUND(COALESCE(s.gross_sales, 0) * v.commission_rate / 100, 2) AS platform_cut,
    COALESCE(p.paid, 0)::numeric AS paid_amount,
    GREATEST(0, ROUND(COALESCE(s.gross_sales, 0) * (1 - v.commission_rate / 100), 2) - COALESCE(p.paid, 0)) AS payable_amount
    FROM vendors v
    LEFT JOIN (
      SELECT LOWER(pr.vendor) AS vendor,
        SUM(oi.unit_price * oi.quantity * GREATEST(0, 1 - COALESCE(o.discount_amount, 0) / NULLIF(o.subtotal, 0))) AS gross_sales
      FROM order_items oi JOIN products pr ON pr.id = oi.product_id JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'delivered' AND o.payment_status = 'captured'
        AND COALESCE(o.refund_status, '') = '' AND COALESCE(o.refund_amount,0)=0 AND COALESCE(o.return_status, '') IN ('', 'rejected')
      GROUP BY LOWER(pr.vendor)
    ) s ON s.vendor = LOWER(v.name)
    LEFT JOIN (
      SELECT vendor_id, SUM(amount) AS paid
      FROM vendor_payouts
      WHERE provider_status IN ('manual_recorded', 'queued', 'pending', 'processing', 'processed')
      GROUP BY vendor_id
    ) p ON p.vendor_id = v.id
    ORDER BY v.name`;
  return client ? client.query(sql) : query(sql);
}
