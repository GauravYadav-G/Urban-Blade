import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../core/auth.middleware.js';
import { query, withTransaction } from '../../db/pool.js';
import { invalidateCatalog } from '../../redis/cache.service.js';
import { restoreCommittedStock } from './refund.service.js';

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected', 'received']),
  note: z.string().trim().min(3).max(500),
  restock: z.boolean().optional(),
}).strict();
const idSchema = z.string().uuid();

export async function returnsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/orders/:id/return', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = reasonSchema.safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_RETURN_REQUEST' });
    try {
      const order = await withTransaction(async client => {
        const result = await client.query('SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE', [request.params.id, request.user.id]);
        const current = result.rows[0];
        if (!current) throw new Error('ORDER_NOT_FOUND');
        if (current.return_status) return current;
        if (current.status !== 'delivered' || current.payment_status === 'refunded' || current.refund_status === 'pending') throw new Error('ORDER_NOT_RETURNABLE');
        return (await client.query(`UPDATE orders SET return_status = 'requested', return_reason = $2,
          return_requested_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [current.id, parsed.data.reason])).rows[0];
      });
      return { ok: true, returnStatus: order.return_status };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'RETURN_UNAVAILABLE';
      request.log.warn({ error }, 'Return request failed');
      return reply.code(code === 'ORDER_NOT_FOUND' ? 404 : code === 'ORDER_NOT_RETURNABLE' ? 409 : 503).send({ error: code, message: 'The return could not be requested. Check the order status and retry.' });
    }
  });

  app.put<{ Params: { id: string } }>('/admin/orders/:id/return', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_RETURN_REVIEW' });
    if (parsed.data.status === 'received' && parsed.data.restock === undefined) return reply.code(400).send({ error: 'RESTOCK_DECISION_REQUIRED' });
    try {
      const order = await withTransaction(async client => {
        const current = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [request.params.id])).rows[0];
        if (!current) throw new Error('ORDER_NOT_FOUND');
        if (current.return_status === parsed.data.status) return current;
        const allowed: Record<string, string[]> = { requested: ['approved', 'rejected'], approved: ['received'] };
        if (!allowed[current.return_status]?.includes(parsed.data.status)) throw new Error('INVALID_RETURN_TRANSITION');
        if (parsed.data.status === 'received') {
          if (parsed.data.restock) await restoreCommittedStock(client, current.id);
          else {
            // Inspected damaged goods must never be added back by refund reconciliation.
            await client.query("UPDATE stock_reservations SET status = 'restored', resolved_at = NOW() WHERE order_id = $1 AND status = 'committed'", [current.id]);
          }
        }
        return (await client.query(`UPDATE orders SET return_status = $2::varchar, return_review_note = $3,
          return_received_at = CASE WHEN $2::text = 'received' THEN NOW() ELSE return_received_at END,
          updated_at = NOW(), version = version + 1 WHERE id = $1 RETURNING *`, [current.id, parsed.data.status, parsed.data.note])).rows[0];
      });
      await invalidateCatalog().catch(() => {});
      return { ok: true, order };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'RETURN_UNAVAILABLE';
      request.log.warn({ error }, 'Return review failed');
      return reply.code(code === 'ORDER_NOT_FOUND' ? 404 : code === 'INVALID_RETURN_TRANSITION' ? 409 : 503).send({ error: code, message: 'Return review could not be saved. Refresh the order and retry.' });
    }
  });

  app.post<{ Params: { id: string } }>('/admin/orders/:id/collection', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = z.object({ reference: z.string().trim().min(3).max(150) }).strict().safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_COLLECTION' });
    try {
      const result = await query(`UPDATE orders SET payment_status = 'captured', transaction_id = $2, updated_at = NOW()
        WHERE id = $1 AND status = 'delivered' AND payment_status = 'pending'
          AND payment_method IN ('Cash on Delivery', 'cash_on_delivery') AND refund_status IS NULL RETURNING id`, [request.params.id, parsed.data.reference]);
      if (!result.rowCount) return reply.code(409).send({ error: 'COLLECTION_NOT_ALLOWED', message: 'Only delivered, unpaid COD orders can have a collection recorded.' });
      return { ok: true, message: 'COD collection recorded.' };
    } catch (error) {
      request.log.error({ error }, 'Collection record failed');
      return reply.code(503).send({ error: 'COLLECTION_UNAVAILABLE' });
    }
  });

  // Offline payments move outside Razorpay. Record only a completed external repayment.
  app.post<{ Params: { id: string } }>('/admin/orders/:id/refund/manual', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = z.object({ reference: z.string().trim().min(3).max(150), reason: z.string().trim().min(3).max(500) }).strict().safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_REFUND_RECORD' });
    try {
      const order = await withTransaction(async client => {
        const current = (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [request.params.id])).rows[0];
        if (!current) throw new Error('ORDER_NOT_FOUND');
        if (!['Cash on Delivery', 'cash_on_delivery', 'Cash', 'UPI', 'Card'].includes(current.payment_method) || !['captured', 'refunded'].includes(current.payment_status)) throw new Error('MANUAL_REFUND_NOT_ALLOWED');
        if (['shipped', 'delivered'].includes(current.status) && current.return_status !== 'received') throw new Error('RETURN_RECEIPT_REQUIRED');
        if (current.refund_status === 'processed') return current;
        await restoreCommittedStock(client, current.id);
        return (await client.query(`UPDATE orders SET status = CASE WHEN status = 'delivered' THEN status ELSE 'cancelled' END, payment_status = 'refunded', refund_status = 'processed',
          refund_amount = total_amount, refund_reason = $2, refund_external_reference = $3,
          refund_requested_at = NOW(), refunded_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [current.id, parsed.data.reason, parsed.data.reference])).rows[0];
      });
      await invalidateCatalog().catch(() => {});
      return { ok: true, order, message: 'External refund recorded. No money was transferred by this application.' };
    } catch (error) {
      request.log.warn({ error }, 'Manual refund record failed');
      return reply.code(409).send({ error: 'REFUND_RECORD_REJECTED', message: 'Record refunds only for collected offline payments. Shipped orders must be returned and received first.' });
    }
  });
}
