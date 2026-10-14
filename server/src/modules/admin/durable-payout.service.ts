import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { vendorBalances } from './vendor-finance.service.js';
import {
  fetchRazorpayXPayout, prepareRazorpayXPayout, providerPayoutSchema, submitRazorpayXPayout,
  type RazorpayXPayoutPayload, type VendorPayoutAccount,
} from './vendor-payout.service.js';

export const payoutRequestSchema = z.object({
  vendorId: z.string().trim().min(1).max(120), amount: z.number().finite().positive().multipleOf(0.01),
  reference: z.string().trim().min(3).max(150), notes: z.string().trim().max(1000).optional(),
  mode: z.enum(['manual', 'razorpayx']).default('manual'), recordedBy: z.string().uuid(),
}).strict();
export type VendorPayoutRequest = z.input<typeof payoutRequestSchema>;
type PayoutRow = {
  id: string; vendor_id: string; amount: string | number; reference: string; provider: string;
  provider_status: string; provider_transfer_id: string | null; provider_payload: RazorpayXPayoutPayload | null;
  provider_idempotency_key: string | null; submission_started_at: string | Date | null; created_at: string | Date;
  [key: string]: unknown;
};
export type PayoutGateway = {
  prepare: typeof prepareRazorpayXPayout;
  submit: typeof submitRazorpayXPayout;
  fetch: typeof fetchRazorpayXPayout;
};
const gatewayDefaults: PayoutGateway = { prepare: prepareRazorpayXPayout, submit: submitRazorpayXPayout, fetch: fetchRazorpayXPayout };
const inFlightMs = 60000;
// RazorpayX keys expire after seven days. Leave a full-day margin; after this,
// a missing provider ID needs operator investigation rather than another POST.
const safeRetryMs = 6 * 86400000;
const failures = ['failed', 'reversed', 'cancelled', 'rejected'];

function result(payout: PayoutRow) {
  // Stored request bodies contain beneficiary details, so keep them out of API responses.
  const { provider_payload, provider_idempotency_key, ...publicPayout } = payout;
  return { payout: publicPayout, disbursed: payout.provider === 'razorpayx' && payout.provider_status === 'processed' };
}

async function applyProviderPayout(payoutId: string, value: unknown) {
  const response = providerPayoutSchema.parse(value);
  return withTransaction(async client => {
    const payout = (await client.query<PayoutRow>('SELECT * FROM vendor_payouts WHERE id = $1 FOR UPDATE', [payoutId])).rows[0];
    if (!payout) throw new Error('PAYOUT_NOT_FOUND');
    if (payout.provider !== 'razorpayx' || response.amount !== Math.round(Number(payout.amount) * 100) ||
        response.reference_id !== (payout.provider_payload?.reference_id || payout.reference) ||
        (payout.provider_transfer_id && response.id !== payout.provider_transfer_id)) throw new Error('PAYOUT_PROVIDER_MISMATCH');
    let status: string = response.status;
    // Reversal is terminal, and delayed queued/processing events cannot undo
    // settled money or a confirmed terminal failure.
    if (payout.provider_status === 'reversed' ||
        (payout.provider_status === 'processed' && status !== 'reversed') ||
        (failures.includes(payout.provider_status) && !['processed', 'reversed'].includes(status))) status = payout.provider_status;
    return (await client.query<PayoutRow>(`UPDATE vendor_payouts SET provider_transfer_id = $2, provider_status = $3::varchar,
      failure_reason = $4, processed_at = CASE WHEN $3::text = 'processed' THEN COALESCE(processed_at,NOW()) ELSE processed_at END,
      checked_at = NOW() WHERE id = $1 RETURNING *`, [payoutId, response.id, status,
      failures.includes(status) ? `RazorpayX payout ${status}.` : null])).rows[0];
  });
}

async function submitClaim(payout: PayoutRow, gateway: PayoutGateway) {
  try {
    const response = await gateway.submit(payout.provider_payload!, payout.provider_idempotency_key!);
    return result(await applyProviderPayout(payout.id, response));
  } catch (error) {
    // The durable claim survives both a lost provider response and a database
    // failure after the provider accepted the payout. Never restore this balance.
    await query(`UPDATE vendor_payouts SET provider_status = 'uncertain', failure_reason = $2
      WHERE id = $1 AND provider_transfer_id IS NULL AND provider_status = 'submitting'`,
    [payout.id, 'Submission status is uncertain. Reconcile this saved payout before sending another.']).catch(() => {});
    throw error;
  }
}

export async function processVendorPayout(input: VendorPayoutRequest, gateway: PayoutGateway = gatewayDefaults) {
  const request = payoutRequestSchema.parse(input);
  const claim = await withTransaction(async client => {
    const vendor = (await client.query<{ id: string; name: string; payout_account: VendorPayoutAccount }>(
      "SELECT id, name, payout_account FROM vendors WHERE id = $1 AND status = 'active' FOR UPDATE", [request.vendorId])).rows[0];
    if (!vendor) throw new Error('VENDOR_NOT_FOUND');
    const existing = (await client.query<PayoutRow>('SELECT * FROM vendor_payouts WHERE reference = $1', [request.reference])).rows[0];
    if (existing) {
      if (existing.vendor_id !== request.vendorId || Number(existing.amount) !== request.amount || existing.provider !== request.mode) throw new Error('PAYOUT_REFERENCE_CONFLICT');
      return { payout: existing, submit: false };
    }
    const balances = await vendorBalances(client);
    const balance = balances.rows.find(row => row.id === request.vendorId);
    if (!balance || request.amount > Number(balance.payable_amount)) throw new Error('PAYOUT_EXCEEDS_BALANCE');
    const id = randomUUID();
    const payload = request.mode === 'razorpayx' ? gateway.prepare({
      amount: request.amount, reference: `ub_${id.replaceAll('-', '')}`, narration: `Urban Blade payout ${vendor.name}`,
      vendorId: vendor.id, vendorName: vendor.name, account: vendor.payout_account || {},
    }) : null;
    const payout = (await client.query<PayoutRow>(`INSERT INTO vendor_payouts(
      id,vendor_id,amount,reference,notes,recorded_by,provider,provider_transfer_id,provider_status,
      processed_at,provider_payload,provider_idempotency_key,submission_started_at)
      VALUES($1,$2,$3,$4,$5,$6,$7::varchar,$8,$9,CASE WHEN $7::text = 'manual' THEN NOW() ELSE NULL END,$10::jsonb,$11,
        CASE WHEN $7::text = 'razorpayx' THEN NOW() ELSE NULL END) RETURNING *`,
    [id, vendor.id, request.amount, request.reference, request.notes || '', request.recordedBy, request.mode,
      request.mode === 'manual' ? request.reference : null, request.mode === 'manual' ? 'manual_recorded' : 'submitting',
      payload ? JSON.stringify(payload) : null, payload ? id : null])).rows[0];
    return { payout, submit: Boolean(payload) };
  });
  return claim.submit ? submitClaim(claim.payout, gateway) : result(claim.payout);
}

/** Explicit recovery uses GET when possible and an identical POST only inside the key's valid lifetime. */
export async function reconcileVendorPayout(payoutId: string, gateway: PayoutGateway = gatewayDefaults) {
  if (!z.string().uuid().safeParse(payoutId).success) throw new Error('INVALID_PAYOUT_ID');
  const claim = await withTransaction(async client => {
    const payout = (await client.query<PayoutRow>('SELECT * FROM vendor_payouts WHERE id = $1 FOR UPDATE', [payoutId])).rows[0];
    if (!payout) throw new Error('PAYOUT_NOT_FOUND');
    if (payout.provider !== 'razorpayx' || failures.includes(payout.provider_status)) return { payout, action: 'none' as const };
    if (payout.provider_transfer_id) return { payout, action: 'fetch' as const };
    if (!payout.provider_payload || !payout.provider_idempotency_key) throw new Error('PAYOUT_REQUIRES_MANUAL_REVIEW');
    if (Date.now() - new Date(payout.submission_started_at || payout.created_at).getTime() < inFlightMs) return { payout, action: 'none' as const };
    if (Date.now() - new Date(payout.created_at).getTime() >= safeRetryMs) throw new Error('PAYOUT_REQUIRES_MANUAL_REVIEW');
    const updated = (await client.query<PayoutRow>("UPDATE vendor_payouts SET provider_status='submitting',submission_started_at=NOW() WHERE id=$1 RETURNING *", [payoutId])).rows[0];
    return { payout: updated, action: 'submit' as const };
  });
  if (claim.action === 'fetch') return result(await applyProviderPayout(claim.payout.id, await gateway.fetch(claim.payout.provider_transfer_id!)));
  if (claim.action === 'submit') return submitClaim(claim.payout, gateway);
  return result(claim.payout);
}

/** Call only after validating the webhook's exact-byte signature. */
export async function applyVendorPayoutWebhook(value: unknown): Promise<boolean> {
  const payout = providerPayoutSchema.parse(value);
  const local = (await query<{ id: string }>(`SELECT id FROM vendor_payouts WHERE provider = 'razorpayx'
    AND (provider_transfer_id = $1 OR provider_payload->>'reference_id' = $2) LIMIT 1`, [payout.id, payout.reference_id])).rows[0];
  if (!local) return false;
  await applyProviderPayout(local.id, payout);
  return true;
}
