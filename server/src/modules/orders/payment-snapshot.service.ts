import { z } from 'zod';
import { query } from '../../db/pool.js';

const paymentSchema = z.object({
  id: z.string().min(1), order_id: z.string().nullable().optional(),
  status: z.enum(['created', 'authorized', 'captured', 'refunded', 'failed']),
  amount: z.coerce.number().int().nonnegative(), amount_refunded: z.coerce.number().int().nonnegative().optional(),
  currency: z.string().length(3), fee: z.coerce.number().int().nonnegative().nullable().optional(),
  tax: z.coerce.number().int().nonnegative().nullable().optional(), method: z.string().optional(),
  created_at: z.number().int().positive().optional(),
});

export async function recordGatewayPayment(value: unknown) {
  const p = paymentSchema.parse(value);
  if ((p.amount_refunded || 0) > p.amount) throw new Error('INVALID_REFUND_AMOUNT');
  await query(`INSERT INTO gateway_payments(id, gateway_order_id, status, amount_paise, refunded_paise, currency, fee_paise, tax_paise, method, provider_created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE(to_timestamp($10::double precision), NOW()))
    ON CONFLICT(id) DO UPDATE SET
      status = CASE WHEN gateway_payments.status = 'refunded' THEN 'refunded'
        WHEN gateway_payments.status = 'captured' AND EXCLUDED.status IN ('created','authorized','failed') THEN 'captured' ELSE EXCLUDED.status END,
      refunded_paise = GREATEST(gateway_payments.refunded_paise, EXCLUDED.refunded_paise),
      fee_paise = COALESCE(EXCLUDED.fee_paise, gateway_payments.fee_paise), tax_paise = COALESCE(EXCLUDED.tax_paise, gateway_payments.tax_paise),
      method = COALESCE(EXCLUDED.method, gateway_payments.method), checked_at = NOW()`,
    [p.id, p.order_id || null, p.status, p.amount, p.amount_refunded || 0, p.currency, p.fee ?? null, p.tax ?? null, p.method || null, p.created_at || null]);
  return p;
}
