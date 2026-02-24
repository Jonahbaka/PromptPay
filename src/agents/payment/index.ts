// ═══════════════════════════════════════════════════════════════
// Agent: Mercury — Mobile POS Payments for Africa & India
// 12 tools: M-Pesa, MTN MoMo, Flutterwave, Paystack, Razorpay,
//           status check, refund, provider health, airtime, data,
//           merchant QR generate, merchant QR pay
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { ToolDefinition } from '../../core/types.js';
import { CONFIG } from '../../core/config.js';

// ── Helpers ─────────────────────────────────────────────────

async function mpesaGetToken(): Promise<string> {
  const credentials = Buffer.from(`${CONFIG.mpesa.consumerKey}:${CONFIG.mpesa.consumerSecret}`).toString('base64');
  const baseUrl = CONFIG.mpesa.environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';

  const resp = await fetch(`${baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json() as Record<string, string>;
  return data.access_token;
}

async function mtnMomoGetToken(): Promise<string> {
  const baseUrl = CONFIG.mtnMomo.environment === 'production'
    ? 'https://momodeveloper.mtn.com'
    : 'https://sandbox.momodeveloper.mtn.com';

  const credentials = Buffer.from(`${CONFIG.mtnMomo.apiUser}:${CONFIG.mtnMomo.apiKey}`).toString('base64');
  const resp = await fetch(`${baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Ocp-Apim-Subscription-Key': CONFIG.mtnMomo.subscriptionKey,
    },
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json() as Record<string, string>;
  return data.access_token;
}

// ── Reloadly Airtime API ──
let reloadlyToken: string | null = null;
let reloadlyTokenExpiry = 0;

async function reloadlyGetToken(): Promise<string> {
  if (reloadlyToken && Date.now() < reloadlyTokenExpiry) return reloadlyToken;
  const res = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CONFIG.reloadly.clientId,
      client_secret: CONFIG.reloadly.clientSecret,
      grant_type: 'client_credentials',
      audience: CONFIG.reloadly.environment === 'production'
        ? 'https://topups.reloadly.com' : 'https://topups-sandbox.reloadly.com',
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  reloadlyToken = data.access_token as string;
  reloadlyTokenExpiry = Date.now() + ((data.expires_in as number) * 1000) - 60000;
  return reloadlyToken;
}

async function reloadlyRequest(path: string, body?: Record<string, unknown>, method = 'POST'): Promise<Record<string, unknown>> {
  const token = await reloadlyGetToken();
  const baseUrl = CONFIG.reloadly.environment === 'production'
    ? 'https://topups.reloadly.com' : 'https://topups-sandbox.reloadly.com';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/com.reloadly.topups-v1+json',
    },
    ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  return await res.json() as Record<string, unknown>;
}

// ── Schemas ─────────────────────────────────────────────────

const mpesaStkPushSchema = z.object({
  phoneNumber: z.string().min(10).describe('Phone number in format 254XXXXXXXXX'),
  amount: z.number().positive(),
  accountReference: z.string().min(1),
  transactionDesc: z.string().optional().default('PromptPay Payment'),
});

const mtnMomoSchema = z.object({
  phoneNumber: z.string().min(10).describe('Phone number in international format'),
  amount: z.number().positive(),
  currency: z.enum(['GHS', 'UGX', 'XAF', 'XOF', 'EUR']),
  externalId: z.string().min(1),
  payerMessage: z.string().optional().default('PromptPay Payment'),
  payeeNote: z.string().optional().default(''),
});

const flutterwaveChargeSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().min(3).max(3),
  paymentType: z.enum(['mobile_money_ghana', 'mobile_money_uganda', 'mobile_money_kenya', 'mpesa', 'card', 'bank_transfer', 'ussd']),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  txRef: z.string().min(1),
  redirectUrl: z.string().url().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

const paystackInitSchema = z.object({
  amount: z.number().positive().describe('Amount in kobo (NGN) or pesewas (GHS)'),
  currency: z.enum(['NGN', 'GHS', 'ZAR', 'KES', 'USD']),
  email: z.string().email(),
  channel: z.enum(['card', 'bank', 'mobile_money', 'ussd', 'qr']).optional(),
  reference: z.string().optional(),
  callbackUrl: z.string().url().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const razorpayOrderSchema = z.object({
  amount: z.number().positive().describe('Amount in paise (INR)'),
  currency: z.enum(['INR', 'USD']).optional().default('INR'),
  receipt: z.string().min(1),
  method: z.enum(['upi', 'netbanking', 'card', 'wallet', 'emi']).optional(),
  notes: z.record(z.string(), z.string()).optional(),
});

const paymentStatusSchema = z.object({
  provider: z.enum(['mpesa', 'mtn_momo', 'flutterwave', 'paystack', 'razorpay']),
  transactionRef: z.string().min(1),
});

const paymentRefundSchema = z.object({
  provider: z.enum(['mpesa', 'mtn_momo', 'flutterwave', 'paystack', 'razorpay']),
  transactionRef: z.string().min(1),
  amount: z.number().positive().optional().describe('Partial refund amount; omit for full refund'),
  reason: z.string().optional().default('Customer request'),
});

const providerStatusSchema = z.object({
  providers: z.array(z.enum(['mpesa', 'mtn_momo', 'flutterwave', 'paystack', 'razorpay'])).optional(),
});

const airtimeTopupSchema = z.object({
  phoneNumber: z.string().min(10).describe('Phone number with country code (e.g., 2347012345678 for Nigeria)'),
  amount: z.number().positive().describe('Amount in local currency (NGN, GHS, UGX, KES)'),
  countryCode: z.enum(['NG', 'GH', 'UG', 'KE']).describe('ISO country code'),
  operatorId: z.number().optional().describe('Reloadly operator ID (auto-detected if omitted)'),
  carrierName: z.string().optional().describe('Carrier name (e.g., MTN Nigeria, Safaricom) for display purposes'),
  recipientType: z.enum(['self', 'other']).optional().default('self').describe('Whether buying for self or someone else'),
});

const dataBundleSchema = z.object({
  phoneNumber: z.string().min(10).describe('Phone number with country code'),
  amount: z.number().positive().describe('Amount in local currency for data bundle'),
  countryCode: z.enum(['NG', 'GH', 'UG', 'KE']),
  operatorId: z.number().optional(),
  carrierName: z.string().optional().describe('Carrier name for display purposes'),
  recipientType: z.enum(['self', 'other']).optional().default('self'),
});

const merchantQrSchema = z.object({
  merchantName: z.string().min(1).describe('Business or merchant name'),
  amount: z.number().positive().optional().describe('Fixed amount (omit for dynamic/open amount)'),
  currency: z.string().default('usd'),
});

const merchantQrPaySchema = z.object({
  qrPayload: z.string().min(1).describe('Scanned QR code payload string'),
  payerUserId: z.string().min(1),
});

// ── Tool Implementations ────────────────────────────────────

export const paymentTools: ToolDefinition[] = [
  // ─── 1. M-Pesa STK Push ──────────────────────────────────
  {
    name: 'mpesa_stk_push',
    description: 'Initiate M-Pesa Lipa Na M-Pesa (STK Push) payment via Safaricom Daraja API. Sends payment prompt to customer\'s phone. Kenya & Tanzania. A 2.5% merchant payment fee applies.',
    category: 'payment',
    inputSchema: mpesaStkPushSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = mpesaStkPushSchema.parse(input);
      ctx.logger.info(`[Mercury] M-Pesa STK Push: ${params.phoneNumber} KES ${params.amount}`);

      if (!CONFIG.mpesa.consumerKey) {
        return { success: false, data: null, error: 'M-Pesa not configured — set MPESA_CONSUMER_KEY/SECRET' };
      }

      try {
        const token = await mpesaGetToken();
        const baseUrl = CONFIG.mpesa.environment === 'production'
          ? 'https://api.safaricom.co.ke'
          : 'https://sandbox.safaricom.co.ke';

        const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
        const password = Buffer.from(`${CONFIG.mpesa.shortcode}${CONFIG.mpesa.passkey}${timestamp}`).toString('base64');

        const resp = await fetch(`${baseUrl}/mpesa/stkpush/v1/processrequest`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            BusinessShortCode: CONFIG.mpesa.shortcode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: 'CustomerPayBillOnline',
            Amount: params.amount,
            PartyA: params.phoneNumber,
            PartyB: CONFIG.mpesa.shortcode,
            PhoneNumber: params.phoneNumber,
            CallBackURL: `${CONFIG.promptpay.apiUrl}/webhooks/mpesa`,
            AccountReference: params.accountReference,
            TransactionDesc: params.transactionDesc,
          }),
          signal: AbortSignal.timeout(15000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (data.ResponseCode === '0') {
          const fee = (params.amount * 0.025);
          const total = params.amount + fee;
          return {
            success: true,
            data: {
              provider: 'mpesa',
              checkoutRequestId: data.CheckoutRequestID,
              merchantRequestId: data.MerchantRequestID,
              responseDescription: data.ResponseDescription,
              status: 'pending',
              fee: `$${fee.toFixed(2)} (2.5%)`,
              total: `$${total.toFixed(2)}`,
            },
            metadata: { country: 'KE', currency: 'KES' },
          };
        }

        return { success: false, data, error: `M-Pesa error: ${data.errorMessage || data.ResponseDescription}` };
      } catch (err) {
        return { success: false, data: null, error: `M-Pesa STK Push failed: ${err}` };
      }
    },
  },

  // ─── 2. MTN MoMo Request to Pay ──────────────────────────
  {
    name: 'mtn_momo_request_to_pay',
    description: 'Initiate MTN Mobile Money Request-to-Pay. Covers 15+ African countries: Ghana, Uganda, Cameroon, Ivory Coast, Congo, etc. A 2.5% merchant payment fee applies.',
    category: 'payment',
    inputSchema: mtnMomoSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = mtnMomoSchema.parse(input);
      ctx.logger.info(`[Mercury] MTN MoMo Request-to-Pay: ${params.phoneNumber} ${params.currency} ${params.amount}`);

      if (!CONFIG.mtnMomo.subscriptionKey) {
        return { success: false, data: null, error: 'MTN MoMo not configured — set MTN_MOMO_SUBSCRIPTION_KEY' };
      }

      try {
        const token = await mtnMomoGetToken();
        const baseUrl = CONFIG.mtnMomo.environment === 'production'
          ? 'https://momodeveloper.mtn.com'
          : 'https://sandbox.momodeveloper.mtn.com';

        const referenceId = crypto.randomUUID();

        const resp = await fetch(`${baseUrl}/collection/v1_0/requesttopay`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Reference-Id': referenceId,
            'X-Target-Environment': CONFIG.mtnMomo.environment,
            'Ocp-Apim-Subscription-Key': CONFIG.mtnMomo.subscriptionKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: String(params.amount),
            currency: params.currency,
            externalId: params.externalId,
            payer: { partyIdType: 'MSISDN', partyId: params.phoneNumber },
            payerMessage: params.payerMessage,
            payeeNote: params.payeeNote,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (resp.status === 202) {
          const fee = (params.amount * 0.025);
          const total = params.amount + fee;
          return {
            success: true,
            data: {
              provider: 'mtn_momo',
              referenceId,
              status: 'pending',
              message: 'Request-to-Pay initiated. Awaiting customer approval.',
              fee: `$${fee.toFixed(2)} (2.5%)`,
              total: `$${total.toFixed(2)}`,
            },
            metadata: { currency: params.currency },
          };
        }

        const errorData = await resp.text();
        return { success: false, data: null, error: `MTN MoMo error (${resp.status}): ${errorData}` };
      } catch (err) {
        return { success: false, data: null, error: `MTN MoMo failed: ${err}` };
      }
    },
  },

  // ─── 3. Flutterwave Charge ────────────────────────────────
  {
    name: 'flutterwave_charge',
    description: 'Initiate payment via Flutterwave v3. Supports mobile money (Ghana, Uganda, Kenya), M-Pesa, card, bank transfer. Pan-African coverage. A 2.5% merchant payment fee applies.',
    category: 'payment',
    inputSchema: flutterwaveChargeSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = flutterwaveChargeSchema.parse(input);
      ctx.logger.info(`[Mercury] Flutterwave charge: ${params.paymentType} ${params.currency} ${params.amount}`);

      if (!CONFIG.flutterwave.secretKey) {
        return { success: false, data: null, error: 'Flutterwave not configured — set FLUTTERWAVE_SECRET_KEY' };
      }

      try {
        const resp = await fetch('https://api.flutterwave.com/v3/payments', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CONFIG.flutterwave.secretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tx_ref: params.txRef,
            amount: params.amount,
            currency: params.currency,
            payment_options: params.paymentType,
            customer: {
              email: params.email,
              phone_number: params.phoneNumber || '',
            },
            redirect_url: params.redirectUrl || `${CONFIG.promptpay.apiUrl}/webhooks/flutterwave`,
            meta: params.meta || {},
          }),
          signal: AbortSignal.timeout(15000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (data.status === 'success') {
          const fee = (params.amount * 0.025);
          const total = params.amount + fee;
          return {
            success: true,
            data: {
              provider: 'flutterwave',
              paymentLink: (data.data as Record<string, unknown>)?.link,
              txRef: params.txRef,
              status: 'pending',
              fee: `$${fee.toFixed(2)} (2.5%)`,
              total: `$${total.toFixed(2)}`,
            },
            metadata: { currency: params.currency, type: params.paymentType },
          };
        }

        return { success: false, data, error: `Flutterwave error: ${data.message}` };
      } catch (err) {
        return { success: false, data: null, error: `Flutterwave charge failed: ${err}` };
      }
    },
  },

  // ─── 4. Paystack Initialize ───────────────────────────────
  {
    name: 'paystack_initialize',
    description: 'Initialize a Paystack transaction. Nigeria, Ghana, South Africa, Kenya. Supports card, bank, mobile money, USSD, QR. A 2.5% merchant payment fee applies.',
    category: 'payment',
    inputSchema: paystackInitSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = paystackInitSchema.parse(input);
      ctx.logger.info(`[Mercury] Paystack initialize: ${params.currency} ${params.amount}`);

      if (!CONFIG.paystack.secretKey) {
        return { success: false, data: null, error: 'Paystack not configured — set PAYSTACK_SECRET_KEY' };
      }

      try {
        const body: Record<string, unknown> = {
          amount: params.amount,
          email: params.email,
          currency: params.currency,
          callback_url: params.callbackUrl || `${CONFIG.promptpay.apiUrl}/webhooks/paystack`,
        };
        if (params.reference) body.reference = params.reference;
        if (params.channel) body.channels = [params.channel];
        if (params.metadata) body.metadata = params.metadata;

        const resp = await fetch('https://api.paystack.co/transaction/initialize', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${CONFIG.paystack.secretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (data.status === true) {
          const txData = data.data as Record<string, unknown>;
          const fee = (params.amount * 0.025);
          const total = params.amount + fee;
          return {
            success: true,
            data: {
              provider: 'paystack',
              authorizationUrl: txData.authorization_url,
              accessCode: txData.access_code,
              reference: txData.reference,
              status: 'pending',
              fee: `$${fee.toFixed(2)} (2.5%)`,
              total: `$${total.toFixed(2)}`,
            },
            metadata: { currency: params.currency },
          };
        }

        return { success: false, data, error: `Paystack error: ${data.message}` };
      } catch (err) {
        return { success: false, data: null, error: `Paystack initialize failed: ${err}` };
      }
    },
  },

  // ─── 5. Razorpay Create Order ─────────────────────────────
  {
    name: 'razorpay_create_order',
    description: 'Create a Razorpay order for Indian payments. Supports UPI, netbanking, cards, wallets, EMI. Amount in paise. A 2.5% merchant payment fee applies.',
    category: 'payment',
    inputSchema: razorpayOrderSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = razorpayOrderSchema.parse(input);
      ctx.logger.info(`[Mercury] Razorpay order: ${params.currency} ${params.amount} paise`);

      if (!CONFIG.razorpay.keyId) {
        return { success: false, data: null, error: 'Razorpay not configured — set RAZORPAY_KEY_ID/KEY_SECRET' };
      }

      try {
        const credentials = Buffer.from(`${CONFIG.razorpay.keyId}:${CONFIG.razorpay.keySecret}`).toString('base64');

        const body: Record<string, unknown> = {
          amount: params.amount,
          currency: params.currency,
          receipt: params.receipt,
        };
        if (params.method) body.method = params.method;
        if (params.notes) body.notes = params.notes;

        const resp = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (data.id) {
          const fee = (params.amount * 0.025);
          const total = params.amount + fee;
          return {
            success: true,
            data: {
              provider: 'razorpay',
              orderId: data.id,
              amount: data.amount,
              currency: data.currency,
              status: data.status,
              receipt: data.receipt,
              fee: `$${fee.toFixed(2)} (2.5%)`,
              total: `$${total.toFixed(2)}`,
            },
            metadata: { currency: params.currency, country: 'IN' },
          };
        }

        return { success: false, data, error: `Razorpay error: ${JSON.stringify(data.error || data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Razorpay order failed: ${err}` };
      }
    },
  },

  // ─── 6. Payment Status Check ──────────────────────────────
  {
    name: 'payment_status_check',
    description: 'Check payment status across any provider (M-Pesa, MTN MoMo, Flutterwave, Paystack, Razorpay) by transaction reference.',
    category: 'payment',
    inputSchema: paymentStatusSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = paymentStatusSchema.parse(input);
      ctx.logger.info(`[Mercury] Payment status: ${params.provider} ref=${params.transactionRef}`);

      try {
        switch (params.provider) {
          case 'flutterwave': {
            if (!CONFIG.flutterwave.secretKey) return { success: false, data: null, error: 'Flutterwave not configured' };
            const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${params.transactionRef}/verify`, {
              headers: { Authorization: `Bearer ${CONFIG.flutterwave.secretKey}` },
              signal: AbortSignal.timeout(10000),
            });
            const data = await resp.json() as Record<string, unknown>;
            const txData = data.data as Record<string, unknown> | undefined;
            return {
              success: true,
              data: {
                provider: 'flutterwave',
                status: txData?.status || 'unknown',
                amount: txData?.amount,
                currency: txData?.currency,
                ref: params.transactionRef,
              },
            };
          }

          case 'paystack': {
            if (!CONFIG.paystack.secretKey) return { success: false, data: null, error: 'Paystack not configured' };
            const resp = await fetch(`https://api.paystack.co/transaction/verify/${params.transactionRef}`, {
              headers: { Authorization: `Bearer ${CONFIG.paystack.secretKey}` },
              signal: AbortSignal.timeout(10000),
            });
            const data = await resp.json() as Record<string, unknown>;
            const txData = data.data as Record<string, unknown> | undefined;
            return {
              success: true,
              data: {
                provider: 'paystack',
                status: txData?.status || 'unknown',
                amount: txData?.amount,
                currency: txData?.currency,
                ref: params.transactionRef,
              },
            };
          }

          case 'razorpay': {
            if (!CONFIG.razorpay.keyId) return { success: false, data: null, error: 'Razorpay not configured' };
            const creds = Buffer.from(`${CONFIG.razorpay.keyId}:${CONFIG.razorpay.keySecret}`).toString('base64');
            const resp = await fetch(`https://api.razorpay.com/v1/orders/${params.transactionRef}`, {
              headers: { Authorization: `Basic ${creds}` },
              signal: AbortSignal.timeout(10000),
            });
            const data = await resp.json() as Record<string, unknown>;
            return {
              success: true,
              data: {
                provider: 'razorpay',
                status: data.status || 'unknown',
                amount: data.amount,
                currency: data.currency,
                ref: params.transactionRef,
              },
            };
          }

          case 'mpesa': {
            return {
              success: true,
              data: {
                provider: 'mpesa',
                ref: params.transactionRef,
                status: 'check_callback',
                message: 'M-Pesa status is delivered via callback. Check webhook logs.',
              },
            };
          }

          case 'mtn_momo': {
            if (!CONFIG.mtnMomo.subscriptionKey) return { success: false, data: null, error: 'MTN MoMo not configured' };
            const token = await mtnMomoGetToken();
            const baseUrl = CONFIG.mtnMomo.environment === 'production'
              ? 'https://momodeveloper.mtn.com'
              : 'https://sandbox.momodeveloper.mtn.com';
            const resp = await fetch(`${baseUrl}/collection/v1_0/requesttopay/${params.transactionRef}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                'X-Target-Environment': CONFIG.mtnMomo.environment,
                'Ocp-Apim-Subscription-Key': CONFIG.mtnMomo.subscriptionKey,
              },
              signal: AbortSignal.timeout(10000),
            });
            const data = await resp.json() as Record<string, unknown>;
            return {
              success: true,
              data: {
                provider: 'mtn_momo',
                status: data.status || 'unknown',
                amount: data.amount,
                currency: data.currency,
                ref: params.transactionRef,
              },
            };
          }
        }
      } catch (err) {
        return { success: false, data: null, error: `Payment status check failed: ${err}` };
      }
    },
  },

  // ─── 7. Payment Refund ────────────────────────────────────
  {
    name: 'payment_refund',
    description: 'Initiate a refund via any configured payment provider. Supports full or partial refunds.',
    category: 'payment',
    inputSchema: paymentRefundSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = paymentRefundSchema.parse(input);
      ctx.logger.info(`[Mercury] Refund: ${params.provider} ref=${params.transactionRef}`);

      try {
        switch (params.provider) {
          case 'flutterwave': {
            if (!CONFIG.flutterwave.secretKey) return { success: false, data: null, error: 'Flutterwave not configured' };
            const body: Record<string, unknown> = {};
            if (params.amount) body.amount = params.amount;
            const resp = await fetch(`https://api.flutterwave.com/v3/transactions/${params.transactionRef}/refund`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${CONFIG.flutterwave.secretKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(15000),
            });
            const data = await resp.json() as Record<string, unknown>;
            return { success: data.status === 'success', data, error: data.status !== 'success' ? String(data.message) : undefined };
          }

          case 'paystack': {
            if (!CONFIG.paystack.secretKey) return { success: false, data: null, error: 'Paystack not configured' };
            const body: Record<string, unknown> = { transaction: params.transactionRef };
            if (params.amount) body.amount = params.amount;
            const resp = await fetch('https://api.paystack.co/refund', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${CONFIG.paystack.secretKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(15000),
            });
            const data = await resp.json() as Record<string, unknown>;
            return { success: data.status === true, data, error: data.status !== true ? String(data.message) : undefined };
          }

          case 'razorpay': {
            if (!CONFIG.razorpay.keyId) return { success: false, data: null, error: 'Razorpay not configured' };
            const creds = Buffer.from(`${CONFIG.razorpay.keyId}:${CONFIG.razorpay.keySecret}`).toString('base64');
            const body: Record<string, unknown> = {};
            if (params.amount) body.amount = params.amount;
            const resp = await fetch(`https://api.razorpay.com/v1/payments/${params.transactionRef}/refund`, {
              method: 'POST',
              headers: {
                Authorization: `Basic ${creds}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal: AbortSignal.timeout(15000),
            });
            const data = await resp.json() as Record<string, unknown>;
            return { success: !!data.id, data, error: !data.id ? JSON.stringify(data.error || data) : undefined };
          }

          default:
            return { success: false, data: null, error: `Refund not supported for ${params.provider} via API — use provider dashboard` };
        }
      } catch (err) {
        return { success: false, data: null, error: `Refund failed: ${err}` };
      }
    },
  },

  // ─── 8. Payment Providers Status ──────────────────────────
  {
    name: 'payment_providers_status',
    description: 'Health check for all configured payment providers. Tests API connectivity and returns status for each.',
    category: 'payment',
    inputSchema: providerStatusSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = providerStatusSchema.parse(input);
      const checkAll = !params.providers || params.providers.length === 0;
      const results: Array<{ provider: string; configured: boolean; reachable: boolean; latencyMs: number }> = [];

      const providers = checkAll
        ? (['mpesa', 'mtn_momo', 'flutterwave', 'paystack', 'razorpay'] as const)
        : params.providers!;

      for (const p of providers) {
        const start = Date.now();
        let configured = false;
        let reachable = false;

        try {
          switch (p) {
            case 'mpesa':
              configured = !!CONFIG.mpesa.consumerKey;
              if (configured) { await mpesaGetToken(); reachable = true; }
              break;
            case 'mtn_momo':
              configured = !!CONFIG.mtnMomo.subscriptionKey;
              if (configured) { await mtnMomoGetToken(); reachable = true; }
              break;
            case 'flutterwave':
              configured = !!CONFIG.flutterwave.secretKey;
              if (configured) {
                const r = await fetch('https://api.flutterwave.com/v3/transactions?per_page=1', {
                  headers: { Authorization: `Bearer ${CONFIG.flutterwave.secretKey}` },
                  signal: AbortSignal.timeout(5000),
                });
                reachable = r.ok;
              }
              break;
            case 'paystack':
              configured = !!CONFIG.paystack.secretKey;
              if (configured) {
                const r = await fetch('https://api.paystack.co/transaction/verify/test', {
                  headers: { Authorization: `Bearer ${CONFIG.paystack.secretKey}` },
                  signal: AbortSignal.timeout(5000),
                });
                reachable = r.status !== 0;
              }
              break;
            case 'razorpay':
              configured = !!CONFIG.razorpay.keyId;
              if (configured) {
                const creds = Buffer.from(`${CONFIG.razorpay.keyId}:${CONFIG.razorpay.keySecret}`).toString('base64');
                const r = await fetch('https://api.razorpay.com/v1/orders?count=1', {
                  headers: { Authorization: `Basic ${creds}` },
                  signal: AbortSignal.timeout(5000),
                });
                reachable = r.ok;
              }
              break;
          }
        } catch {
          reachable = false;
        }

        results.push({ provider: p, configured, reachable, latencyMs: Date.now() - start });
      }

      ctx.logger.info(`[Mercury] Provider status check: ${results.filter(r => r.reachable).length}/${results.length} reachable`);

      return {
        success: true,
        data: {
          providers: results,
          summary: {
            total: results.length,
            configured: results.filter(r => r.configured).length,
            reachable: results.filter(r => r.reachable).length,
          },
        },
      };
    },
  },

  // ─── 9. Airtime Top-Up (Wholesale Resale) ─────────────────
  {
    name: 'airtime_topup',
    description: 'Buy airtime/phone credits for any phone in Nigeria (MTN, Airtel, Glo, 9mobile), Ghana (MTN, Vodafone, AirtelTigo), Uganda (MTN, Airtel, Africell), Kenya (Safaricom, Airtel, Telkom). Specify carrier or auto-detect from number. Can buy for self or someone else. Wholesale purchase at face value + 2% convenience fee. Instant delivery.',
    category: 'airtime',
    inputSchema: airtimeTopupSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = airtimeTopupSchema.parse(input);
      ctx.logger.info(`[Mercury] Airtime top-up: ${params.countryCode} ${params.phoneNumber} ${params.amount}`);

      if (!CONFIG.reloadly.clientId) {
        return { success: false, data: null, error: 'Airtime not configured — set RELOADLY_CLIENT_ID/SECRET' };
      }

      try {
        // Auto-detect operator if not specified
        let operatorId = params.operatorId;
        let operatorName = params.carrierName || 'Unknown';
        if (!operatorId) {
          const detect = await reloadlyRequest(
            `/operators/auto-detect/phone/${params.phoneNumber}/countries/${params.countryCode}`,
            undefined, 'GET'
          );
          operatorId = detect.operatorId as number;
          operatorName = (detect.name as string) || params.carrierName || 'Detected';
        }

        // We buy at wholesale discount (3-5% off), sell at face value + 2% fee
        const convenienceFee = Math.round(params.amount * 0.02 * 100) / 100;
        const totalCharged = Math.round((params.amount + convenienceFee) * 100) / 100;
        const isForOther = params.recipientType === 'other';

        const result = await reloadlyRequest('/topups', {
          operatorId,
          amount: params.amount,
          useLocalAmount: true,
          recipientPhone: { countryCode: params.countryCode, number: params.phoneNumber },
          senderPhone: { countryCode: 'US', number: '0000000000' },
        });

        if (result.transactionId) {
          const txId = `AIR-${Date.now().toString(36).toUpperCase()}`;
          await ctx.memory.store({
            agentId: ctx.agentId, type: 'episodic', namespace: 'airtime',
            content: JSON.stringify({ txId, ...params, operatorName, fee: convenienceFee, forOther: isForOther, status: 'completed' }),
            importance: 0.7, metadata: { country: params.countryCode },
          });

          return {
            success: true,
            data: {
              transactionId: txId,
              externalId: result.transactionId,
              operator: operatorName,
              phoneNumber: params.phoneNumber,
              country: params.countryCode,
              recipientType: isForOther ? 'someone else' : 'self',
              amountDelivered: params.amount,
              convenienceFee: `${convenienceFee} (2%)`,
              totalCharged,
              discount: result.discount || '3-5% wholesale',
              status: 'completed',
              message: `${params.amount} airtime delivered to ${params.phoneNumber} via ${operatorName}${isForOther ? ' (for someone else)' : ''}`,
            },
          };
        }

        return { success: false, data: result, error: `Airtime delivery failed: ${result.message || JSON.stringify(result)}` };
      } catch (err) {
        return { success: false, data: null, error: `Airtime top-up failed: ${err}` };
      }
    },
  },

  // ─── 10. Data Bundle Purchase (Wholesale Resale) ──────────
  {
    name: 'data_bundle_purchase',
    description: 'Buy mobile data bundles for phones in Nigeria, Ghana, Uganda, Kenya. Specify carrier or auto-detect. Can buy for self or someone else. Wholesale purchase with 2% convenience fee. Supports all major carriers.',
    category: 'airtime',
    inputSchema: dataBundleSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = dataBundleSchema.parse(input);
      ctx.logger.info(`[Mercury] Data bundle: ${params.countryCode} ${params.phoneNumber} ${params.amount}`);

      if (!CONFIG.reloadly.clientId) {
        return { success: false, data: null, error: 'Data bundles not configured — set RELOADLY_CLIENT_ID/SECRET' };
      }

      try {
        let operatorId = params.operatorId;
        let operatorName = params.carrierName || 'Unknown';
        if (!operatorId) {
          const detect = await reloadlyRequest(
            `/operators/auto-detect/phone/${params.phoneNumber}/countries/${params.countryCode}`,
            undefined, 'GET'
          );
          operatorId = detect.operatorId as number;
          operatorName = (detect.name as string) || params.carrierName || 'Detected';
        }

        const convenienceFee = Math.round(params.amount * 0.02 * 100) / 100;
        const totalCharged = Math.round((params.amount + convenienceFee) * 100) / 100;
        const isForOther = params.recipientType === 'other';

        const result = await reloadlyRequest('/topups', {
          operatorId,
          amount: params.amount,
          useLocalAmount: true,
          recipientPhone: { countryCode: params.countryCode, number: params.phoneNumber },
          senderPhone: { countryCode: 'US', number: '0000000000' },
        });

        if (result.transactionId) {
          const txId = `DATA-${Date.now().toString(36).toUpperCase()}`;
          await ctx.memory.store({
            agentId: ctx.agentId, type: 'episodic', namespace: 'airtime',
            content: JSON.stringify({ txId, type: 'data', ...params, operatorName, fee: convenienceFee, forOther: isForOther, status: 'completed' }),
            importance: 0.7, metadata: { country: params.countryCode },
          });

          return {
            success: true,
            data: {
              transactionId: txId,
              externalId: result.transactionId,
              operator: operatorName,
              phoneNumber: params.phoneNumber,
              country: params.countryCode,
              recipientType: isForOther ? 'someone else' : 'self',
              amountDelivered: params.amount,
              convenienceFee: `${convenienceFee} (2%)`,
              totalCharged,
              status: 'completed',
              message: `Data bundle of ${params.amount} delivered to ${params.phoneNumber} via ${operatorName}${isForOther ? ' (for someone else)' : ''}`,
            },
          };
        }

        return { success: false, data: result, error: `Data bundle failed: ${result.message || JSON.stringify(result)}` };
      } catch (err) {
        return { success: false, data: null, error: `Data bundle purchase failed: ${err}` };
      }
    },
  },

  // ─── 11. Merchant QR Code Generate ────────────────────────
  {
    name: 'merchant_qr_generate',
    description: 'Generate a payment QR code for a merchant. Customers scan to pay instantly — replaces POS terminals. Supports fixed or open amounts. Like PIX/UPI model.',
    category: 'merchant',
    inputSchema: merchantQrSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = merchantQrSchema.parse(input);
      ctx.logger.info(`[Mercury] QR generate: ${params.merchantName} ${params.amount || 'open'} ${params.currency}`);

      const ref = 'QR-' + Date.now().toString(36).toUpperCase();
      const qrPayload = `upromptpay://pay?merchant=${encodeURIComponent(params.merchantName)}&amount=${params.amount || ''}&currency=${params.currency}&ref=${ref}`;
      const qrUrl = `${CONFIG.paytag.linkBaseUrl}/qr/${encodeURIComponent(qrPayload)}`;

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'merchant_qr',
        content: JSON.stringify({ ref, merchantName: params.merchantName, amount: params.amount, currency: params.currency, qrPayload }),
        importance: 0.7, metadata: { type: 'qr_code' },
      });

      return {
        success: true,
        data: {
          ref,
          qrPayload,
          qrUrl,
          merchantName: params.merchantName,
          amount: params.amount || 'open (customer enters amount)',
          currency: params.currency,
          instructions: 'Print this QR code or display on screen. Customers scan with PromptPay app to pay instantly.',
          message: params.amount
            ? `QR code for ${params.merchantName}: ${params.currency.toUpperCase()} ${params.amount}. Share or print the QR URL.`
            : `Open-amount QR code for ${params.merchantName}. Customer enters amount when scanning.`,
        },
      };
    },
  },

  // ─── 12. Merchant QR Pay (Scan & Pay) ─────────────────────
  {
    name: 'merchant_qr_pay',
    description: 'Pay a merchant by scanning their QR code. Deducts from wallet, replaces POS terminal. 2.5% merchant fee applies.',
    category: 'merchant',
    inputSchema: merchantQrPaySchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = merchantQrPaySchema.parse(input);
      ctx.logger.info(`[Mercury] QR pay: ${params.payerUserId} scanning QR`);

      try {
        // Parse QR payload
        const url = new URL(params.qrPayload.replace('upromptpay://', 'https://upromptpay.com/'));
        const merchant = decodeURIComponent(url.searchParams.get('merchant') || '');
        const amount = parseFloat(url.searchParams.get('amount') || '0');
        const currency = url.searchParams.get('currency') || 'usd';
        const ref = url.searchParams.get('ref') || '';

        if (!merchant) return { success: false, data: null, error: 'Invalid QR code — no merchant found' };
        if (!amount || amount <= 0) return { success: false, data: null, error: 'QR code has no amount — open-amount QR requires amount input' };

        const fee = Math.round(amount * 0.025 * 100) / 100;
        const total = Math.round((amount + fee) * 100) / 100;

        // Check payer wallet balance
        const wallets = await ctx.memory.recall('wallet', 'wallets', 5);
        const walletEntry = wallets.find(w => {
          const data = JSON.parse(w.content);
          return data.userId === params.payerUserId;
        });

        if (!walletEntry) return { success: false, data: null, error: 'No wallet found. Top up your wallet first.' };

        const wallet = JSON.parse(walletEntry.content);
        if (wallet.balance < total) {
          return { success: false, data: null, error: `Insufficient balance. Need ${total} ${currency}, have ${wallet.balance}` };
        }

        // Deduct from wallet
        wallet.balance = Math.round((wallet.balance - total) * 100) / 100;
        wallet.lastTransactionAt = new Date().toISOString();
        await ctx.memory.store({
          agentId: ctx.agentId, type: 'semantic', namespace: 'wallets',
          content: JSON.stringify(wallet), importance: 0.9, metadata: { userId: params.payerUserId },
        });

        const txId = `QRPAY-${Date.now().toString(36).toUpperCase()}`;
        await ctx.memory.store({
          agentId: ctx.agentId, type: 'episodic', namespace: 'transactions',
          content: JSON.stringify({ txId, type: 'qr_payment', merchant, amount, fee, total, currency, ref, payerId: params.payerUserId }),
          importance: 0.8, metadata: { type: 'qr_payment' },
        });

        return {
          success: true,
          data: {
            transactionId: txId,
            merchant,
            amount,
            fee: `${fee} (2.5%)`,
            total,
            currency,
            ref,
            newBalance: wallet.balance,
            status: 'completed',
            message: `Paid ${merchant}: ${currency.toUpperCase()} ${amount}. Fee: ${fee}. New balance: ${wallet.balance}`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `QR payment failed: ${err}` };
      }
    },
  },
];
