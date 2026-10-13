import { createHash } from 'node:crypto';

export type VendorPayoutAccount = {
  bank?: string;
  accountNo?: string;
  ifsc?: string;
  upi?: string;
  verified?: boolean;
  verificationReference?: string;
  verifiedBeneficiaryName?: string;
};

export type PayoutTransfer = {
  provider: 'razorpayx';
  transferId: string;
  status: string;
  reference: string;
  raw: unknown;
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
    throw new PayoutProviderError(
      'PAYOUT_PROVIDER_NOT_CONFIGURED',
      'RazorpayX payout credentials are not configured. No transfer was created.'
    );
  }
  return { accountNumber, keyId, keySecret };
}

function getFundAccount(account: VendorPayoutAccount): { account_type: 'bank_account' | 'vpa'; bank_account?: { name: string; ifsc: string; account_number: string }; vpa?: { address: string } } {
  if (account.upi?.trim()) {
    return { account_type: 'vpa', vpa: { address: account.upi.trim() } };
  }
  if (account.accountNo?.trim() && account.ifsc?.trim()) {
    return {
      account_type: 'bank_account',
      bank_account: {
        name: account.verifiedBeneficiaryName?.trim() || '',
        ifsc: account.ifsc.trim().toUpperCase(),
        account_number: account.accountNo.trim(),
      },
    };
  }
  throw new PayoutProviderError('PAYOUT_ACCOUNT_INCOMPLETE', 'Vendor bank account or UPI details are incomplete.');
}

export async function createRazorpayXPayout(input: {
  amount: number;
  reference: string;
  narration: string;
  vendorId: string;
  vendorName: string;
  account: VendorPayoutAccount;
}): Promise<PayoutTransfer> {
  if (!input.account.verified) {
    throw new PayoutProviderError('PAYOUT_ACCOUNT_UNVERIFIED', 'Verify the vendor bank or UPI details before sending a payout.');
  }
  const config = getRazorpayXConfig();
  const fundAccount = getFundAccount(input.account);
  const idempotencyKey = createHash('sha256').update(input.reference).digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch('https://api.razorpay.com/v1/payouts', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'X-Payout-Idempotency': idempotencyKey,
      },
      body: JSON.stringify({
        account_number: config.accountNumber,
        fund_account: { ...fundAccount, contact: { name: input.vendorName.slice(0, 50), type: 'vendor', reference_id: input.vendorId } },
        amount: Math.round(input.amount * 100),
        currency: 'INR',
        mode: input.account.upi?.trim() ? 'UPI' : 'IMPS',
        purpose: 'payout',
        queue_if_low_balance: true,
        reference_id: input.reference,
        narration: input.narration.slice(0, 30),
      }),
    });
    const payload: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new PayoutProviderError('PAYOUT_PROVIDER_REJECTED', payload?.error?.description || 'RazorpayX rejected the payout.');
    }
    if (!payload.id || !payload.status) {
      throw new PayoutProviderError('PAYOUT_PROVIDER_INVALID_RESPONSE', 'RazorpayX returned an invalid payout response.');
    }
    return { provider: 'razorpayx', transferId: payload.id, status: payload.status, reference: input.reference, raw: payload };
  } catch (error) {
    if (error instanceof PayoutProviderError) throw error;
    throw new PayoutProviderError('PAYOUT_PROVIDER_UNAVAILABLE', 'RazorpayX could not be reached. No transfer status was confirmed.');
  } finally {
    clearTimeout(timeout);
  }
}
