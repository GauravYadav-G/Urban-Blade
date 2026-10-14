import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAdmin, requireAuth } from '../../core/auth.middleware.js';
import { OfflinePaymentError, recordCodCollection, recordExternalRefund } from './offline-payment.service.js';
import { getOrderReturn, listOrderReturns, requestOrderReturn, ReturnFlowError, reviewOrderReturn } from './return.service.js';

const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected', 'received']),
  note: z.string().trim().min(3).max(500),
  restock: z.boolean().optional(),
}).strict().superRefine((review, context) => {
  if (review.status === 'received' && review.restock === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['restock'], message: 'Choose whether inspected goods can be restocked.' });
  if (review.status !== 'received' && review.restock !== undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['restock'], message: 'Record stock decisions only when goods are received.' });
});
const idSchema = z.string().uuid();
const queueSchema = z.object({
  status: z.enum(['all', 'requested', 'approved', 'rejected', 'received']).default('all'),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  q: z.string().trim().max(150).optional(),
}).strict();

function returnFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  request.log.warn({ err: error }, 'Return operation failed');
  if (error instanceof ReturnFlowError) return reply.code(error.statusCode).send({ error: error.code, message: error.message });
  return reply.code(503).send({ error: 'RETURN_UNAVAILABLE', message: 'Returns are temporarily unavailable. Refresh the order and retry.' });
}

function offlinePaymentFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  request.log.warn({ err: error }, 'Offline payment record failed');
  const messages: Record<string, string> = {
    ORDER_NOT_FOUND: 'This order could not be found.',
    PAYMENT_REFERENCE_IN_USE: 'This payment reference is already attached to another order. Check the transaction record.',
    PAYMENT_REFERENCE_CONFLICT: 'This order already has a different payment reference. Refresh and review the recorded transaction.',
    COLLECTION_NOT_ALLOWED: 'Record collections only for delivered, unpaid COD orders before return receipt.',
    MANUAL_REFUND_NOT_ALLOWED: 'Record refunds only for collected offline payments after the repayment has completed.',
    RETURN_RECEIPT_REQUIRED: 'Receive and inspect shipped or delivered products before recording their refund.',
  };
  if (error instanceof OfflinePaymentError && messages[error.message]) {
    return reply.code(error.message === 'ORDER_NOT_FOUND' ? 404 : 409).send({ error: error.message, message: messages[error.message] });
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    return reply.code(409).send({ error: 'PAYMENT_REFERENCE_IN_USE', message: messages['PAYMENT_REFERENCE_IN_USE'] });
  }
  return reply.code(503).send({ error: 'PAYMENT_RECORD_UNAVAILABLE', message: 'The payment record could not be saved. Refresh the order and retry.' });
}

export async function returnsRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>('/orders/:id/return', { preHandler: [requireAuth] }, async (request, reply) => {
    const parsed = reasonSchema.safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_RETURN_REQUEST', message: 'Provide a valid order and a reason between 3 and 500 characters.' });
    try {
      const result = await requestOrderReturn(request.params.id, parsed.data.reason, request.user.id, 'customer');
      return { ok: true, order: result.order, returnStatus: result.order.return_status,
        message: result.changed ? 'Your full-order return was requested. Wait for approval before sending the products back.' : 'A return has already been recorded for this order.' };
    } catch (error) {
      return returnFailure(error, request, reply);
    }
  });

  app.post<{ Params: { id: string } }>('/admin/orders/:id/return', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = reasonSchema.safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_RETURN_REQUEST', message: 'Provide a valid order and a reason between 3 and 500 characters.' });
    try {
      const result = await requestOrderReturn(request.params.id, parsed.data.reason, request.user.id, 'admin');
      return { ok: true, order: result.order, returnStatus: result.order.return_status,
        message: result.changed ? 'Full-order return opened. Review it before requesting the products back.' : 'A return has already been recorded for this order.' };
    } catch (error) { return returnFailure(error, request, reply); }
  });

  app.put<{ Params: { id: string } }>('/admin/orders/:id/return', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_RETURN_REVIEW', message: 'Provide a review note and choose a stock decision when receiving products.' });
    try {
      const result = await reviewOrderReturn(request.params.id, request.user.id, parsed.data);
      return { ok: true, order: result.order, returnStatus: result.order.return_status,
        message: parsed.data.status === 'received' ? 'Receipt recorded. Review the payment and process any refund due.' : `Return ${parsed.data.status}.` };
    } catch (error) {
      return returnFailure(error, request, reply);
    }
  });

  app.get('/admin/returns', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = queueSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_RETURN_FILTER', message: 'Choose a valid return status, page and search query.' });
    try { return await listOrderReturns(parsed.data); }
    catch (error) { return returnFailure(error, request, reply); }
  });

  app.get<{ Params: { id: string } }>('/admin/orders/:id/return', { preHandler: [requireAdmin] }, async (request, reply) => {
    if (!idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });
    try { return await getOrderReturn(request.params.id); }
    catch (error) { return returnFailure(error, request, reply); }
  });

  app.get<{ Params: { id: string } }>('/orders/:id/return', { preHandler: [requireAuth] }, async (request, reply) => {
    if (!idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_ORDER_ID' });
    try { return await getOrderReturn(request.params.id, request.user.id); }
    catch (error) { return returnFailure(error, request, reply); }
  });

  app.post<{ Params: { id: string } }>('/admin/orders/:id/collection', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = z.object({ reference: z.string().trim().min(3).max(150) }).strict().safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_COLLECTION' });
    try {
      const order = await recordCodCollection(request.params.id, parsed.data.reference, request.user.id);
      return { ok: true, order, message: 'COD collection recorded.' };
    } catch (error) {
      return offlinePaymentFailure(error, request, reply);
    }
  });

  // Offline payments move outside Razorpay. Record only a completed external repayment.
  app.post<{ Params: { id: string } }>('/admin/orders/:id/refund/manual', { preHandler: [requireAdmin] }, async (request, reply) => {
    const parsed = z.object({ reference: z.string().trim().min(3).max(150), reason: z.string().trim().min(3).max(500) }).strict().safeParse(request.body);
    if (!parsed.success || !idSchema.safeParse(request.params.id).success) return reply.code(400).send({ error: 'INVALID_REFUND_RECORD' });
    try {
      const order = await recordExternalRefund(request.params.id, parsed.data.reference, parsed.data.reason, request.user.id);
      return { ok: true, order, message: 'External refund recorded. No money was transferred by this application.' };
    } catch (error) {
      return offlinePaymentFailure(error, request, reply);
    }
  });
}
