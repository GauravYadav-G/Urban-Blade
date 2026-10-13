
export interface RazorpayUpiValidationResult {
  valid: boolean;
  vpa: string;
  vendorName: string;
  registeredBeneficiaryName: string;
  nameMatchScore: number;
  nameMatch: boolean;
  pspProvider: string;
  validationReference: string;
  gateway: string;
  mode: 'live' | 'test';
  isSimulated: boolean;
  status: 'active' | 'invalid';
  validatedAt: string;
  error?: string;
  message?: string;
}

const VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export function resolvePspProvider(domain: string): string {
  const d = (domain || '').toLowerCase().replace('@', '');
  if (d.includes('hdfc')) return 'HDFC Bank (UPI / NPCI)';
  if (d.includes('icici')) return 'ICICI Bank (UPI / NPCI)';
  if (d.includes('sbi')) return 'State Bank of India (UPI / NPCI)';
  if (d.includes('axis')) return 'Axis Bank (UPI / NPCI)';
  if (d.includes('paytm')) return 'Paytm Payments Bank (UPI / NPCI)';
  if (d.includes('ybl') || d.includes('ibl') || d.includes('axl')) return 'PhonePe / Yes Bank (UPI / NPCI)';
  if (d.includes('okaxis') || d.includes('okhdfc') || d.includes('oksbi') || d.includes('okicici')) return 'Google Pay (NPCI)';
  if (d.includes('barodampay') || d.includes('bob')) return 'Bank of Baroda (UPI / NPCI)';
  if (d.includes('kotak')) return 'Kotak Mahindra Bank (UPI / NPCI)';
  if (d.includes('upi')) return 'BHIM / NPCI Core UPI';
  return 'National Payments Corporation of India (NPCI UPI)';
}

/**
 * Validates a Vendor's UPI VPA and Account Holder identity via Razorpay.
 * In Live Mode: Calls Razorpay Fund Account Validation APIs directly against the NPCI switch.
 * In Test Mode: Explains sandbox emulation because NPCI restricts live bank queries to Live Mode.
 */
export async function validateVendorUpiWithRazorpay(
  vpa: string,
  vendorName: string,
  vendorId?: string
): Promise<RazorpayUpiValidationResult> {
  const cleanVpa = (vpa || '').trim().toLowerCase();
  const keyId = process.env.RAZORPAYX_KEY_ID || '';
  const keySecret = process.env.RAZORPAYX_KEY_SECRET || '';
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || '';
  const isLive = keyId.startsWith('rzp_live_');
  const now = new Date().toISOString();

  if (!cleanVpa || !VPA_REGEX.test(cleanVpa)) {
    return {
      valid: false,
      vpa: cleanVpa,
      vendorName,
      registeredBeneficiaryName: '',
      nameMatchScore: 0,
      nameMatch: false,
      pspProvider: 'Unknown',
      validationReference: '',
      gateway: isLive ? 'Razorpay Live UPI Gateway' : 'Razorpay Sandbox (Test Mode)',
      mode: isLive ? 'live' : 'test',
      isSimulated: !isLive,
      status: 'invalid',
      validatedAt: now,
      error: 'INVALID_UPI_FORMAT',
      message: 'Invalid UPI VPA format. Expected handle@provider (e.g. merchant@hdfc, merchant@okaxis).',
    };
  }

  const parts = cleanVpa.split('@');
  const providerDomain = parts[1] || '';
  const pspProvider = resolvePspProvider(providerDomain);

  // In Test Mode: Test failure handles (e.g. failure@razorpay, fake@..., invalid@...)
  if (!isLive && (cleanVpa.includes('failure') || cleanVpa.includes('fake') || cleanVpa.includes('invalid') || cleanVpa.includes('reject'))) {
    return {
      valid: false,
      vpa: cleanVpa,
      vendorName,
      registeredBeneficiaryName: '',
      nameMatchScore: 0,
      nameMatch: false,
      pspProvider,
      validationReference: '',
      gateway: 'Razorpay Sandbox (Test Mode)',
      mode: 'test',
      isSimulated: true,
      status: 'invalid',
      validatedAt: now,
      error: 'VPA_REJECTED_BY_BANK',
      message: `The UPI VPA "${cleanVpa}" was rejected by the banking provider (Simulated Sandbox rejection).`,
    };
  }

  // 1. Live Mode: Real Razorpay Fund Account Validation API
  if (isLive && keyId && keySecret && accountNumber) {
    try {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
      const createResource = async (path: string, body: unknown): Promise<string> => {
        const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
          method: 'POST', signal: AbortSignal.timeout(10000),
          headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const payload = await response.json() as { id?: string };
        if (!response.ok || !payload.id) throw new Error('Provider resource creation failed');
        return payload.id;
      };
      const contactId = await createResource('contacts', { name: vendorName.slice(0, 50), type: 'vendor', reference_id: vendorId });
      const fundAccountId = await createResource('fund_accounts', { contact_id: contactId, account_type: 'vpa', vpa: { address: cleanVpa } });
      const response = await fetch('https://api.razorpay.com/v1/fund_accounts/validations', {
        method: 'POST',
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fund_account: { id: fundAccountId },
          account_number: accountNumber,
          notes: {
            vendor_id: vendorId || 'unknown',
            vendor_name: vendorName,
          },
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const liveName = data?.results?.registered_name || '';
        if (data.status !== 'completed' || data?.results?.account_status !== 'active' || !liveName || !data.id) throw new Error('Validation is not complete');
        const nameMatch = liveName.trim().toLowerCase() === vendorName.trim().toLowerCase();
        return {
          valid: true,
          vpa: cleanVpa,
          vendorName,
          registeredBeneficiaryName: liveName,
          nameMatchScore: nameMatch ? 100 : 0,
          nameMatch,
          pspProvider,
          validationReference: data.id,
          gateway: 'Razorpay Fund Account Validation (Live NPCI)',
          mode: 'live',
          isSimulated: false,
          status: 'active',
          validatedAt: now,
          message: `Live UPI VPA verified with NPCI bank records. Registered beneficiary: "${liveName}".`,
        };
      } else {
        const errData = (await response.json()) as any;
        return {
          valid: false,
          vpa: cleanVpa,
          vendorName,
          registeredBeneficiaryName: '',
          nameMatchScore: 0,
          nameMatch: false,
          pspProvider,
          validationReference: '',
          gateway: 'Razorpay Fund Account Validation (Live NPCI)',
          mode: 'live',
          isSimulated: false,
          status: 'invalid',
          validatedAt: now,
          error: errData?.error?.code || 'BANK_VALIDATION_FAILED',
          message: errData?.error?.description || 'The specified UPI ID does not exist on the NPCI banking switch.',
        };
      }
    } catch (err: any) {
      return {
        valid: false,
        vpa: cleanVpa,
        vendorName,
        registeredBeneficiaryName: '',
        nameMatchScore: 0,
        nameMatch: false,
        pspProvider,
        validationReference: '',
        gateway: 'Razorpay Fund Account Validation (Live NPCI)',
        mode: 'live',
        isSimulated: false,
        status: 'invalid',
        validatedAt: now,
        error: 'GATEWAY_COMMUNICATION_ERROR',
        message: 'Could not contact Razorpay Live Gateway for verification.',
      };
    }
  }

  // A sandbox response is never evidence of a real beneficiary account.
  return {
    valid: false, vpa: cleanVpa, vendorName, registeredBeneficiaryName: '',
    nameMatchScore: 0, nameMatch: false, pspProvider, validationReference: '',
    gateway: 'Razorpay', mode: 'test', isSimulated: true, status: 'invalid',
    validatedAt: now, error: 'LIVE_VERIFICATION_UNAVAILABLE',
    message: 'Live account verification is unavailable. Configure live provider credentials; sandbox data cannot verify a beneficiary.',
  };
}
