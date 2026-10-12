import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { settleCapturedPayment } from './payment-settlement.service.js';
import { recordGatewayPayment } from './payment-snapshot.service.js';
import { paymentGateway } from './payment-settlement.service.js';
import { applyRefundWebhook } from './refund.service.js';

export async function paymentWebhookRoutes(app: FastifyInstance) {
  // Keep the exact request bytes: reserialising JSON invalidates webhook signatures.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 262144 }, (_req, body, done) => done(null, body));
  app.post('/payments/razorpay/webhook', async (request, reply) => {
    if (!config.razorpay.webhookSecret) return reply.code(503).send({ error: 'WEBHOOK_UNAVAILABLE' });
    const signature = request.headers['x-razorpay-signature'];
    const raw = request.body as Buffer;
    const expected = createHmac('sha256', config.razorpay.webhookSecret).update(raw).digest('hex');
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return reply.code(400).send({ error: 'INVALID_SIGNATURE' });
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return reply.code(400).send({ error: 'INVALID_JSON' }); }
    if (!event || typeof event.event !== 'string') return reply.code(400).send({ error: 'INVALID_EVENT' });
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
