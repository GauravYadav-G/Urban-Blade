import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { settleCapturedPayment } from './payment-settlement.service.js';
import { recordGatewayPayment } from './payment-snapshot.service.js';
import { paymentGateway } from './payment-settlement.service.js';
import { applyRefundWebhook } from './refund.service.js';
import { applyVendorPayoutWebhook } from '../admin/durable-payout.service.js';

export async function paymentWebhookRoutes(app: FastifyInstance) {
  // Keep the exact request bytes: reserialising JSON invalidates webhook signatures.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 262144 }, (_req, body, done) => done(null, body));
  for (const endpoint of [
    { path: '/payments/razorpay/webhook', secret: () => config.razorpay.webhookSecret, payouts: false },
    { path: '/payments/razorpayx/webhook', secret: () => process.env.RAZORPAYX_WEBHOOK_SECRET?.trim() || '', payouts: true },
  ]) {
  app.post(endpoint.path, async (request, reply) => {
    const secret = endpoint.secret();
    if (!secret) return reply.code(503).send({ error: 'WEBHOOK_UNAVAILABLE' });
    const signature = request.headers['x-razorpay-signature'];
    const raw = request.body as Buffer;
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return reply.code(400).send({ error: 'INVALID_SIGNATURE' });
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'INVALID_JSON' }); }
    if (!event || typeof event.event !== 'string') return reply.code(400).send({ error: 'INVALID_EVENT' });
    if (endpoint.payouts) {
    if (!['payout.initiated', 'payout.updated', 'payout.queued', 'payout.pending', 'payout.processing', 'payout.processed', 'payout.failed',
      'payout.reversed', 'payout.rejected', 'payout.cancelled'].includes(event.event)) return { received: true };
      try {
        const matched = await applyVendorPayoutWebhook(event.payload?.payout?.entity);
        return { received: true, ...(!matched ? { ignored: true } : {}) };
      } catch (error) {
        request.log.error({ err: error }, 'Payout webhook needs reconciliation');
        return reply.code(503).send({ error: 'PAYOUT_RECONCILIATION_PENDING' });
      }
    }
    if (['refund.created', 'refund.processed', 'refund.failed'].includes(event.event)) {
      const parsed = z.object({ id: z.string().min(1), payment_id: z.string().min(1), status: z.enum(['pending', 'processed', 'failed']), amount: z.number().int().positive() }).passthrough().safeParse(event.payload?.refund?.entity);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'MISSING_REFUND' });
      }
      const refund = parsed.data;
      try {
        await applyRefundWebhook(refund);
        return { received: true };
      } catch (err: any) {
        if (err?.message === 'ORDER_MISMATCH') return reply.code(200).send({ received: true, ignored: true, reason: 'ORDER_MISMATCH' });
        request.log.error({ err, refundId: refund.id }, 'Refund webhook needs retry');
        return reply.code(503).send({ error: 'REFUND_RECONCILIATION_PENDING' });
      }
    }
    if (event.event === 'payment.failed') {
      const id = event.payload?.payment?.entity?.id;
      if (typeof id !== 'string') return reply.code(400).send({ error: 'MISSING_PAYMENT' });
      try { await recordGatewayPayment(await paymentGateway().payments.fetch(id)); return { received: true }; }
      catch { return reply.code(503).send({ error: 'PAYMENT_CHECK_PENDING' }); }
    }
    if (event.event !== 'payment.captured' && event.event !== 'order.paid' && event.event !== 'payment.authorized') return { received: true };
    const paymentId = event.payload?.payment?.entity?.id;
    if (typeof paymentId !== 'string') return reply.code(400).send({ error: 'MISSING_PAYMENT' });
    try {
      await settleCapturedPayment(paymentId);
      return { received: true };
    } catch (err: any) {
      if (err?.message === 'ORDER_MISMATCH') {
        request.log.warn({ paymentId }, 'Payment webhook received for unmapped order; acknowledging to prevent infinite retry');
        return reply.code(200).send({ received: true, ignored: true, reason: 'ORDER_MISMATCH' });
      }
      request.log.error({ err, paymentId }, 'Payment webhook needs retry or reconciliation');
      return reply.code(503).send({ error: 'SETTLEMENT_PENDING' });
    }
  });
  }
}
