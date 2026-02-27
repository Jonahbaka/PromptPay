// ═══════════════════════════════════════════════════════════════
// PromptPay :: Cross-Border Payment Providers
// pawaPay (mobile money) + Fincra (bank transfers) to Africa
// ═══════════════════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import { CONFIG } from '../core/config.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface CrossBorderPayoutResult {
  success: boolean;
  provider: 'pawapay' | 'fincra';
  transactionId: string;
  externalId: string;
  status: 'accepted' | 'processing' | 'completed' | 'failed';
  amount: number;
  currency: string;
  recipientName?: string;
  recipientAccount: string;
  fxRate?: number;
  fee?: number;
  error?: string;
}

export interface FincraQuoteResult {
  success: boolean;
  quoteReference: string;
  sourceCurrency: string;
  destinationCurrency: string;
  sourceAmount: number;
  destinationAmount: number;
  rate: number;
  fee: number;
  expiresAt: string;
  error?: string;
}

export interface PayoutStatusResult {
  success: boolean;
  provider: 'pawapay' | 'fincra';
  transactionId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  failureReason?: string;
}

// pawaPay correspondent code mapping
const PAWAPAY_CORRESPONDENTS: Record<string, Record<string, string>> = {
  KE: { mpesa: 'MPESA_KEN' },
  GH: { mtn: 'MTN_MOBILE_GHA', vodafone: 'VODAFONE_GHA', airteltigo: 'AIRTELTIGO_GHA' },
  NG: { mtn: 'MTN_MOMO_NGA', airtel: 'AIRTEL_NGA' },
  UG: { mtn: 'MTN_MOMO_UGA', airtel: 'AIRTEL_OAPI_UGA' },
  TZ: { airtel: 'AIRTEL_TZA', vodacom: 'VODACOM_TZA', tigo: 'TIGO_TZA', halotel: 'HALOTEL_TZA' },
  CM: { mtn: 'MTN_MOMO_CMR', orange: 'ORANGE_CMR' },
  SN: { orange: 'ORANGE_SEN', free: 'FREE_SEN' },
  RW: { mtn: 'MTN_MOMO_RWA', airtel: 'AIRTEL_RWA' },
  ZM: { mtn: 'MTN_MOMO_ZMB', airtel: 'AIRTEL_OAPI_ZMB' },
  MW: { tnm: 'TNM_MWI', airtel: 'AIRTEL_MWI' },
  CD: { vodacom: 'VODACOM_MPESA_COD', airtel: 'AIRTEL_OAPI_COD', orange: 'ORANGE_COD' },
  CI: { mtn: 'MTN_MOMO_CIV', orange: 'ORANGE_CIV' },
  BJ: { mtn: 'MTN_MOMO_BEN' },
  ET: { telebirr: 'TELEBIRR_ETH' },
};

// Country code to ISO 3166-1 alpha-3 mapping (pawaPay uses alpha-3)
const COUNTRY_TO_ALPHA3: Record<string, string> = {
  KE: 'KEN', GH: 'GHA', NG: 'NGA', UG: 'UGA', TZ: 'TZA',
  CM: 'CMR', SN: 'SEN', RW: 'RWA', ZM: 'ZMB', MW: 'MWI',
  CD: 'COD', CI: 'CIV', BJ: 'BEN', ET: 'ETH', ZA: 'ZAF',
  BF: 'BFA', GA: 'GAB', CG: 'COG', MZ: 'MOZ', SL: 'SLE',
  ZW: 'ZWE', LS: 'LSO',
};

// Currency mapping per country
const COUNTRY_CURRENCY: Record<string, string> = {
  KE: 'KES', GH: 'GHS', NG: 'NGN', UG: 'UGX', TZ: 'TZS',
  CM: 'XAF', SN: 'XOF', RW: 'RWF', ZM: 'ZMW', MW: 'MWK',
  CD: 'CDF', CI: 'XOF', BJ: 'XOF', ET: 'ETB', ZA: 'ZAR',
  BF: 'XOF', GA: 'XAF', CG: 'XAF', MZ: 'MZN',
};

// ─────────────────────────────────────────────────────────────
// pawaPay — Mobile Money Payouts to Africa
// ─────────────────────────────────────────────────────────────

async function pawapayRequest(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${CONFIG.pawapay.baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${CONFIG.pawapay.apiToken}`,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok && !data.payoutId && !data.depositId) {
    throw new Error(`pawaPay ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Send money to a mobile money wallet via pawaPay */
export async function pawapayPayout(params: {
  phoneNumber: string;
  amount: number;
  country: string;
  provider: string;
  description?: string;
}): Promise<CrossBorderPayoutResult> {
  const { phoneNumber, amount, country, provider, description } = params;
  const transactionId = uuid();
  const countryUpper = country.toUpperCase();

  // Resolve correspondent code
  const countryCorrespondents = PAWAPAY_CORRESPONDENTS[countryUpper];
  if (!countryCorrespondents) {
    return {
      success: false, provider: 'pawapay', transactionId, externalId: '',
      status: 'failed', amount, currency: COUNTRY_CURRENCY[countryUpper] || 'USD',
      recipientAccount: phoneNumber,
      error: `Country ${countryUpper} not supported by pawaPay`,
    };
  }

  const providerLower = provider.toLowerCase().replace(/[\s-]/g, '');
  const correspondentCode = countryCorrespondents[providerLower]
    || Object.values(countryCorrespondents)[0]; // fallback to first provider

  if (!correspondentCode) {
    return {
      success: false, provider: 'pawapay', transactionId, externalId: '',
      status: 'failed', amount, currency: COUNTRY_CURRENCY[countryUpper] || 'USD',
      recipientAccount: phoneNumber,
      error: `Provider ${provider} not found for ${countryUpper}`,
    };
  }

  const currency = COUNTRY_CURRENCY[countryUpper] || 'USD';

  // Clean phone number — ensure international format (no +)
  const cleanPhone = phoneNumber.replace(/^\+/, '').replace(/[\s-()]/g, '');

  try {
    const data = await pawapayRequest('/v2/payouts', 'POST', {
      payoutId: transactionId,
      amount: String(amount),
      currency,
      recipient: {
        type: 'MMO',
        accountDetails: {
          phoneNumber: cleanPhone,
          provider: correspondentCode,
        },
      },
      customerMessage: (description || 'PromptPay Transfer').slice(0, 22),
    });

    return {
      success: true,
      provider: 'pawapay',
      transactionId,
      externalId: String(data.payoutId || transactionId),
      status: data.status === 'ACCEPTED' ? 'accepted' : 'processing',
      amount,
      currency,
      recipientAccount: cleanPhone,
    };
  } catch (err) {
    return {
      success: false, provider: 'pawapay', transactionId, externalId: '',
      status: 'failed', amount, currency, recipientAccount: cleanPhone,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Check pawaPay payout status */
export async function pawapayGetStatus(payoutId: string): Promise<PayoutStatusResult> {
  try {
    const data = await pawapayRequest(`/v2/payouts/${payoutId}`, 'GET');
    const inner = (data.data || data) as Record<string, unknown>;
    const rawStatus = String(inner.status || data.status || '').toUpperCase();

    let status: PayoutStatusResult['status'] = 'pending';
    if (rawStatus === 'COMPLETED') status = 'completed';
    else if (rawStatus === 'FAILED') status = 'failed';
    else if (['PROCESSING', 'ACCEPTED', 'ENQUEUED'].includes(rawStatus)) status = 'processing';

    const failureReason = (inner.failureReason as Record<string, unknown>)?.failureMessage as string | undefined;

    return { success: true, provider: 'pawapay', transactionId: payoutId, status, failureReason };
  } catch (err) {
    return {
      success: false, provider: 'pawapay', transactionId: payoutId, status: 'failed',
      failureReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Get pawaPay wallet balances */
export async function pawapayGetBalances(): Promise<Record<string, unknown>> {
  return pawapayRequest('/wallet-balances', 'GET');
}

/** Get pawaPay active configuration (supported countries/MNOs) */
export async function pawapayGetConfig(): Promise<Record<string, unknown>> {
  return pawapayRequest('/active-conf', 'GET');
}

/** Predict which MNO a phone number belongs to */
export async function pawapayPredictCorrespondent(phoneNumber: string): Promise<Record<string, unknown>> {
  const cleanPhone = phoneNumber.replace(/^\+/, '').replace(/[\s-()]/g, '');
  return pawapayRequest(`/predict-correspondent?phoneNumber=${cleanPhone}`, 'GET');
}

// ─────────────────────────────────────────────────────────────
// Fincra — Bank Transfers + Mobile Money to Africa
// ─────────────────────────────────────────────────────────────

async function fincraRequest(
  endpoint: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const url = `${CONFIG.fincra.baseUrl}${endpoint}`;
  const headers: Record<string, string> = {
    'api-key': CONFIG.fincra.secretKey,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await response.json() as Record<string, unknown>;
  if (!response.ok && data.success !== true) {
    throw new Error(`Fincra ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

/** Get an FX quote from Fincra */
export async function fincraGetQuote(params: {
  sourceCurrency: string;
  destinationCurrency: string;
  amount: number;
  paymentDestination: 'bank_account' | 'mobile_money_wallet';
}): Promise<FincraQuoteResult> {
  try {
    const data = await fincraRequest('/quotes/generate', 'POST', {
      business: CONFIG.fincra.businessId,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      amount: String(params.amount),
      action: 'send',
      transactionType: 'disbursement',
      feeBearer: 'business',
      paymentDestination: params.paymentDestination,
      beneficiaryType: 'individual',
    });

    const quote = data.data as Record<string, unknown>;
    return {
      success: true,
      quoteReference: String(quote.reference || ''),
      sourceCurrency: String(quote.sourceCurrency || params.sourceCurrency),
      destinationCurrency: String(quote.destinationCurrency || params.destinationCurrency),
      sourceAmount: Number(quote.sourceAmount || quote.amountToCharge || params.amount),
      destinationAmount: Number(quote.destinationAmount || quote.amountToReceive || 0),
      rate: Number(quote.rate || 0),
      fee: Number(quote.fee || 0),
      expiresAt: String(quote.expireAt || ''),
    };
  } catch (err) {
    return {
      success: false, quoteReference: '', sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency, sourceAmount: params.amount,
      destinationAmount: 0, rate: 0, fee: 0, expiresAt: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Send money to a bank account via Fincra */
export async function fincraBankPayout(params: {
  amount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  recipientName: string;
  accountNumber: string;
  bankCode: string;
  country: string;
  quoteReference?: string;
  description?: string;
}): Promise<CrossBorderPayoutResult> {
  const transactionId = uuid();
  const customerRef = `PP-${transactionId.slice(0, 8)}`;

  try {
    const [firstName, ...lastParts] = params.recipientName.trim().split(/\s+/);
    const lastName = lastParts.join(' ') || firstName;

    const payload: Record<string, unknown> = {
      business: CONFIG.fincra.businessId,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      amount: params.amount,
      description: params.description || 'PromptPay International Transfer',
      paymentDestination: 'bank_account',
      customerReference: customerRef,
      beneficiary: {
        firstName,
        lastName,
        accountHolderName: params.recipientName,
        accountNumber: params.accountNumber,
        bankCode: params.bankCode,
        type: 'individual',
        country: params.country.toUpperCase(),
      },
    };

    // For cross-currency, include quote reference
    if (params.quoteReference) {
      payload.quoteReference = params.quoteReference;
    }

    const data = await fincraRequest('/disbursements/payouts', 'POST', payload);
    const payout = data.data as Record<string, unknown>;

    return {
      success: true,
      provider: 'fincra',
      transactionId,
      externalId: String(payout.reference || customerRef),
      status: 'processing',
      amount: params.amount,
      currency: params.destinationCurrency,
      recipientName: params.recipientName,
      recipientAccount: params.accountNumber,
    };
  } catch (err) {
    return {
      success: false, provider: 'fincra', transactionId, externalId: '',
      status: 'failed', amount: params.amount, currency: params.destinationCurrency,
      recipientAccount: params.accountNumber, recipientName: params.recipientName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Send money to a mobile money wallet via Fincra */
export async function fincraMobilePayout(params: {
  amount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  recipientName: string;
  phoneNumber: string;
  country: string;
  description?: string;
}): Promise<CrossBorderPayoutResult> {
  const transactionId = uuid();
  const customerRef = `PP-${transactionId.slice(0, 8)}`;

  try {
    const [firstName, ...lastParts] = params.recipientName.trim().split(/\s+/);
    const lastName = lastParts.join(' ') || firstName;

    const data = await fincraRequest('/disbursements/payouts', 'POST', {
      business: CONFIG.fincra.businessId,
      sourceCurrency: params.sourceCurrency,
      destinationCurrency: params.destinationCurrency,
      amount: params.amount,
      description: params.description || 'PromptPay Mobile Money Transfer',
      paymentDestination: 'mobile_money_wallet',
      customerReference: customerRef,
      beneficiary: {
        firstName,
        lastName,
        accountHolderName: params.recipientName,
        phone: params.phoneNumber.replace(/^\+/, ''),
        type: 'individual',
        country: params.country.toUpperCase(),
      },
    });

    const payout = data.data as Record<string, unknown>;

    return {
      success: true,
      provider: 'fincra',
      transactionId,
      externalId: String(payout.reference || customerRef),
      status: 'processing',
      amount: params.amount,
      currency: params.destinationCurrency,
      recipientName: params.recipientName,
      recipientAccount: params.phoneNumber,
    };
  } catch (err) {
    return {
      success: false, provider: 'fincra', transactionId, externalId: '',
      status: 'failed', amount: params.amount, currency: params.destinationCurrency,
      recipientAccount: params.phoneNumber, recipientName: params.recipientName,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Check Fincra payout status */
export async function fincraGetStatus(reference: string): Promise<PayoutStatusResult> {
  try {
    const data = await fincraRequest(`/disbursements/payouts/reference/${reference}`, 'GET');
    const payout = data.data as Record<string, unknown>;
    const rawStatus = String(payout.status || '').toLowerCase();

    let status: PayoutStatusResult['status'] = 'pending';
    if (rawStatus === 'successful') status = 'completed';
    else if (rawStatus === 'failed') status = 'failed';
    else if (rawStatus === 'processing') status = 'processing';

    return { success: true, provider: 'fincra', transactionId: reference, status };
  } catch (err) {
    return {
      success: false, provider: 'fincra', transactionId: reference, status: 'failed',
      failureReason: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Get Fincra wallet balances */
export async function fincraGetBalances(): Promise<Record<string, unknown>> {
  return fincraRequest(`/wallets?businessID=${CONFIG.fincra.businessId}`, 'GET');
}

/** Get supported banks from Fincra */
export async function fincraGetBanks(): Promise<Record<string, unknown>> {
  return fincraRequest('/core/banks', 'GET');
}

/** Get live FX rates from Fincra */
export async function fincraGetRates(currencyPair?: string): Promise<Record<string, unknown>> {
  const qs = currencyPair ? `?currencyPair=${currencyPair}` : '';
  return fincraRequest(`/quotes/treasury-orders/rates${qs}`, 'GET');
}

// ─────────────────────────────────────────────────────────────
// Webhook Verification
// ─────────────────────────────────────────────────────────────

/** Verify Fincra webhook signature (HMAC SHA-512) */
export function verifyFincraWebhook(payload: string, signature: string): boolean {
  if (!CONFIG.fincra.webhookSecret) return true; // skip if not configured
  const computed = crypto
    .createHmac('sha512', CONFIG.fincra.webhookSecret)
    .update(payload)
    .digest('hex');
  return computed === signature;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/** Get the local currency for a country */
export function getCurrencyForCountry(countryCode: string): string {
  return COUNTRY_CURRENCY[countryCode.toUpperCase()] || 'USD';
}

/** Check if pawaPay supports a country for mobile money */
export function isPawapaySupported(countryCode: string): boolean {
  return countryCode.toUpperCase() in PAWAPAY_CORRESPONDENTS;
}

/** Get available MNO providers for a country via pawaPay */
export function getPawapayProviders(countryCode: string): string[] {
  const correspondents = PAWAPAY_CORRESPONDENTS[countryCode.toUpperCase()];
  return correspondents ? Object.keys(correspondents) : [];
}

/** Get alpha-3 country code */
export function getAlpha3(countryCode: string): string {
  return COUNTRY_TO_ALPHA3[countryCode.toUpperCase()] || countryCode.toUpperCase();
}

/** Smart routing: choose best provider based on destination type and country */
export function routeProvider(params: {
  country: string;
  type: 'mobile_money' | 'bank_account';
}): 'pawapay' | 'fincra' {
  // Mobile money → prefer pawaPay (direct MNO connections, faster)
  if (params.type === 'mobile_money' && isPawapaySupported(params.country)) {
    return 'pawapay';
  }
  // Bank accounts → always Fincra
  // Mobile money in unsupported pawaPay countries → Fincra fallback
  return 'fincra';
}
