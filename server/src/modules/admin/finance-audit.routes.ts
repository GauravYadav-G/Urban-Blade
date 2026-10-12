import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { requireAdmin } from '../../core/auth.middleware.js';
import { paymentGateway } from '../orders/payment-settlement.service.js';
import { recordGatewayPayment } from '../orders/payment-snapshot.service.js';
import { reconcileOrderPayment } from '../orders/payment-reconciliation.service.js';
import { repairPaidOrderInventory } from '../orders/repair-paid-order.service.js';
import { vendorBalances } from './vendor-finance.service.js';

const rangeSchema = z.object({ days: z.coerce.number().int().min(1).max(366).default(30), offset: z.coerce.number().int().min(0).max(1000000).default(0), search: z.string().trim().max(100).default('') });
const money = (value: unknown) => Number(value || 0);

export async function financeAuditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAdmin);
  app.get('/admin/finance/audit', async (request, reply) => {
    const parsed = rangeSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_RANGE' });
    const { days, offset, search } = parsed.data;
    try {
      return await withTransaction(async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const local = (await client.query(`SELECT
          COALESCE(SUM(total_amount) FILTER(WHERE payment_status IN ('captured','refunded')),0) AS captured,
          COALESCE(SUM(GREATEST(CASE WHEN payment_status='refunded' OR refund_status='processed' THEN COALESCE(refund_amount,total_amount) ELSE 0 END, COALESCE((SELECT gp.refunded_paise/100.0 FROM gateway_payments gp WHERE gp.id=orders.razorpay_payment_id),0))),0) AS refunded,
          COALESCE(SUM(total_amount) FILTER(WHERE payment_status='pending' AND status<>'cancelled'),0) AS awaiting,
          COUNT(*) FILTER(WHERE payment_reconciliation_error IS NOT NULL)::int AS inventory_review,
          COUNT(*)::int AS orders
          FROM orders WHERE created_at >= NOW()-($1 * INTERVAL '1 day')`, [days])).rows[0];
        // Gateway money is grouped by payment creation date, matching Razorpay's
        // payment list. A checkout can have multiple attempts and unmatched payments.
        const gateway = (await client.query(`SELECT
          COUNT(*)::int AS attempts,
          COALESCE(SUM(amount_paise) FILTER(WHERE status IN ('captured','refunded')),0)/100.0 AS captured,
          COALESCE(SUM(refunded_paise),0)/100.0 AS refunded,
          COALESCE(SUM(fee_paise) FILTER(WHERE status IN ('captured','refunded')),0)/100.0 AS fees,
          COALESCE(SUM(tax_paise) FILTER(WHERE status IN ('captured','refunded')),0)/100.0 AS fee_tax,
          COUNT(*) FILTER(WHERE status IN ('captured','refunded') AND fee_paise IS NULL)::int AS fees_unknown,
          MAX(checked_at) AS last_checked,
          COUNT(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM orders o WHERE o.idempotency_key=g.gateway_order_id))::int AS unmatched
          FROM gateway_payments g WHERE currency='INR' AND provider_created_at>=NOW()-($1 * INTERVAL '1 day')`, [days])).rows[0];
        const params = [days, `%${search}%`];
        const where = `o.created_at >= NOW()-($1 * INTERVAL '1 day') AND
          (o.id::text ILIKE $2 OR COALESCE(o.razorpay_payment_id,'') ILIKE $2 OR COALESCE(o.idempotency_key,'') ILIKE $2 OR COALESCE(o.transaction_id,'') ILIKE $2)`;
        const total = (await client.query(`SELECT COUNT(*)::int AS count FROM orders o WHERE ${where}`,params)).rows[0].count;
        const orders = (await client.query(`SELECT o.id,o.created_at,o.status,o.payment_method,o.payment_status,
          o.total_amount,o.refund_status,o.refund_amount,o.payment_reconciliation_error,o.payment_checked_at,
          o.razorpay_payment_id,o.idempotency_key AS gateway_order_id,o.transaction_id,
          g.status AS gateway_status,g.amount_paise/100.0 AS gateway_amount,g.refunded_paise/100.0 AS gateway_refunded,
          g.fee_paise/100.0 AS gateway_fee,g.tax_paise/100.0 AS gateway_fee_tax,g.checked_at AS gateway_checked_at
          FROM orders o LEFT JOIN LATERAL (
            SELECT * FROM gateway_payments gp WHERE gp.gateway_order_id=o.idempotency_key
            ORDER BY CASE WHEN gp.status IN ('captured','refunded') THEN 0 WHEN gp.status='authorized' THEN 1 ELSE 2 END, gp.provider_created_at DESC LIMIT 1
          ) g ON TRUE WHERE ${where} ORDER BY o.created_at DESC,o.id LIMIT 50 OFFSET $3`,[...params,offset])).rows;
        const attempts = (await client.query(`SELECT g.*, EXISTS(SELECT 1 FROM orders o WHERE o.idempotency_key=g.gateway_order_id) AS matched
          FROM gateway_payments g WHERE currency='INR' AND provider_created_at>=NOW()-($1 * INTERVAL '1 day')
          AND (id ILIKE $2 OR COALESCE(gateway_order_id,'') ILIKE $2) ORDER BY provider_created_at DESC,id LIMIT 50 OFFSET $3`,[...params,offset])).rows;
        const inventory = (await client.query(`SELECT p.id,p.name,p.stock_quantity,p.stock_reserved,p.in_stock,p.version,
          COALESCE(SUM(s.quantity) FILTER(WHERE s.status='active'),0)::int AS ledger_reserved
          FROM products p LEFT JOIN stock_reservations s ON s.product_id=p.id
          GROUP BY p.id HAVING p.stock_reserved <> COALESCE(SUM(s.quantity) FILTER(WHERE s.status='active'),0)
             OR p.stock_reserved>p.stock_quantity ORDER BY p.name`)).rows;
        const vendors = await vendorBalances(client);
        return { ok: true, asOf: new Date().toISOString(), days, offset, total, orders, attempts, inventory,
          local: { captured: money(local.captured), refunded: money(local.refunded), net: money(local.captured)-money(local.refunded), awaiting: money(local.awaiting), inventoryReview: local.inventory_review, orders: local.orders },
          gateway: { captured: money(gateway.captured), refunded: money(gateway.refunded), fees: money(gateway.fees), feeTax: money(gateway.fee_tax), netAfterFees: money(gateway.captured)-money(gateway.refunded)-money(gateway.fees), feesUnknown: gateway.fees_unknown, attempts: gateway.attempts, unmatched: gateway.unmatched, lastChecked: gateway.last_checked },
          vendorSettlements: vendors.rows };
      });
    } catch (error) {
      request.log.error({ error }, 'Financial audit unavailable');
      return reply.code(503).send({ error: 'AUDIT_UNAVAILABLE', message: 'Financial records could not be loaded. Apply migrations and retry.' });
    }
  });

  app.post<{Params:{id:string}}>('/admin/orders/:id/repair-inventory', async(request,reply)=>{
    if(!z.string().uuid().safeParse(request.params.id).success) return reply.code(400).send({error:'INVALID_ORDER_ID'});
    try {
      const result=await repairPaidOrderInventory(request.params.id);
      await query('UPDATE orders SET payment_reconciliation_error=NULL,payment_checked_at=NOW() WHERE id=$1',[request.params.id]);
      return {ok:true,...result};
    }catch(error){request.log.warn({error},'Paid inventory repair rejected');return reply.code(409).send({error:'REPAIR_REJECTED',message:'Payment or inventory does not meet automatic repair checks. No stock was changed.'});}
  });

  // One provider page per request. The UI follows nextOffset; partial imports are
  // explicit, and repeating a page is harmless because payment IDs are unique.
  app.post('/admin/finance/sync-gateway', async (request, reply) => {
    const parsed = z.object({ from: z.number().int().positive(), to: z.number().int().positive(), offset: z.number().int().min(0).max(1000000).default(0) }).strict().safeParse(request.body);
    if (!parsed.success || parsed.data.to < parsed.data.from || parsed.data.to-parsed.data.from > 367*86400) return reply.code(400).send({ error: 'INVALID_SYNC_RANGE' });
    try {
      const gateway = paymentGateway();
      const { from,to,offset } = parsed.data;
      const result = await gateway.payments.all({ from,to,count:100,skip:offset });
      const issues: Array<{ paymentId: string; error: string }> = [];
      for (const payment of result.items) {
        await recordGatewayPayment(payment);
        if (!payment.order_id || !['captured','refunded'].includes(payment.status)) continue;
        const order = (await query("SELECT id FROM orders WHERE idempotency_key=$1 AND payment_method='Razorpay'",[payment.order_id])).rows[0];
        if (order) {
          try { await reconcileOrderPayment(order.id,gateway); }
          catch (error) { issues.push({ paymentId:payment.id,error:error instanceof Error ? error.message : 'RECONCILIATION_FAILED' }); }
        }
      }
      return { ok:true, imported:result.items.length, issues, nextOffset:result.items.length===100 ? offset+100 : null };
    } catch (error) {
      request.log.error({ error }, 'Gateway sync failed');
      return reply.code(503).send({ error:'GATEWAY_SYNC_UNAVAILABLE',message:'Razorpay could not be reached. Imported records remain saved; retry this page.' });
    }
  });
}
