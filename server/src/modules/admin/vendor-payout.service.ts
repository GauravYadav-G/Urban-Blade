import { createHash } from 'node:crypto';
import { z } from 'zod';

export type VendorPayoutAccount = {
  bank?: string; accountNo?: string; ifsc?: string; upi?: string; verified?: boolean;
  verificationReference?: string; verifiedBeneficiaryName?: string;
};

const payoutPayloadSchema = z.object({
  account_number: z.string().min(1),
  fund_account: z.object({
    account_type: z.enum(['bank_account', 'vpa']),
    bank_account: z.object({ name: z.string().min(1), ifsc: z.string().min(1), account_number: z.string().min(1) }).optional(),
    vpa: z.object({ address: z.string().min(1) }).optional(),
    contact: z.object({ name: z.string().min(1).max(50), type: z.literal('vendor'), reference_id: z.string().min(1).max(40) }),
  }),
  amount: z.number().int().positive(), currency: z.literal('INR'), mode: z.enum(['UPI', 'IMPS']),
  purpose: z.literal('payout'), queue_if_low_balance: z.literal(true),
  reference_id: z.string().min(1).max(40), narration: z.string().max(30),
}).strict();

export type RazorpayXPayoutPayload = z.infer<typeof payoutPayloadSchema>;
export const providerPayoutSchema = z.object({
  id: z.string().regex(/^pout_[A-Za-z0-9]+$/),
  status: z.enum(['queued', 'pending', 'processing', 'processed', 'cancelled', 'reversed', 'failed', 'rejected']),
  amount: z.number().int().positive(), currency: z.literal('INR'), reference_id: z.string().min(1).max(40),
}).passthrough();
export type ProviderPayout = z.infer<typeof providerPayoutSchema>;

export type PayoutTransfer = {
  provider: 'razorpayx'; transferId: string; status: ProviderPayout['status']; reference: string; raw: ProviderPayout;
};

export class PayoutProviderError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'PayoutProviderError';
  }
}

function getRazorpayXConfig(): { accountNumber: string; keyId: string; keySecret: string } {
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER?.trim();
  const keyId = process.env.RAZORPAYX_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAYX_KEY_SECRET?.trim();
  if (!accountNumber || !keyId || !keySecret) {
    throw new PayoutProviderError('PAYOUT_PROVIDER_NOT_CONFIGURED', 'RazorpayX payout credentials are not configured.');
  }
  return { accountNumber, keyId, keySecret };
}

export type PayoutInput = {
  amount: number; reference: string; narration: string; vendorId: string;
  vendorName: string; account: VendorPayoutAccount;
};

/** Prepare and persist this exact body before making any provider request. */
export function prepareRazorpayXPayout(input: PayoutInput): RazorpayXPayoutPayload {
  if (!input.account.verified) {
    throw new PayoutProviderError('PAYOUT_ACCOUNT_UNVERIFIED', 'Verify the vendor bank or UPI details before sending a payout.');
  }
  const config = getRazorpayXConfig();
  let fundAccount: RazorpayXPayoutPayload['fund_account'];
  const contact = {
    name: input.vendorName.slice(0, 50), type: 'vendor' as const,
    reference_id: `vendor_${createHash('sha256').update(input.vendorId).digest('hex').slice(0, 32)}`,
  };
  if (input.account.upi?.trim()) {
    fundAccount = { account_type: 'vpa', vpa: { address: input.account.upi.trim() }, contact };
  } else if (input.account.accountNo?.trim() && input.account.ifsc?.trim() && input.account.verifiedBeneficiaryName?.trim()) {
    fundAccount = { account_type: 'bank_account', bank_account: {
      name: input.account.verifiedBeneficiaryName.trim(), ifsc: input.account.ifsc.trim().toUpperCase(),
      account_number: input.account.accountNo.trim(),
    }, contact };
  } else {
    throw new PayoutProviderError('PAYOUT_ACCOUNT_INCOMPLETE', 'Verified vendor bank account or UPI details are incomplete.');
  }
  return payoutPayloadSchema.parse({
    account_number: config.accountNumber, fund_account: fundAccount,
    amount: Math.round(input.amount * 100), currency: 'INR', mode: input.account.upi?.trim() ? 'UPI' : 'IMPS',
    purpose: 'payout', queue_if_low_balance: true, reference_id: input.reference, narration: input.narration.slice(0, 30),
  });
}

async function payoutRequest(path: string, method: 'GET' | 'POST', payload?: RazorpayXPayoutPayload, idempotencyKey?: string): Promise<ProviderPayout> {
  const config = getRazorpayXConfig();
  if (payload && payload.account_number !== config.accountNumber) {
    throw new PayoutProviderError('PAYOUT_SOURCE_ACCOUNT_CHANGED', 'The source account changed. Review the saved payout with Razorpay before retrying.');
  }
  try {
    const response = await fetch(`https://api.razorpay.com/v1/payouts${path}`, {
      method, signal: AbortSignal.timeout(10000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json', ...(idempotencyKey ? { 'X-Payout-Idempotency': idempotencyKey } : {}),
      }, ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const value: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      // A rejected retry can refer to an earlier accepted request. Only a
      // verified payout entity can release an ambiguous payout's reserved balance.
      throw new PayoutProviderError('PAYOUT_PROVIDER_REJECTED', 'RazorpayX did not confirm this payout. Reconcile the saved reference before submitting another payout.');
    }
    const parsed = providerPayoutSchema.safeParse(value);
    if (!parsed.success) throw new PayoutProviderError('PAYOUT_PROVIDER_INVALID_RESPONSE', 'RazorpayX returned an invalid payout response. The saved payout requires reconciliation.');
    return parsed.data;
  } catch (error) {
    if (error instanceof PayoutProviderError) throw error;
    throw new PayoutProviderError('PAYOUT_PROVIDER_UNAVAILABLE', 'RazorpayX payout status is uncertain. The saved balance remains reserved; reconcile this payout before sending another.');
  }
}

export async function submitRazorpayXPayout(payload: RazorpayXPayoutPayload, idempotencyKey: string): Promise<ProviderPayout> {
  if (!/^[A-Za-z0-9_-]{4,36}$/.test(idempotencyKey)) throw new PayoutProviderError('INVALID_PAYOUT_KEY', 'The saved payout key is invalid.');
  return payoutRequest('', 'POST', payoutPayloadSchema.parse(payload), idempotencyKey);
}

export async function fetchRazorpayXPayout(id: string): Promise<ProviderPayout> {
  if (!/^pout_[A-Za-z0-9]+$/.test(id)) throw new PayoutProviderError('INVALID_PAYOUT_ID', 'The saved payout ID is invalid.');
  return payoutRequest(`/${encodeURIComponent(id)}`, 'GET');
}

/** Compatibility helper. Durable application flows use prepare/submit separately. */
export async function createRazorpayXPayout(input: PayoutInput): Promise<PayoutTransfer> {
  const key = createHash('sha256').update(input.reference).digest('hex').slice(0, 32);
  const raw = await submitRazorpayXPayout(prepareRazorpayXPayout(input), key);
  return { provider: 'razorpayx', transferId: raw.id, status: raw.status, reference: input.reference, raw };
}
