// ═══════════════════════════════════════════════════════════════
// Agent: Janus — US Payment Operations (Stripe-native)
// 16 tools: charge, subscription, connect onboard, ACH transfer,
//           Apple Pay session, Google Pay token, Payment Request
//           API, wallet balance, Apple Pay complete, Apple Pay sub,
//           Apple Pay express, Google Pay complete,
//           Wise cross-border quote, Wise cross-border transfer,
//           Circle USDC send, Circle USDC receive
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { ToolDefinition } from '../../core/types.js';
import { CONFIG } from '../../core/config.js';

// ── Helpers ─────────────────────────────────────────────────

async function stripeRequest(
  path: string,
  body: URLSearchParams | null,
  method: 'POST' | 'GET' = 'POST',
): Promise<Record<string, unknown>> {
  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${CONFIG.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body && method === 'POST') opts.body = body.toString();

  const url = `https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body.toString()}` : ''}`;
  const resp = await fetch(url, opts);
  return await resp.json() as Record<string, unknown>;
}

// ── Wise Platform API ──
async function wiseRequest(path: string, body?: Record<string, unknown>, method = 'GET'): Promise<Record<string, unknown>> {
  const baseUrl = CONFIG.wise.environment === 'production'
    ? 'https://api.wise.com' : 'https://api.sandbox.wise.com';
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${CONFIG.wise.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const resp = await fetch(`${baseUrl}${path}`, opts);
  return await resp.json() as Record<string, unknown>;
}

// ── Circle USDC API ──
async function circleRequest(path: string, body?: Record<string, unknown>, method = 'POST'): Promise<Record<string, unknown>> {
  const baseUrl = CONFIG.circle.environment === 'production'
    ? 'https://api.circle.com' : 'https://api-sandbox.circle.com';
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${CONFIG.circle.apiKey}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  const resp = await fetch(`${baseUrl}${path}`, opts);
  return await resp.json() as Record<string, unknown>;
}

// ── Schemas ─────────────────────────────────────────────────

const stripeChargeSchema = z.object({
  amountCents: z.number().positive().int(),
  currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
  description: z.string().min(1),
  customerEmail: z.string().email().optional(),
  customerId: z.string().optional(),
  paymentMethodId: z.string().optional(),
  statementDescriptor: z.string().max(22).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  captureMethod: z.enum(['automatic', 'manual']).optional().default('automatic'),
});

const stripeSubscriptionSchema = z.object({
  customerId: z.string().min(1),
  priceId: z.string().min(1),
  quantity: z.number().positive().int().optional().default(1),
  trialDays: z.number().min(0).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const stripeConnectSchema = z.object({
  email: z.string().email(),
  country: z.enum(['US', 'CA', 'GB', 'AU']).optional().default('US'),
  businessType: z.enum(['individual', 'company']).optional().default('individual'),
  returnUrl: z.string().url().optional(),
  refreshUrl: z.string().url().optional(),
});

const achTransferSchema = z.object({
  amountCents: z.number().positive().int(),
  currency: z.enum(['usd']).optional().default('usd'),
  customerId: z.string().min(1),
  bankAccountId: z.string().min(1),
  description: z.string().min(1),
  statementDescriptor: z.string().max(22).optional(),
});

const applePaySessionSchema = z.object({
  domainName: z.string().min(1),
  displayName: z.string().min(1),
  initiative: z.enum(['web', 'messaging']).optional().default('web'),
});

const googlePayTokenSchema = z.object({
  amountCents: z.number().positive().int(),
  currency: z.enum(['usd', 'eur', 'gbp']).optional().default('usd'),
  merchantName: z.string().min(1),
  countryCode: z.string().length(2).optional().default('US'),
});

const paymentRequestSchema = z.object({
  amountCents: z.number().positive().int(),
  currency: z.enum(['usd', 'eur', 'gbp']).optional().default('usd'),
  label: z.string().min(1),
  recipientChannel: z.enum(['telegram', 'whatsapp', 'discord', 'sms', 'webchat', 'email']),
  recipientId: z.string().min(1),
  expiresInMinutes: z.number().min(5).max(10080).optional().default(60),
});

const walletBalanceSchema = z.object({
  customerId: z.string().optional(),
  currency: z.enum(['usd', 'eur', 'gbp']).optional().default('usd'),
});

const wiseQuoteSchema = z.object({
  sourceAmount: z.number().positive(),
  sourceCurrency: z.string().min(3).max(3).describe('e.g., USD, EUR, GBP'),
  targetCurrency: z.string().min(3).max(3).describe('e.g., NGN, KES, GHS, UGX, INR, EUR'),
});

const wiseTransferSchema = z.object({
  quoteId: z.string().min(1).describe('Quote ID from wise_get_quote'),
  recipientName: z.string().min(1),
  recipientAccount: z.string().min(1).describe('Bank account number or IBAN'),
  recipientCountry: z.string().min(2).max(2).describe('ISO country code (NG, KE, GH, etc.)'),
  recipientCurrency: z.string().min(3).max(3),
  recipientBankCode: z.string().optional().describe('Bank/sort code if required'),
});

const usdcSendSchema = z.object({
  amount: z.number().positive().describe('Amount in USDC'),
  recipientAddress: z.string().min(1).describe('Wallet address or email'),
  chain: z.enum(['SOL', 'ETH', 'AVAX', 'MATIC']).default('SOL').describe('Blockchain network'),
  description: z.string().optional().default('uPromptPay USDC transfer'),
});

const usdcReceiveSchema = z.object({
  amount: z.number().positive().optional().describe('Expected amount (optional)'),
  chain: z.enum(['SOL', 'ETH', 'AVAX', 'MATIC']).default('SOL'),
});

// ── Tool Implementations ────────────────────────────────────

export const usPaymentTools: ToolDefinition[] = [
  // ─── 1. Stripe Charge ──────────────────────────────────────
  {
    name: 'stripe_charge',
    description: 'Create a Stripe Payment Intent with full control: amount, currency, capture method, statement descriptor, customer. Supports Apple Pay, Google Pay, cards, ACH. A 2.5% merchant payment fee applies.',
    category: 'us_payment',
    inputSchema: stripeChargeSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = stripeChargeSchema.parse(input);
      ctx.logger.info(`[Janus] Stripe charge: ${params.currency.toUpperCase()} ${params.amountCents}c`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        const body = new URLSearchParams({
          amount: String(params.amountCents),
          currency: params.currency,
          description: params.description,
          'automatic_payment_methods[enabled]': 'true',
          capture_method: params.captureMethod,
        });

        if (params.customerEmail) body.set('receipt_email', params.customerEmail);
        if (params.customerId) body.set('customer', params.customerId);
        if (params.paymentMethodId) body.set('payment_method', params.paymentMethodId);
        if (params.statementDescriptor) body.set('statement_descriptor', params.statementDescriptor);
        if (params.metadata) {
          for (const [k, v] of Object.entries(params.metadata)) {
            body.set(`metadata[${k}]`, v);
          }
        }

        const data = await stripeRequest('/payment_intents', body);

        if (data.id) {
          const feeCents = Math.round(params.amountCents * 0.025);
          const totalCents = params.amountCents + feeCents;

          // Store transaction in memory
          await ctx.memory.store({
            agentId: ctx.agentId,
            type: 'semantic',
            namespace: 'us_payments',
            content: JSON.stringify({
              paymentIntentId: data.id,
              amount: params.amountCents,
              currency: params.currency,
              status: data.status,
              createdAt: new Date().toISOString(),
            }),
            importance: 0.8,
            metadata: { paymentIntentId: data.id as string, type: 'charge' },
          });

          return {
            success: true,
            data: {
              paymentIntentId: data.id,
              clientSecret: data.client_secret,
              amount: data.amount,
              currency: data.currency,
              status: data.status,
              captureMethod: params.captureMethod,
              fee: `$${(feeCents / 100).toFixed(2)} (2.5%)`,
              total: `$${(totalCents / 100).toFixed(2)}`,
            },
          };
        }

        return { success: false, data: null, error: `Stripe error: ${JSON.stringify(data.error || data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Stripe charge failed: ${err}` };
      }
    },
  },

  // ─── 2. Stripe Subscription ────────────────────────────────
  {
    name: 'stripe_subscription',
    description: 'Create a Stripe recurring subscription for a customer. Supports free trials, metered billing, quantity adjustments.',
    category: 'us_payment',
    inputSchema: stripeSubscriptionSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = stripeSubscriptionSchema.parse(input);
      ctx.logger.info(`[Janus] Stripe subscription for customer ${params.customerId}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        const body = new URLSearchParams({
          customer: params.customerId,
          'items[0][price]': params.priceId,
          'items[0][quantity]': String(params.quantity),
        });

        if (params.trialDays) body.set('trial_period_days', String(params.trialDays));
        if (params.metadata) {
          for (const [k, v] of Object.entries(params.metadata)) {
            body.set(`metadata[${k}]`, v);
          }
        }

        const data = await stripeRequest('/subscriptions', body);

        if (data.id) {
          return {
            success: true,
            data: {
              subscriptionId: data.id,
              status: data.status,
              currentPeriodEnd: data.current_period_end,
              trialEnd: data.trial_end,
              latestInvoice: data.latest_invoice,
            },
          };
        }

        return { success: false, data: null, error: `Subscription error: ${JSON.stringify(data.error || data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Subscription creation failed: ${err}` };
      }
    },
  },

  // ─── 3. Stripe Connect Onboard ─────────────────────────────
  {
    name: 'stripe_connect_onboard',
    description: 'Onboard a new seller/practitioner as a Stripe Connected account. Enables marketplace payments, platform fees, and split payouts.',
    category: 'us_payment',
    inputSchema: stripeConnectSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = stripeConnectSchema.parse(input);
      ctx.logger.info(`[Janus] Stripe Connect onboard: ${params.email}`);

      if (!CONFIG.stripe.secretKey || !CONFIG.stripe.connectEnabled) {
        return { success: false, data: null, error: 'Stripe Connect not enabled — set STRIPE_SECRET_KEY and STRIPE_CONNECT_ENABLED=true' };
      }

      try {
        // Create connected account
        const acctBody = new URLSearchParams({
          type: 'express',
          email: params.email,
          country: params.country,
          'capabilities[card_payments][requested]': 'true',
          'capabilities[transfers][requested]': 'true',
          business_type: params.businessType,
        });

        const acctData = await stripeRequest('/accounts', acctBody);

        if (!acctData.id) {
          return { success: false, data: null, error: `Account creation failed: ${JSON.stringify(acctData.error || acctData)}` };
        }

        // Create account link for onboarding
        const linkBody = new URLSearchParams({
          account: acctData.id as string,
          type: 'account_onboarding',
          return_url: params.returnUrl || `${CONFIG.promptpay.apiUrl}/connect/return`,
          refresh_url: params.refreshUrl || `${CONFIG.promptpay.apiUrl}/connect/refresh`,
        });

        const linkData = await stripeRequest('/account_links', linkBody);

        return {
          success: true,
          data: {
            accountId: acctData.id,
            onboardingUrl: linkData.url,
            expiresAt: linkData.expires_at,
            message: 'Send onboarding URL to the practitioner to complete Stripe setup.',
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Stripe Connect failed: ${err}` };
      }
    },
  },

  // ─── 4. ACH Transfer ──────────────────────────────────────
  {
    name: 'ach_transfer',
    description: 'Initiate an ACH bank transfer for US-based payments. Lower fees than cards. Takes 3-5 business days. A 1.0% merchant payment fee applies.',
    category: 'us_payment',
    inputSchema: achTransferSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = achTransferSchema.parse(input);
      ctx.logger.info(`[Janus] ACH transfer: $${(params.amountCents / 100).toFixed(2)} for customer ${params.customerId}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        const body = new URLSearchParams({
          amount: String(params.amountCents),
          currency: params.currency,
          customer: params.customerId,
          payment_method: params.bankAccountId,
          description: params.description,
          'payment_method_types[]': 'us_bank_account',
          confirm: 'true',
        });

        if (params.statementDescriptor) body.set('statement_descriptor', params.statementDescriptor);

        const data = await stripeRequest('/payment_intents', body);

        if (data.id) {
          const feeCents = Math.round(params.amountCents * 0.01);
          const totalCents = params.amountCents + feeCents;
          return {
            success: true,
            data: {
              paymentIntentId: data.id,
              status: data.status,
              amount: `$${(params.amountCents / 100).toFixed(2)}`,
              estimatedArrival: '3-5 business days',
              method: 'ACH direct debit',
              fee: `$${(feeCents / 100).toFixed(2)} (1.0%)`,
              total: `$${(totalCents / 100).toFixed(2)}`,
            },
          };
        }

        return { success: false, data: null, error: `ACH error: ${JSON.stringify(data.error || data)}` };
      } catch (err) {
        return { success: false, data: null, error: `ACH transfer failed: ${err}` };
      }
    },
  },

  // ─── 5. Apple Pay Session ──────────────────────────────────
  {
    name: 'apple_pay_session',
    description: 'Create an Apple Pay merchant session for web payments. Enables native Apple Pay sheet on Safari/iOS without a native app.',
    category: 'us_payment',
    inputSchema: applePaySessionSchema,
    requiresApproval: false,
    riskLevel: 'medium',
    execute: async (input, ctx) => {
      const params = applePaySessionSchema.parse(input);
      ctx.logger.info(`[Janus] Apple Pay session for ${params.domainName}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        // Register domain for Apple Pay
        const domainBody = new URLSearchParams({
          domain_name: params.domainName,
        });
        await stripeRequest('/apple_pay/domains', domainBody);

        return {
          success: true,
          data: {
            domain: params.domainName,
            displayName: params.displayName,
            initiative: params.initiative,
            stripePublishableKey: CONFIG.stripe.publishableKey,
            applePayEnabled: true,
            integrationGuide: {
              step1: 'Include Stripe.js: <script src="https://js.stripe.com/v3/"></script>',
              step2: `Initialize: const stripe = Stripe('${CONFIG.stripe.publishableKey}');`,
              step3: 'Create PaymentRequest: stripe.paymentRequest({ country, currency, total })',
              step4: 'Mount: paymentRequestButton.mount("#apple-pay-button")',
            },
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Apple Pay session failed: ${err}` };
      }
    },
  },

  // ─── 6. Google Pay Token ───────────────────────────────────
  {
    name: 'google_pay_token',
    description: 'Generate Google Pay configuration for web payments. Returns tokenization spec for Stripe. No native app needed — works in Chrome/Android.',
    category: 'us_payment',
    inputSchema: googlePayTokenSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = googlePayTokenSchema.parse(input);
      ctx.logger.info(`[Janus] Google Pay config for ${params.merchantName}`);

      if (!CONFIG.stripe.publishableKey) {
        return { success: false, data: null, error: 'Stripe publishable key not configured — set STRIPE_PUBLISHABLE_KEY' };
      }

      return {
        success: true,
        data: {
          merchantName: params.merchantName,
          environment: CONFIG.stripe.secretKey.startsWith('sk_test') ? 'TEST' : 'PRODUCTION',
          gatewayConfig: {
            gateway: 'stripe',
            'stripe:version': '2023-10-16',
            'stripe:publishableKey': CONFIG.stripe.publishableKey,
          },
          transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: (params.amountCents / 100).toFixed(2),
            currencyCode: params.currency.toUpperCase(),
            countryCode: params.countryCode,
          },
          allowedPaymentMethods: [
            {
              type: 'CARD',
              parameters: { allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'], allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'] },
              tokenizationSpecification: {
                type: 'PAYMENT_GATEWAY',
                parameters: { gateway: 'stripe', 'stripe:publishableKey': CONFIG.stripe.publishableKey },
              },
            },
          ],
        },
      };
    },
  },

  // ─── 7. Payment Request API ────────────────────────────────
  {
    name: 'payment_request_api',
    description: 'Create a payment request and send it to any channel. Generates a secure checkout link with Apple Pay/Google Pay/card support. User taps link → pays instantly.',
    category: 'us_payment',
    inputSchema: paymentRequestSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = paymentRequestSchema.parse(input);
      ctx.logger.info(`[Janus] Payment request: $${(params.amountCents / 100).toFixed(2)} via ${params.recipientChannel}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        // Create Payment Intent
        const piBody = new URLSearchParams({
          amount: String(params.amountCents),
          currency: params.currency,
          description: params.label,
          'automatic_payment_methods[enabled]': 'true',
        });

        const piData = await stripeRequest('/payment_intents', piBody);

        if (!piData.id) {
          return { success: false, data: null, error: `Payment Intent failed: ${JSON.stringify(piData.error || piData)}` };
        }

        const checkoutUrl = `${CONFIG.promptpay.apiUrl}/pay/${piData.id}`;
        const expiresAt = new Date(Date.now() + params.expiresInMinutes * 60000).toISOString();

        // Send via messaging channel
        const sendTool = ctx.tools.get('send_message');
        if (sendTool) {
          const payMessage = [
            `💳 Payment Request: ${params.label}`,
            `Amount: $${(params.amountCents / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
            ``,
            `Tap to pay securely:`,
            checkoutUrl,
            ``,
            `Expires: ${new Date(expiresAt).toLocaleString()}`,
          ].join('\n');

          await sendTool.execute({
            channel: params.recipientChannel,
            recipientId: params.recipientId,
            message: payMessage,
          }, ctx);
        }

        return {
          success: true,
          data: {
            paymentIntentId: piData.id,
            clientSecret: piData.client_secret,
            checkoutUrl,
            amount: `$${(params.amountCents / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
            sentVia: params.recipientChannel,
            recipient: params.recipientId,
            expiresAt,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Payment request failed: ${err}` };
      }
    },
  },

  // ─── 8. Wallet Balance ─────────────────────────────────────
  {
    name: 'wallet_balance',
    description: 'Check Stripe account balance or customer balance. Shows available, pending, and reserved funds across currencies.',
    category: 'us_payment',
    inputSchema: walletBalanceSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = walletBalanceSchema.parse(input);
      ctx.logger.info(`[Janus] Wallet balance check`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        if (params.customerId) {
          // Get customer balance
          const data = await stripeRequest(`/customers/${params.customerId}`, null, 'GET');

          if (data.id) {
            return {
              success: true,
              data: {
                customerId: data.id,
                email: data.email,
                balance: data.balance,
                balanceFormatted: `$${(Math.abs(data.balance as number || 0) / 100).toFixed(2)}`,
                currency: data.currency || params.currency,
                delinquent: data.delinquent,
              },
            };
          }

          return { success: false, data: null, error: `Customer not found: ${params.customerId}` };
        }

        // Get platform balance
        const data = await stripeRequest('/balance', null, 'GET');
        const available = (data.available as Array<Record<string, unknown>> || []);
        const pending = (data.pending as Array<Record<string, unknown>> || []);

        return {
          success: true,
          data: {
            available: available.map(a => ({
              amount: `$${((a.amount as number || 0) / 100).toFixed(2)}`,
              currency: a.currency,
            })),
            pending: pending.map(p => ({
              amount: `$${((p.amount as number || 0) / 100).toFixed(2)}`,
              currency: p.currency,
            })),
            livemode: data.livemode,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Balance check failed: ${err}` };
      }
    },
  },

  // ─── 9. Apple Pay Complete Payment ──────────────────────────
  {
    name: 'apple_pay_complete_payment',
    description: 'Process an Apple Pay payment end-to-end. Takes a tokenized payment method, creates a PaymentIntent, confirms it, records the transaction, and returns a receipt. This is the full payment flow — not just session setup. A 2.5% merchant payment fee applies.',
    category: 'us_payment',
    inputSchema: z.object({
      paymentMethodId: z.string().min(1).describe('Stripe payment method ID (pm_xxx or tok_xxx from Apple Pay JS'),
      amountCents: z.number().positive().int().describe('Amount in cents'),
      currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
      description: z.string().min(1).describe('Payment description'),
      customerEmail: z.string().email().optional().describe('Customer email for receipt'),
      customerId: z.string().optional().describe('Existing Stripe customer ID'),
      receiptEmail: z.string().email().optional().describe('Email for payment receipt'),
      shipping: z.object({
        name: z.string(),
        address: z.object({
          line1: z.string(),
          line2: z.string().optional(),
          city: z.string(),
          state: z.string(),
          postal_code: z.string(),
          country: z.string().length(2),
        }),
      }).optional(),
      statementDescriptor: z.string().max(22).optional(),
    }),
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = z.object({
        paymentMethodId: z.string().min(1),
        amountCents: z.number().positive().int(),
        currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
        description: z.string().min(1),
        customerEmail: z.string().email().optional(),
        customerId: z.string().optional(),
        receiptEmail: z.string().email().optional(),
        shipping: z.object({
          name: z.string(),
          address: z.object({
            line1: z.string(),
            line2: z.string().optional(),
            city: z.string(),
            state: z.string(),
            postal_code: z.string(),
            country: z.string().length(2),
          }),
        }).optional(),
        statementDescriptor: z.string().max(22).optional(),
      }).parse(input);

      ctx.logger.info(`[Janus] Apple Pay payment: $${(params.amountCents / 100).toFixed(2)} ${params.currency}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        // Build PaymentIntent body
        const body = new URLSearchParams({
          amount: String(params.amountCents),
          currency: params.currency,
          'payment_method': params.paymentMethodId,
          'payment_method_types[0]': 'card',
          confirm: 'true',
          description: params.description,
        });

        if (params.customerId) body.append('customer', params.customerId);
        if (params.receiptEmail) body.append('receipt_email', params.receiptEmail);
        else if (params.customerEmail) body.append('receipt_email', params.customerEmail);
        if (params.statementDescriptor) body.append('statement_descriptor', params.statementDescriptor);

        if (params.shipping) {
          body.append('shipping[name]', params.shipping.name);
          body.append('shipping[address][line1]', params.shipping.address.line1);
          if (params.shipping.address.line2) body.append('shipping[address][line2]', params.shipping.address.line2);
          body.append('shipping[address][city]', params.shipping.address.city);
          body.append('shipping[address][state]', params.shipping.address.state);
          body.append('shipping[address][postal_code]', params.shipping.address.postal_code);
          body.append('shipping[address][country]', params.shipping.address.country);
        }

        body.append('metadata[source]', 'apple_pay');
        body.append('metadata[agent]', 'janus');

        const data = await stripeRequest('/payment_intents', body);

        if (data.error) {
          return { success: false, data: null, error: `Apple Pay charge failed: ${JSON.stringify(data.error)}` };
        }

        // Record transaction
        const charges = data.charges as Record<string, unknown> | undefined;
        const chargeList = (charges?.data as Array<Record<string, unknown>>) || [];
        const charge = chargeList[0];
        const paymentMethodDetails = charge?.payment_method_details as Record<string, unknown> | undefined;
        const card = paymentMethodDetails?.card as Record<string, unknown> | undefined;

        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'episodic',
          namespace: 'transactions',
          content: JSON.stringify({
            type: 'apple_pay_payment',
            paymentIntentId: data.id,
            amount: params.amountCents,
            currency: params.currency,
            status: data.status,
            last4: card?.last4 || 'unknown',
            brand: card?.brand || 'unknown',
            receiptUrl: charge?.receipt_url || null,
          }),
          metadata: { paymentIntentId: data.id as string, source: 'apple_pay' },
          importance: 0.8,
        });

        const feeCents = Math.round(params.amountCents * 0.025);
        const totalCents = params.amountCents + feeCents;

        return {
          success: true,
          data: {
            paymentIntentId: data.id,
            status: data.status,
            amount: `$${(params.amountCents / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
            last4: card?.last4 || 'unknown',
            brand: card?.brand || 'unknown',
            receiptUrl: charge?.receipt_url || null,
            receiptEmail: params.receiptEmail || params.customerEmail || null,
            paymentMethod: 'Apple Pay',
            fee: `$${(feeCents / 100).toFixed(2)} (2.5%)`,
            total: `$${(totalCents / 100).toFixed(2)}`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Apple Pay payment failed: ${err}` };
      }
    },
  },

  // ─── 10. Apple Pay Subscription ─────────────────────────────
  {
    name: 'apple_pay_subscription',
    description: 'Set up recurring Apple Pay billing. Attaches the Apple Pay payment method and creates a Stripe subscription with optional trial period.',
    category: 'us_payment',
    inputSchema: z.object({
      customerId: z.string().min(1).describe('Stripe customer ID'),
      priceId: z.string().min(1).describe('Stripe Price ID for the subscription plan'),
      paymentMethodId: z.string().min(1).describe('Apple Pay payment method ID'),
      trialDays: z.number().int().min(0).max(365).optional().describe('Free trial period in days'),
      metadata: z.record(z.string(), z.string()).optional(),
    }),
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = z.object({
        customerId: z.string().min(1),
        priceId: z.string().min(1),
        paymentMethodId: z.string().min(1),
        trialDays: z.number().int().min(0).max(365).optional(),
        metadata: z.record(z.string(), z.string()).optional(),
      }).parse(input);

      ctx.logger.info(`[Janus] Apple Pay subscription for customer ${params.customerId}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        // Attach payment method to customer
        const attachBody = new URLSearchParams({ customer: params.customerId });
        const attachResult = await stripeRequest(`/payment_methods/${params.paymentMethodId}/attach`, attachBody);
        if (attachResult.error) {
          return { success: false, data: null, error: `Failed to attach payment method: ${JSON.stringify(attachResult.error)}` };
        }

        // Set as default payment method
        const updateBody = new URLSearchParams({
          'invoice_settings[default_payment_method]': params.paymentMethodId,
        });
        await stripeRequest(`/customers/${params.customerId}`, updateBody);

        // Create subscription
        const subBody = new URLSearchParams({
          customer: params.customerId,
          'items[0][price]': params.priceId,
          default_payment_method: params.paymentMethodId,
          'payment_settings[payment_method_types][0]': 'card',
          'metadata[source]': 'apple_pay',
          'metadata[agent]': 'janus',
        });

        if (params.trialDays) {
          const trialEnd = Math.floor(Date.now() / 1000) + (params.trialDays * 86400);
          subBody.append('trial_end', String(trialEnd));
        }

        if (params.metadata) {
          for (const [k, v] of Object.entries(params.metadata)) {
            subBody.append(`metadata[${k}]`, v);
          }
        }

        const subData = await stripeRequest('/subscriptions', subBody);

        if (subData.error) {
          return { success: false, data: null, error: `Subscription creation failed: ${JSON.stringify(subData.error)}` };
        }

        // Record
        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'procedural',
          namespace: 'subscriptions',
          content: JSON.stringify({
            subscriptionId: subData.id,
            customerId: params.customerId,
            priceId: params.priceId,
            status: subData.status,
            source: 'apple_pay',
          }),
          metadata: { subscriptionId: subData.id as string },
          importance: 0.8,
        });

        return {
          success: true,
          data: {
            subscriptionId: subData.id,
            status: subData.status,
            currentPeriodEnd: subData.current_period_end,
            trialEnd: subData.trial_end || null,
            paymentMethod: 'Apple Pay',
            message: params.trialDays
              ? `Apple Pay subscription active with ${params.trialDays}-day free trial`
              : 'Apple Pay subscription active — billing starts immediately',
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Apple Pay subscription failed: ${err}` };
      }
    },
  },

  // ─── 11. Apple Pay Express Checkout ─────────────────────────
  {
    name: 'apple_pay_express_checkout',
    description: 'One-tap express checkout combining product, shipping, and payment in a single API call. Creates customer if needed, processes payment, and returns order confirmation with receipt.',
    category: 'us_payment',
    inputSchema: z.object({
      amountCents: z.number().positive().int(),
      currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
      productName: z.string().min(1).describe('Product or service name'),
      customerEmail: z.string().email(),
      paymentMethodId: z.string().min(1).describe('Apple Pay payment method ID'),
      shippingAddress: z.object({
        line1: z.string(),
        line2: z.string().optional(),
        city: z.string(),
        state: z.string(),
        postal_code: z.string(),
        country: z.string().length(2),
      }).optional(),
      statementDescriptor: z.string().max(22).optional(),
    }),
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = z.object({
        amountCents: z.number().positive().int(),
        currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
        productName: z.string().min(1),
        customerEmail: z.string().email(),
        paymentMethodId: z.string().min(1),
        shippingAddress: z.object({
          line1: z.string(),
          line2: z.string().optional(),
          city: z.string(),
          state: z.string(),
          postal_code: z.string(),
          country: z.string().length(2),
        }).optional(),
        statementDescriptor: z.string().max(22).optional(),
      }).parse(input);

      ctx.logger.info(`[Janus] Apple Pay express checkout: ${params.productName} $${(params.amountCents / 100).toFixed(2)}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        // Create or find customer
        const custSearchBody = new URLSearchParams({ email: params.customerEmail, limit: '1' });
        const custSearch = await stripeRequest('/customers/search', new URLSearchParams({ query: `email:'${params.customerEmail}'` }), 'GET');
        const existingCustomers = (custSearch.data as Array<Record<string, unknown>>) || [];
        let customerId: string;

        if (existingCustomers.length > 0) {
          customerId = existingCustomers[0].id as string;
        } else {
          const newCust = await stripeRequest('/customers', new URLSearchParams({
            email: params.customerEmail,
            'metadata[source]': 'apple_pay_express',
          }));
          customerId = newCust.id as string;
        }

        // Build PaymentIntent
        const body = new URLSearchParams({
          amount: String(params.amountCents),
          currency: params.currency,
          customer: customerId,
          'payment_method': params.paymentMethodId,
          'payment_method_types[0]': 'card',
          confirm: 'true',
          description: `Express Checkout: ${params.productName}`,
          receipt_email: params.customerEmail,
          'metadata[source]': 'apple_pay_express',
          'metadata[product]': params.productName,
          'metadata[agent]': 'janus',
        });

        if (params.statementDescriptor) body.append('statement_descriptor', params.statementDescriptor);

        if (params.shippingAddress) {
          body.append('shipping[name]', params.customerEmail);
          body.append('shipping[address][line1]', params.shippingAddress.line1);
          if (params.shippingAddress.line2) body.append('shipping[address][line2]', params.shippingAddress.line2);
          body.append('shipping[address][city]', params.shippingAddress.city);
          body.append('shipping[address][state]', params.shippingAddress.state);
          body.append('shipping[address][postal_code]', params.shippingAddress.postal_code);
          body.append('shipping[address][country]', params.shippingAddress.country);
        }

        const data = await stripeRequest('/payment_intents', body);

        if (data.error) {
          return { success: false, data: null, error: `Express checkout failed: ${JSON.stringify(data.error)}` };
        }

        const charges = data.charges as Record<string, unknown> | undefined;
        const chargeList = (charges?.data as Array<Record<string, unknown>>) || [];
        const charge = chargeList[0];
        const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;

        // Record
        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'episodic',
          namespace: 'transactions',
          content: JSON.stringify({
            type: 'express_checkout',
            orderId,
            paymentIntentId: data.id,
            product: params.productName,
            amount: params.amountCents,
            currency: params.currency,
            customerId,
            status: data.status,
          }),
          metadata: { orderId, paymentIntentId: data.id as string, source: 'apple_pay_express' },
          importance: 0.9,
        });

        return {
          success: true,
          data: {
            orderId,
            paymentIntentId: data.id,
            paymentStatus: data.status,
            product: params.productName,
            amount: `$${(params.amountCents / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
            receiptUrl: charge?.receipt_url || null,
            customerId,
            paymentMethod: 'Apple Pay Express',
            estimatedDelivery: params.shippingAddress ? '3-7 business days' : 'Digital delivery — instant',
            message: `Order ${orderId} confirmed via Apple Pay Express Checkout`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Express checkout failed: ${err}` };
      }
    },
  },

  // ─── 12. Google Pay Complete Payment ────────────────────────
  {
    name: 'google_pay_complete_payment',
    description: 'Process a Google Pay payment end-to-end. Takes a tokenized payment method from Google Pay JS, creates and confirms a Stripe PaymentIntent, records the transaction, and returns a receipt. A 2.5% merchant payment fee applies.',
    category: 'us_payment',
    inputSchema: z.object({
      paymentMethodId: z.string().min(1).describe('Stripe payment method ID from Google Pay tokenization'),
      amountCents: z.number().positive().int(),
      currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
      description: z.string().min(1),
      customerEmail: z.string().email().optional(),
      customerId: z.string().optional(),
      merchantName: z.string().min(1).describe('Merchant display name'),
      statementDescriptor: z.string().max(22).optional(),
    }),
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = z.object({
        paymentMethodId: z.string().min(1),
        amountCents: z.number().positive().int(),
        currency: z.enum(['usd', 'eur', 'gbp', 'cad', 'aud']).optional().default('usd'),
        description: z.string().min(1),
        customerEmail: z.string().email().optional(),
        customerId: z.string().optional(),
        merchantName: z.string().min(1),
        statementDescriptor: z.string().max(22).optional(),
      }).parse(input);

      ctx.logger.info(`[Janus] Google Pay payment: $${(params.amountCents / 100).toFixed(2)} for ${params.merchantName}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        const body = new URLSearchParams({
          amount: String(params.amountCents),
          currency: params.currency,
          'payment_method': params.paymentMethodId,
          'payment_method_types[0]': 'card',
          confirm: 'true',
          description: params.description,
          'metadata[source]': 'google_pay',
          'metadata[merchant]': params.merchantName,
          'metadata[agent]': 'janus',
        });

        if (params.customerId) body.append('customer', params.customerId);
        if (params.customerEmail) body.append('receipt_email', params.customerEmail);
        if (params.statementDescriptor) body.append('statement_descriptor', params.statementDescriptor);

        const data = await stripeRequest('/payment_intents', body);

        if (data.error) {
          return { success: false, data: null, error: `Google Pay charge failed: ${JSON.stringify(data.error)}` };
        }

        const charges = data.charges as Record<string, unknown> | undefined;
        const chargeList = (charges?.data as Array<Record<string, unknown>>) || [];
        const charge = chargeList[0];
        const paymentMethodDetails = charge?.payment_method_details as Record<string, unknown> | undefined;
        const card = paymentMethodDetails?.card as Record<string, unknown> | undefined;

        // Record transaction
        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'episodic',
          namespace: 'transactions',
          content: JSON.stringify({
            type: 'google_pay_payment',
            paymentIntentId: data.id,
            amount: params.amountCents,
            currency: params.currency,
            status: data.status,
            last4: card?.last4 || 'unknown',
            brand: card?.brand || 'unknown',
          }),
          metadata: { paymentIntentId: data.id as string, source: 'google_pay' },
          importance: 0.8,
        });

        const feeCents = Math.round(params.amountCents * 0.025);
        const totalCents = params.amountCents + feeCents;

        return {
          success: true,
          data: {
            paymentIntentId: data.id,
            status: data.status,
            amount: `$${(params.amountCents / 100).toFixed(2)} ${params.currency.toUpperCase()}`,
            last4: card?.last4 || 'unknown',
            brand: card?.brand || 'unknown',
            receiptUrl: charge?.receipt_url || null,
            paymentMethod: 'Google Pay',
            merchantName: params.merchantName,
            fee: `$${(feeCents / 100).toFixed(2)} (2.5%)`,
            total: `$${(totalCents / 100).toFixed(2)}`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Google Pay payment failed: ${err}` };
      }
    },
  },

  // ─── 13. Wise Get Quote ──────────────────────────────────────
  {
    name: 'wise_get_quote',
    description: 'Get a real-time FX quote from Wise for cross-border transfers. Mid-market rate, no hidden markup. Supports 50+ currencies including NGN, KES, GHS, UGX, INR, EUR, GBP. Shows exact fee and delivery estimate.',
    category: 'cross_border',
    inputSchema: wiseQuoteSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = wiseQuoteSchema.parse(input);
      ctx.logger.info(`[Janus] Wise quote: ${params.sourceAmount} ${params.sourceCurrency} → ${params.targetCurrency}`);

      if (!CONFIG.wise.apiKey) {
        return { success: false, data: null, error: 'Wise not configured — set WISE_API_KEY and WISE_PROFILE_ID' };
      }

      try {
        const quote = await wiseRequest(`/v3/profiles/${CONFIG.wise.profileId}/quotes`, {
          sourceCurrency: params.sourceCurrency,
          targetCurrency: params.targetCurrency,
          sourceAmount: params.sourceAmount,
          payOut: 'BANK_TRANSFER',
          preferredPayIn: 'BALANCE',
        }, 'POST');

        if (quote.id) {
          const paymentOptions = quote.paymentOptions as Array<Record<string, unknown>> | undefined;
          const bankOption = paymentOptions?.find(o => o.payIn === 'BALANCE') || paymentOptions?.[0];
          const platformFee = Math.round(params.sourceAmount * 0.03 * 100) / 100;

          return {
            success: true,
            data: {
              quoteId: quote.id,
              sourceCurrency: params.sourceCurrency,
              targetCurrency: params.targetCurrency,
              sourceAmount: params.sourceAmount,
              targetAmount: quote.targetAmount || bankOption?.targetAmount,
              rate: quote.rate,
              wiseFee: (bankOption?.fee as Record<string, unknown>)?.total || quote.fee,
              platformFee: `${platformFee} (3% cross-border)`,
              totalCost: Math.round((params.sourceAmount + platformFee) * 100) / 100,
              estimatedDelivery: bankOption?.estimatedDelivery || quote.deliveryEstimate,
              expiresAt: quote.expirationTime,
              message: `${params.sourceAmount} ${params.sourceCurrency} = ${quote.targetAmount || '?'} ${params.targetCurrency} at rate ${quote.rate}. Wise fee: ${(bankOption?.fee as Record<string, unknown>)?.total || '?'}. Platform fee: ${platformFee}.`,
            },
          };
        }

        return { success: false, data: quote, error: `Wise quote failed: ${JSON.stringify(quote)}` };
      } catch (err) {
        return { success: false, data: null, error: `Wise quote failed: ${err}` };
      }
    },
  },

  // ─── 14. Wise Create Transfer ────────────────────────────────
  {
    name: 'wise_create_transfer',
    description: 'Execute a cross-border transfer via Wise. Real money movement at mid-market rates. Supports bank transfers to 50+ countries. 3% platform fee + Wise fee. Get a quote first with wise_get_quote.',
    category: 'cross_border',
    inputSchema: wiseTransferSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = wiseTransferSchema.parse(input);
      ctx.logger.info(`[Janus] Wise transfer: quote=${params.quoteId} to ${params.recipientName} in ${params.recipientCountry}`);

      if (!CONFIG.wise.apiKey) {
        return { success: false, data: null, error: 'Wise not configured' };
      }

      try {
        // Step 1: Create recipient
        const accountDetails: Record<string, unknown> = {
          accountNumber: params.recipientAccount,
        };
        if (params.recipientBankCode) accountDetails.bankCode = params.recipientBankCode;

        const recipient = await wiseRequest('/v1/accounts', {
          profile: CONFIG.wise.profileId,
          accountHolderName: params.recipientName,
          currency: params.recipientCurrency,
          type: 'sort_code',
          details: accountDetails,
        }, 'POST');

        if (!recipient.id) {
          return { success: false, data: recipient, error: `Failed to create recipient: ${JSON.stringify(recipient)}` };
        }

        // Step 2: Create transfer
        const transfer = await wiseRequest('/v1/transfers', {
          targetAccount: recipient.id,
          quoteUuid: params.quoteId,
          customerTransactionId: `UPP-${Date.now().toString(36).toUpperCase()}`,
          details: { reference: 'uPromptPay Transfer' },
        }, 'POST');

        if (!transfer.id) {
          return { success: false, data: transfer, error: `Failed to create transfer: ${JSON.stringify(transfer)}` };
        }

        // Step 3: Fund the transfer
        const funding = await wiseRequest(
          `/v3/profiles/${CONFIG.wise.profileId}/transfers/${transfer.id}/payments`,
          { type: 'BALANCE' },
          'POST'
        );

        const txId = `XBORDER-${Date.now().toString(36).toUpperCase()}`;
        await ctx.memory.store({
          agentId: ctx.agentId, type: 'episodic', namespace: 'cross_border',
          content: JSON.stringify({
            txId, provider: 'wise', externalId: transfer.id,
            sourceAmount: transfer.sourceAmount, sourceCurrency: transfer.sourceCurrency,
            targetAmount: transfer.targetAmount, targetCurrency: transfer.targetCurrency,
            recipientName: params.recipientName, rate: transfer.rate,
            status: transfer.status || 'processing',
          }),
          importance: 0.9, metadata: { provider: 'wise', country: params.recipientCountry },
        });

        return {
          success: true,
          data: {
            transactionId: txId,
            wiseTransferId: transfer.id,
            sourceAmount: transfer.sourceAmount,
            sourceCurrency: transfer.sourceCurrency,
            targetAmount: transfer.targetAmount,
            targetCurrency: transfer.targetCurrency,
            rate: transfer.rate,
            recipientName: params.recipientName,
            status: transfer.status || 'processing',
            fundingStatus: funding.status || 'completed',
            estimatedDelivery: transfer.estimatedDeliveryDate,
            message: `Cross-border transfer initiated: ${transfer.sourceAmount} ${transfer.sourceCurrency} → ${transfer.targetAmount} ${transfer.targetCurrency} to ${params.recipientName}`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Wise transfer failed: ${err}` };
      }
    },
  },

  // ─── 15. USDC Send ──────────────────────────────────────────
  {
    name: 'usdc_send',
    description: 'Send USDC (stablecoin) instantly to anyone worldwide. Near-zero cost, 24/7 settlement, no bank needed. 1% platform fee (vs 3% traditional cross-border). Supports Solana, Ethereum, Avalanche, Polygon chains.',
    category: 'cross_border',
    inputSchema: usdcSendSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = usdcSendSchema.parse(input);
      ctx.logger.info(`[Janus] USDC send: ${params.amount} to ${params.recipientAddress} on ${params.chain}`);

      if (!CONFIG.circle.apiKey) {
        return { success: false, data: null, error: 'Circle USDC not configured — set CIRCLE_API_KEY' };
      }

      try {
        const fee = Math.round(params.amount * 0.01 * 100) / 100;
        const total = Math.round((params.amount + fee) * 100) / 100;

        const idempotencyKey = `upp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

        const result = await circleRequest('/v1/transfers', {
          idempotencyKey,
          source: { type: 'wallet', id: 'platform' },
          destination: { type: 'blockchain', address: params.recipientAddress, chain: params.chain },
          amount: { amount: String(params.amount), currency: 'USD' },
        });

        const txId = `USDC-${Date.now().toString(36).toUpperCase()}`;
        await ctx.memory.store({
          agentId: ctx.agentId, type: 'episodic', namespace: 'cross_border',
          content: JSON.stringify({
            txId, provider: 'circle_usdc', externalId: (result.data as Record<string, unknown>)?.id || result.id,
            amount: params.amount, chain: params.chain, recipientAddress: params.recipientAddress,
            fee, status: 'processing',
          }),
          importance: 0.9, metadata: { provider: 'circle_usdc', chain: params.chain },
        });

        return {
          success: true,
          data: {
            transactionId: txId,
            circleTransferId: (result.data as Record<string, unknown>)?.id || result.id,
            amount: params.amount,
            fee: `${fee} (1%)`,
            total,
            currency: 'USDC',
            chain: params.chain,
            recipientAddress: params.recipientAddress,
            status: 'processing',
            message: `Sending ${params.amount} USDC on ${params.chain}. Fee: ${fee} (1%). Arrives in seconds, not days.`,
            advantage: 'Traditional cross-border: 3-5 days, 3-5% fee. USDC: seconds, 1% fee.',
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `USDC send failed: ${err}` };
      }
    },
  },

  // ─── 16. USDC Receive ───────────────────────────────────────
  {
    name: 'usdc_receive',
    description: 'Generate a USDC deposit address to receive stablecoin payments from anywhere. Instant settlement, zero receive fee.',
    category: 'cross_border',
    inputSchema: usdcReceiveSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = usdcReceiveSchema.parse(input);
      ctx.logger.info(`[Janus] USDC receive: ${params.amount || 'any'} on ${params.chain}`);

      if (!CONFIG.circle.apiKey) {
        return { success: false, data: null, error: 'Circle USDC not configured — set CIRCLE_API_KEY' };
      }

      try {
        const result = await circleRequest('/v1/wallets/addresses', {
          currency: 'USD',
          chain: params.chain,
          idempotencyKey: `recv-${ctx.agentId}-${params.chain}`,
        });

        const addressData = (result.data as Record<string, unknown>) || result;

        return {
          success: true,
          data: {
            depositAddress: addressData.address || 'pending_generation',
            chain: params.chain,
            currency: 'USDC',
            expectedAmount: params.amount || 'any amount',
            receiveFee: 'Free',
            status: 'ready',
            instructions: `Send USDC on ${params.chain} to the address above. Funds arrive in seconds and auto-convert to wallet balance.`,
            supportedChains: ['SOL (fastest, cheapest)', 'ETH (most common)', 'AVAX', 'MATIC'],
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `USDC receive setup failed: ${err}` };
      }
    },
  },
];
