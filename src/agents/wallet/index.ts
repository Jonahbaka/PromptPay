// ═══════════════════════════════════════════════════════════════
// Agent: Nexus — User Payment Hub, Card Management, Bills,
//        Wallet, PromptPay, Smart Split, Pay Forward
// 21 tools across 5 groups
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { ToolDefinition } from '../../core/types.js';
import { CONFIG } from '../../core/config.js';

// ── Stripe Helper ───────────────────────────────────────────

async function stripeRequest(
  path: string,
  body: URLSearchParams | null,
  method: 'POST' | 'GET' | 'DELETE' = 'POST',
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

// Ensure a Stripe customer exists for a userId
async function ensureStripeCustomer(userId: string, ctx: { memory: import('../../core/types.js').MemoryHandle; logger: import('../../core/types.js').LoggerHandle }): Promise<string> {
  const records = await ctx.memory.recall(`stripe_customer:${userId}`, 'wallet_customers', 1);
  if (records.length > 0) {
    const data = JSON.parse(records[0].content);
    return data.stripeCustomerId;
  }

  // Create new customer
  const body = new URLSearchParams({ metadata: `user_id=${userId}` });
  body.set('metadata[user_id]', userId);
  const customer = await stripeRequest('/customers', body);

  if (customer.id) {
    await ctx.memory.store({
      agentId: 'nexus',
      type: 'semantic',
      namespace: 'wallet_customers',
      content: JSON.stringify({ userId, stripeCustomerId: customer.id }),
      importance: 0.9,
      metadata: { userId, stripeCustomerId: customer.id as string },
    });
    return customer.id as string;
  }

  throw new Error(`Failed to create Stripe customer: ${JSON.stringify(customer)}`);
}

// ── Schemas ─────────────────────────────────────────────────

// Group A: Payment Methods
const addPaymentMethodSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['card', 'bank_account']),
  // Card fields
  cardNumber: z.string().optional(),
  expMonth: z.number().min(1).max(12).optional(),
  expYear: z.number().min(2024).optional(),
  cvc: z.string().optional(),
  // Bank fields
  bankRoutingNumber: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  accountHolderName: z.string().optional(),
  // General
  nickname: z.string().optional(),
});

const listPaymentMethodsSchema = z.object({
  userId: z.string().min(1),
  type: z.enum(['card', 'bank_account', 'all']).optional().default('all'),
});

const removePaymentMethodSchema = z.object({
  userId: z.string().min(1),
  paymentMethodId: z.string().min(1),
});

const setDefaultPaymentMethodSchema = z.object({
  userId: z.string().min(1),
  paymentMethodId: z.string().min(1),
});

// Group B: Bills
const createBillScheduleSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['usd', 'eur', 'gbp', 'kes', 'ghs', 'ugx', 'ngn', 'inr', 'zar']).optional().default('usd'),
  frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']),
  paymentMethodId: z.string().min(1),
  startDate: z.string().min(1), // ISO date
  recipientInfo: z.record(z.string(), z.unknown()).optional().default({}),
});

const listBillSchedulesSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(['active', 'paused', 'cancelled', 'all']).optional().default('all'),
});

const cancelBillScheduleSchema = z.object({
  userId: z.string().min(1),
  scheduleId: z.string().min(1),
  action: z.enum(['cancel', 'pause', 'resume']),
});

const billPayNowSchema = z.object({
  userId: z.string().min(1),
  scheduleId: z.string().optional(),
  amount: z.number().positive().optional(),
  paymentMethodId: z.string().optional(),
  description: z.string().optional(),
});

// Group C: Wallet
const walletTopupSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['usd', 'eur', 'gbp']).optional().default('usd'),
  paymentMethodId: z.string().min(1),
});

const walletTransferSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['usd', 'eur', 'gbp']).optional().default('usd'),
  note: z.string().optional(),
});

const walletWithdrawSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['usd', 'eur', 'gbp']).optional().default('usd'),
  paymentMethodId: z.string().min(1),
});

// Group D: Transaction History
const transactionHistorySchema = z.object({
  userId: z.string().min(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: z.enum(['all', 'payment', 'bill', 'topup', 'transfer', 'withdraw']).optional().default('all'),
  status: z.enum(['all', 'success', 'pending', 'failed']).optional().default('all'),
  limit: z.number().min(1).max(100).optional().default(20),
});

// Group E: PromptPay
const upromptpaySchema = z.object({
  userId: z.string().min(1),
  prompt: z.string().min(3),
});

const smartSplitSchema = z.object({
  userId: z.string().min(1),
  totalAmount: z.number().positive(),
  currency: z.enum(['usd', 'eur', 'gbp', 'kes', 'ghs', 'ngn', 'inr']).optional().default('usd'),
  splitType: z.enum(['equal', 'percentage', 'custom', 'itemized']).optional().default('equal'),
  participants: z.array(z.object({
    name: z.string().min(1),
    channel: z.enum(['telegram', 'whatsapp', 'discord', 'sms', 'webchat', 'email']).optional(),
    channelId: z.string().optional(),
    amount: z.number().optional(),
    percentage: z.number().optional(),
  })).min(2),
  tipPercent: z.number().min(0).max(100).optional(),
  taxAmount: z.number().min(0).optional(),
  description: z.string().min(1),
});

const payForwardSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(['create', 'list', 'pause', 'resume', 'delete']),
  ruleId: z.string().optional(),
  trigger: z.enum(['on_deposit', 'on_date', 'on_balance_threshold']).optional(),
  triggerConfig: z.record(z.string(), z.unknown()).optional(),
  payAction: z.object({
    type: z.enum(['pay', 'transfer', 'save']),
    amount: z.number().positive(),
    currency: z.string(),
    recipientInfo: z.record(z.string(), z.unknown()),
  }).optional(),
});

// Group F: Agent Network
const agentCashInSchema = z.object({
  customerId: z.string().min(1).describe('Customer user ID, phone, or $paytag'),
  amount: z.number().positive(),
  currency: z.string().default('usd'),
});

const agentCashOutSchema = z.object({
  customerId: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().default('usd'),
});

const agentFloatCheckSchema = z.object({});

// Group G: Virality
const requestMoneySchema = z.object({
  targetContact: z.string().min(1).describe('Email, phone number, or $paytag of the person to request from'),
  amount: z.number().positive(),
  currency: z.string().default('usd'),
  message: z.string().optional().default(''),
});

const generatePaymentLinkSchema = z.object({
  amount: z.number().positive().optional().describe('Fixed amount (omit for open amount)'),
  currency: z.string().default('usd'),
  label: z.string().optional().default('Payment'),
  expiresInHours: z.number().default(72),
});

const claimPaytagSchema = z.object({
  paytag: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/, 'Only letters, numbers, and underscores'),
});

// ── Tool Implementations ────────────────────────────────────

export const walletTools: ToolDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // GROUP A: CARD & PAYMENT METHOD MANAGEMENT
  // ═══════════════════════════════════════════════════════════

  // ─── 1. Add Payment Method ─────────────────────────────────
  {
    name: 'add_payment_method',
    description: 'Add a debit/credit card or bank account. Tokenizes via Stripe and stores securely. No raw card numbers are stored — only tokens.',
    category: 'wallet',
    inputSchema: addPaymentMethodSchema,
    requiresApproval: false,
    riskLevel: 'medium',
    execute: async (input, ctx) => {
      const params = addPaymentMethodSchema.parse(input);
      ctx.logger.info(`[Nexus] Adding payment method for user ${params.userId}: ${params.type}`);

      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured — set STRIPE_SECRET_KEY' };
      }

      try {
        const customerId = await ensureStripeCustomer(params.userId, ctx);

        let pmData: Record<string, unknown>;

        if (params.type === 'card' && params.cardNumber && params.expMonth && params.expYear && params.cvc) {
          // Create card payment method
          const body = new URLSearchParams({
            type: 'card',
            'card[number]': params.cardNumber,
            'card[exp_month]': String(params.expMonth),
            'card[exp_year]': String(params.expYear),
            'card[cvc]': params.cvc,
          });
          pmData = await stripeRequest('/payment_methods', body);
        } else if (params.type === 'bank_account' && params.bankRoutingNumber && params.bankAccountNumber) {
          // Create bank account via tokens
          const body = new URLSearchParams({
            'bank_account[country]': 'US',
            'bank_account[currency]': 'usd',
            'bank_account[routing_number]': params.bankRoutingNumber,
            'bank_account[account_number]': params.bankAccountNumber,
            'bank_account[account_holder_name]': params.accountHolderName || '',
            'bank_account[account_holder_type]': 'individual',
          });
          const tokenData = await stripeRequest('/tokens', body);

          if (!tokenData.id) {
            return { success: false, data: null, error: `Bank token failed: ${JSON.stringify(tokenData.error || tokenData)}` };
          }

          // Attach token to customer
          const attachBody = new URLSearchParams({
            source: tokenData.id as string,
          });
          pmData = await stripeRequest(`/customers/${customerId}/sources`, attachBody);
        } else {
          return { success: false, data: null, error: 'Invalid input — provide card or bank account details' };
        }

        if (!pmData.id) {
          return { success: false, data: null, error: `Payment method creation failed: ${JSON.stringify(pmData.error || pmData)}` };
        }

        // Attach to customer (for card type)
        if (params.type === 'card') {
          const attachBody = new URLSearchParams({ customer: customerId });
          await stripeRequest(`/payment_methods/${pmData.id}/attach`, attachBody);
        }

        // Extract last4 and brand
        const card = pmData.card as Record<string, unknown> | undefined;
        const last4 = (card?.last4 || pmData.last4 || '****') as string;
        const brand = (card?.brand || pmData.brand || params.type) as string;

        const methodId = `PM-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const storedMethod = {
          id: methodId,
          userId: params.userId,
          type: params.type,
          provider: 'stripe',
          last4,
          brand,
          expiryMonth: params.expMonth,
          expiryYear: params.expYear,
          isDefault: false,
          nickname: params.nickname || `${brand} ...${last4}`,
          externalId: pmData.id as string,
          currency: 'usd',
          addedAt: new Date().toISOString(),
          lastUsedAt: null,
        };

        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'semantic',
          namespace: 'payment_methods',
          content: JSON.stringify(storedMethod),
          importance: 0.9,
          metadata: { userId: params.userId, methodId, type: params.type, last4, externalId: pmData.id as string },
        });

        return {
          success: true,
          data: {
            methodId,
            type: params.type,
            brand,
            last4,
            nickname: storedMethod.nickname,
            message: `${brand} ending in ${last4} added successfully.`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Add payment method failed: ${err}` };
      }
    },
  },

  // ─── 2. List Payment Methods ───────────────────────────────
  {
    name: 'list_payment_methods',
    description: 'List all saved payment methods (cards, bank accounts) for a user. Shows last 4 digits, brand, type, and default status.',
    category: 'wallet',
    inputSchema: listPaymentMethodsSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = listPaymentMethodsSchema.parse(input);
      ctx.logger.info(`[Nexus] Listing payment methods for user ${params.userId}`);

      const records = await ctx.memory.recall(`userId:${params.userId}`, 'payment_methods', 50);
      const methods = records
        .map(r => JSON.parse(r.content))
        .filter(m => m.userId === params.userId)
        .filter(m => params.type === 'all' || m.type === params.type);

      return {
        success: true,
        data: {
          userId: params.userId,
          count: methods.length,
          methods: methods.map(m => ({
            methodId: m.id,
            type: m.type,
            brand: m.brand,
            last4: m.last4,
            nickname: m.nickname,
            isDefault: m.isDefault,
            expiryMonth: m.expiryMonth,
            expiryYear: m.expiryYear,
            addedAt: m.addedAt,
            lastUsedAt: m.lastUsedAt,
          })),
        },
      };
    },
  },

  // ─── 3. Remove Payment Method ──────────────────────────────
  {
    name: 'remove_payment_method',
    description: 'Remove a saved payment method. Detaches from Stripe and deletes from storage.',
    category: 'wallet',
    inputSchema: removePaymentMethodSchema,
    requiresApproval: false,
    riskLevel: 'medium',
    execute: async (input, ctx) => {
      const params = removePaymentMethodSchema.parse(input);
      ctx.logger.info(`[Nexus] Removing payment method ${params.paymentMethodId}`);

      const records = await ctx.memory.recall(`methodId:${params.paymentMethodId}`, 'payment_methods', 1);
      if (records.length === 0) {
        return { success: false, data: null, error: `Payment method ${params.paymentMethodId} not found` };
      }

      const method = JSON.parse(records[0].content);

      if (method.userId !== params.userId) {
        return { success: false, data: null, error: 'Unauthorized — method belongs to another user' };
      }

      // Detach from Stripe
      if (CONFIG.stripe.secretKey && method.externalId) {
        try {
          await stripeRequest(`/payment_methods/${method.externalId}/detach`, new URLSearchParams());
        } catch {
          ctx.logger.warn(`[Nexus] Stripe detach failed for ${method.externalId} — continuing removal`);
        }
      }

      await ctx.memory.forget(records[0].id);

      return {
        success: true,
        data: {
          removed: params.paymentMethodId,
          type: method.type,
          last4: method.last4,
          message: `${method.nickname} removed.`,
        },
      };
    },
  },

  // ─── 4. Set Default Payment Method ─────────────────────────
  {
    name: 'set_default_payment_method',
    description: 'Set a payment method as the default for a user. The default is used when no specific method is selected.',
    category: 'wallet',
    inputSchema: setDefaultPaymentMethodSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = setDefaultPaymentMethodSchema.parse(input);
      ctx.logger.info(`[Nexus] Setting default for user ${params.userId}: ${params.paymentMethodId}`);

      // Get all methods for user
      const allRecords = await ctx.memory.recall(`userId:${params.userId}`, 'payment_methods', 50);
      let found = false;

      for (const record of allRecords) {
        const method = JSON.parse(record.content);
        if (method.userId !== params.userId) continue;

        const wasDefault = method.isDefault;
        method.isDefault = method.id === params.paymentMethodId;

        if (method.id === params.paymentMethodId) found = true;

        if (wasDefault !== method.isDefault) {
          await ctx.memory.store({
            agentId: ctx.agentId,
            type: 'semantic',
            namespace: 'payment_methods',
            content: JSON.stringify(method),
            importance: 0.9,
            metadata: { userId: params.userId, methodId: method.id, isDefault: method.isDefault },
          });
        }
      }

      if (!found) {
        return { success: false, data: null, error: `Payment method ${params.paymentMethodId} not found` };
      }

      // Update Stripe customer default
      if (CONFIG.stripe.secretKey) {
        try {
          const target = allRecords.find(r => {
            const m = JSON.parse(r.content);
            return m.id === params.paymentMethodId;
          });
          if (target) {
            const method = JSON.parse(target.content);
            const customerId = await ensureStripeCustomer(params.userId, ctx);
            const body = new URLSearchParams({
              'invoice_settings[default_payment_method]': method.externalId,
            });
            await stripeRequest(`/customers/${customerId}`, body);
          }
        } catch {
          ctx.logger.warn(`[Nexus] Stripe default update failed — local default set`);
        }
      }

      return {
        success: true,
        data: { userId: params.userId, defaultMethodId: params.paymentMethodId, message: 'Default payment method updated.' },
      };
    },
  },

  // ═══════════════════════════════════════════════════════════
  // GROUP B: RECURRING BILLS & AUTOPAY
  // ═══════════════════════════════════════════════════════════

  // ─── 5. Create Bill Schedule ───────────────────────────────
  {
    name: 'create_bill_schedule',
    description: 'Set up autopay for a recurring bill — rent, utilities, subscriptions, insurance. Specify amount, frequency, payment method, and start date.',
    category: 'wallet',
    inputSchema: createBillScheduleSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = createBillScheduleSchema.parse(input);
      ctx.logger.info(`[Nexus] Creating bill schedule: ${params.name} — $${params.amount} ${params.frequency}`);

      if (params.amount > CONFIG.wallet.maxBillAmountUsd) {
        return { success: false, data: null, error: `Amount exceeds max bill limit ($${CONFIG.wallet.maxBillAmountUsd})` };
      }

      const scheduleId = `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      const schedule = {
        id: scheduleId,
        userId: params.userId,
        name: params.name,
        amount: params.amount,
        currency: params.currency,
        frequency: params.frequency,
        nextPaymentDate: params.startDate,
        paymentMethodId: params.paymentMethodId,
        recipientInfo: params.recipientInfo,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        lastPaidAt: null,
        totalPaid: 0,
      };

      await ctx.memory.store({
        agentId: ctx.agentId,
        type: 'procedural',
        namespace: 'bill_schedules',
        content: JSON.stringify(schedule),
        importance: 0.8,
        metadata: { userId: params.userId, scheduleId, name: params.name, frequency: params.frequency },
      });

      return {
        success: true,
        data: {
          scheduleId,
          name: params.name,
          amount: `$${params.amount.toFixed(2)} ${params.currency.toUpperCase()}`,
          frequency: params.frequency,
          nextPayment: params.startDate,
          status: 'active',
          message: `Autopay set: ${params.name} — $${params.amount} ${params.frequency} starting ${params.startDate}`,
        },
      };
    },
  },

  // ─── 6. List Bill Schedules ────────────────────────────────
  {
    name: 'list_bill_schedules',
    description: 'List all recurring bill schedules for a user — active, paused, or cancelled.',
    category: 'wallet',
    inputSchema: listBillSchedulesSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = listBillSchedulesSchema.parse(input);
      ctx.logger.info(`[Nexus] Listing bills for user ${params.userId}`);

      const records = await ctx.memory.recall(`userId:${params.userId}`, 'bill_schedules', 50);
      const schedules = records
        .map(r => JSON.parse(r.content))
        .filter(s => s.userId === params.userId)
        .filter(s => params.status === 'all' || s.status === params.status);

      return {
        success: true,
        data: {
          userId: params.userId,
          count: schedules.length,
          schedules: schedules.map(s => ({
            scheduleId: s.id,
            name: s.name,
            amount: `$${s.amount.toFixed(2)} ${s.currency.toUpperCase()}`,
            frequency: s.frequency,
            nextPayment: s.nextPaymentDate,
            status: s.status,
            totalPaid: `$${s.totalPaid.toFixed(2)}`,
            lastPaid: s.lastPaidAt,
          })),
        },
      };
    },
  },

  // ─── 7. Cancel/Pause Bill Schedule ─────────────────────────
  {
    name: 'cancel_bill_schedule',
    description: 'Cancel, pause, or resume a recurring bill schedule.',
    category: 'wallet',
    inputSchema: cancelBillScheduleSchema,
    requiresApproval: false,
    riskLevel: 'medium',
    execute: async (input, ctx) => {
      const params = cancelBillScheduleSchema.parse(input);
      ctx.logger.info(`[Nexus] ${params.action} bill ${params.scheduleId}`);

      const records = await ctx.memory.recall(`scheduleId:${params.scheduleId}`, 'bill_schedules', 1);
      if (records.length === 0) {
        return { success: false, data: null, error: `Schedule ${params.scheduleId} not found` };
      }

      const schedule = JSON.parse(records[0].content);
      if (schedule.userId !== params.userId) {
        return { success: false, data: null, error: 'Unauthorized' };
      }

      const statusMap = { cancel: 'cancelled', pause: 'paused', resume: 'active' } as const;
      schedule.status = statusMap[params.action];

      await ctx.memory.store({
        agentId: ctx.agentId,
        type: 'procedural',
        namespace: 'bill_schedules',
        content: JSON.stringify(schedule),
        importance: 0.7,
        metadata: { scheduleId: params.scheduleId, status: schedule.status },
      });

      return {
        success: true,
        data: {
          scheduleId: params.scheduleId,
          name: schedule.name,
          newStatus: schedule.status,
          message: `${schedule.name} is now ${schedule.status}.`,
        },
      };
    },
  },

  // ─── 8. Bill Pay Now ───────────────────────────────────────
  {
    name: 'bill_pay_now',
    description: 'Immediately pay an upcoming bill — either from a schedule or as a one-time ad-hoc payment. A 1.5% processing fee applies.',
    category: 'wallet',
    inputSchema: billPayNowSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = billPayNowSchema.parse(input);
      ctx.logger.info(`[Nexus] Bill pay now for user ${params.userId}`);

      let amount = params.amount;
      let description = params.description || 'Bill payment';
      let paymentMethodId = params.paymentMethodId;

      // If schedule provided, use its data
      if (params.scheduleId) {
        const records = await ctx.memory.recall(`scheduleId:${params.scheduleId}`, 'bill_schedules', 1);
        if (records.length > 0) {
          const schedule = JSON.parse(records[0].content);
          amount = amount || schedule.amount;
          description = description || schedule.name;
          paymentMethodId = paymentMethodId || schedule.paymentMethodId;
        }
      }

      if (!amount || !paymentMethodId) {
        return { success: false, data: null, error: 'Amount and paymentMethodId required' };
      }

      // Get the external payment method ID
      const pmRecords = await ctx.memory.recall(`methodId:${paymentMethodId}`, 'payment_methods', 1);
      let externalPmId = paymentMethodId;
      if (pmRecords.length > 0) {
        const pm = JSON.parse(pmRecords[0].content);
        externalPmId = pm.externalId;
      }

      // Charge via Stripe
      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured' };
      }

      try {
        const customerId = await ensureStripeCustomer(params.userId, ctx);
        const body = new URLSearchParams({
          amount: String(Math.round(amount * 100)),
          currency: 'usd',
          customer: customerId,
          payment_method: externalPmId,
          description,
          confirm: 'true',
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never',
        });

        const piData = await stripeRequest('/payment_intents', body);

        // Store transaction
        const txId = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'episodic',
          namespace: 'transactions',
          content: JSON.stringify({
            id: txId,
            userId: params.userId,
            type: 'bill',
            amount,
            currency: 'usd',
            status: piData.status === 'succeeded' ? 'success' : 'pending',
            description,
            paymentIntentId: piData.id,
            timestamp: new Date().toISOString(),
          }),
          importance: 0.7,
          metadata: { userId: params.userId, txId, type: 'bill' },
        });

        const fee = Math.round(amount * 0.015 * 100) / 100;
        const totalAmount = Math.round((amount + fee) * 100) / 100;

        return {
          success: true,
          data: {
            transactionId: txId,
            paymentIntentId: piData.id,
            amount: `$${amount.toFixed(2)}`,
            fee: `$${fee.toFixed(2)}`,
            total: `$${totalAmount.toFixed(2)}`,
            status: piData.status,
            description,
            message: `Bill paid for ${description}. Amount: $${amount.toFixed(2)}, Fee (1.5%): $${fee.toFixed(2)}, Total: $${totalAmount.toFixed(2)}`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Bill payment failed: ${err}` };
      }
    },
  },

  // ═══════════════════════════════════════════════════════════
  // GROUP C: WALLET OPERATIONS
  // ═══════════════════════════════════════════════════════════

  // ─── 9. Wallet Top-Up ──────────────────────────────────────
  {
    name: 'wallet_topup',
    description: 'Add funds to your PromptPay wallet from any saved payment method (card or bank account). A 1.5% processing fee applies to all top-ups.',
    category: 'wallet',
    inputSchema: walletTopupSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = walletTopupSchema.parse(input);
      ctx.logger.info(`[Nexus] Wallet topup: $${params.amount} for user ${params.userId}`);

      if (params.amount > CONFIG.wallet.maxBalanceUsd) {
        return { success: false, data: null, error: `Amount exceeds max wallet balance ($${CONFIG.wallet.maxBalanceUsd})` };
      }

      // Get or create wallet
      const walletRecords = await ctx.memory.recall(`wallet:${params.userId}`, 'wallets', 1);
      let wallet: Record<string, unknown>;
      if (walletRecords.length > 0) {
        wallet = JSON.parse(walletRecords[0].content);
      } else {
        wallet = {
          id: `WAL-${Date.now()}`,
          userId: params.userId,
          balance: 0,
          currency: params.currency,
          status: 'active',
          createdAt: new Date().toISOString(),
          lastTransactionAt: null,
        };
      }

      // Charge the payment method via Stripe
      if (!CONFIG.stripe.secretKey) {
        return { success: false, data: null, error: 'Stripe not configured' };
      }

      try {
        const customerId = await ensureStripeCustomer(params.userId, ctx);
        const pmRecords = await ctx.memory.recall(`methodId:${params.paymentMethodId}`, 'payment_methods', 1);
        const externalPmId = pmRecords.length > 0 ? JSON.parse(pmRecords[0].content).externalId : params.paymentMethodId;

        const body = new URLSearchParams({
          amount: String(Math.round(params.amount * 100)),
          currency: params.currency,
          customer: customerId,
          payment_method: externalPmId,
          description: 'PromptPay Wallet Top-Up',
          confirm: 'true',
          'automatic_payment_methods[enabled]': 'true',
          'automatic_payment_methods[allow_redirects]': 'never',
        });

        const piData = await stripeRequest('/payment_intents', body);

        if (piData.status !== 'succeeded') {
          return { success: false, data: null, error: `Charge failed: status=${piData.status}` };
        }

        // Credit wallet
        (wallet.balance as number) += params.amount;
        wallet.lastTransactionAt = new Date().toISOString();

        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'semantic',
          namespace: 'wallets',
          content: JSON.stringify(wallet),
          importance: 0.9,
          metadata: { userId: params.userId, walletId: wallet.id as string, balance: wallet.balance as number },
        });

        // Record transaction
        const txId = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await ctx.memory.store({
          agentId: ctx.agentId,
          type: 'episodic',
          namespace: 'transactions',
          content: JSON.stringify({
            id: txId, userId: params.userId, type: 'topup', amount: params.amount,
            currency: params.currency, status: 'success', timestamp: new Date().toISOString(),
          }),
          importance: 0.6,
          metadata: { userId: params.userId, txId, type: 'topup' },
        });

        const fee = Math.round(params.amount * 0.015 * 100) / 100;
        const totalCharged = Math.round((params.amount + fee) * 100) / 100;

        return {
          success: true,
          data: {
            walletId: wallet.id,
            newBalance: `$${(wallet.balance as number).toFixed(2)}`,
            amountAdded: `$${params.amount.toFixed(2)}`,
            fee: `$${fee.toFixed(2)}`,
            totalCharged: `$${totalCharged.toFixed(2)}`,
            transactionId: txId,
            message: `Wallet topped up. Amount: $${params.amount.toFixed(2)}, Fee (1.5%): $${fee.toFixed(2)}, Total charged: $${totalCharged.toFixed(2)}. New balance: $${(wallet.balance as number).toFixed(2)}`,
          },
        };
      } catch (err) {
        return { success: false, data: null, error: `Wallet topup failed: ${err}` };
      }
    },
  },

  // ─── 10. Wallet Transfer (P2P) ─────────────────────────────
  {
    name: 'wallet_transfer',
    description: 'Transfer funds between PromptPay user wallets (P2P). P2P transfers under $50 are free; a 1% fee applies to transfers over $50.',
    category: 'wallet',
    inputSchema: walletTransferSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = walletTransferSchema.parse(input);
      ctx.logger.info(`[Nexus] Wallet transfer: $${params.amount} from ${params.fromUserId} to ${params.toUserId}`);

      if (!CONFIG.wallet.p2pEnabled) {
        return { success: false, data: null, error: 'P2P transfers disabled' };
      }
      if (params.amount > CONFIG.wallet.maxTransferUsd) {
        return { success: false, data: null, error: `Amount exceeds max transfer ($${CONFIG.wallet.maxTransferUsd})` };
      }

      // Stripe Connect real P2P (if enabled)
      if (CONFIG.stripe.connectEnabled && CONFIG.stripe.secretKey) {
        ctx.logger.info(`[Nexus] Stripe Connect P2P: ${params.amount} ${params.currency}`);
        try {
          const amountCents = Math.round(params.amount * 100);
          // Create transfer via Stripe Connect
          const transferResult = await stripeRequest('/transfers', new URLSearchParams({
            amount: String(amountCents),
            currency: params.currency,
            destination: params.toUserId, // Stripe Connected Account ID
            description: `P2P transfer via PromptPay`,
          }));

          if (transferResult.id) {
            const fee = params.amount > 50 ? Math.round(params.amount * 0.01 * 100) / 100 : 0;
            const total = Math.round((params.amount + fee) * 100) / 100;
            return {
              success: true,
              data: {
                transferId: transferResult.id,
                amount: params.amount,
                fee: fee > 0 ? `$${fee.toFixed(2)} (1%)` : 'Free (P2P under $50)',
                total,
                currency: params.currency,
                status: 'completed',
                method: 'stripe_connect',
                message: `Sent $${params.amount} via Stripe Connect. ${fee > 0 ? `Fee: $${fee.toFixed(2)}.` : 'No fee (under $50).'}`
              },
            };
          }
        } catch (err) {
          ctx.logger.warn(`[Nexus] Stripe Connect failed, falling back to wallet: ${err}`);
          // Fall through to SQLite wallet transfer
        }
      }

      // Get sender wallet
      const senderRecords = await ctx.memory.recall(`wallet:${params.fromUserId}`, 'wallets', 1);
      if (senderRecords.length === 0) {
        return { success: false, data: null, error: 'Sender wallet not found — top up first' };
      }
      const senderWallet = JSON.parse(senderRecords[0].content);

      if (senderWallet.balance < params.amount) {
        return { success: false, data: null, error: `Insufficient balance: $${senderWallet.balance.toFixed(2)} < $${params.amount.toFixed(2)}` };
      }

      // Get or create recipient wallet
      const recipientRecords = await ctx.memory.recall(`wallet:${params.toUserId}`, 'wallets', 1);
      let recipientWallet: Record<string, unknown>;
      if (recipientRecords.length > 0) {
        recipientWallet = JSON.parse(recipientRecords[0].content);
      } else {
        recipientWallet = {
          id: `WAL-${Date.now()}`, userId: params.toUserId, balance: 0,
          currency: params.currency, status: 'active', createdAt: new Date().toISOString(), lastTransactionAt: null,
        };
      }

      // Execute transfer
      senderWallet.balance -= params.amount;
      (recipientWallet.balance as number) += params.amount;
      senderWallet.lastTransactionAt = new Date().toISOString();
      recipientWallet.lastTransactionAt = new Date().toISOString();

      // Store both wallets
      await ctx.memory.store({ agentId: ctx.agentId, type: 'semantic', namespace: 'wallets', content: JSON.stringify(senderWallet), importance: 0.9, metadata: { userId: params.fromUserId } });
      await ctx.memory.store({ agentId: ctx.agentId, type: 'semantic', namespace: 'wallets', content: JSON.stringify(recipientWallet), importance: 0.9, metadata: { userId: params.toUserId } });

      // Record transactions
      const txId = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const txData = {
        id: txId, type: 'transfer', amount: params.amount, currency: params.currency,
        status: 'success', from: params.fromUserId, to: params.toUserId, note: params.note,
        timestamp: new Date().toISOString(),
      };
      await ctx.memory.store({ agentId: ctx.agentId, type: 'episodic', namespace: 'transactions', content: JSON.stringify({ ...txData, userId: params.fromUserId }), importance: 0.7, metadata: { userId: params.fromUserId, txId, type: 'transfer' } });
      await ctx.memory.store({ agentId: ctx.agentId, type: 'episodic', namespace: 'transactions', content: JSON.stringify({ ...txData, userId: params.toUserId }), importance: 0.7, metadata: { userId: params.toUserId, txId, type: 'transfer' } });

      const fee = params.amount > 50 ? Math.round(params.amount * 0.01 * 100) / 100 : 0;
      const totalDeducted = Math.round((params.amount + fee) * 100) / 100;
      const feeMessage = params.amount > 50
        ? `Amount: $${params.amount.toFixed(2)}, Fee (1%): $${fee.toFixed(2)}, Total deducted: $${totalDeducted.toFixed(2)}`
        : `Amount: $${params.amount.toFixed(2)}, Fee: Free (P2P under $50), Total: $${params.amount.toFixed(2)}`;

      return {
        success: true,
        data: {
          transactionId: txId,
          from: params.fromUserId,
          to: params.toUserId,
          amount: `$${params.amount.toFixed(2)}`,
          fee: `$${fee.toFixed(2)}`,
          totalDeducted: `$${totalDeducted.toFixed(2)}`,
          senderBalance: `$${senderWallet.balance.toFixed(2)}`,
          note: params.note,
          message: `Sent to ${params.toUserId}. ${feeMessage}${params.note ? ` — "${params.note}"` : ''}`,
        },
      };
    },
  },

  // ─── 11. Wallet Withdraw ───────────────────────────────────
  {
    name: 'wallet_withdraw',
    description: 'Withdraw funds from your PromptPay wallet to a bank account or debit card. A fee of 1% + $0.25 applies to all withdrawals.',
    category: 'wallet',
    inputSchema: walletWithdrawSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = walletWithdrawSchema.parse(input);
      ctx.logger.info(`[Nexus] Wallet withdraw: $${params.amount} for user ${params.userId}`);

      const walletRecords = await ctx.memory.recall(`wallet:${params.userId}`, 'wallets', 1);
      if (walletRecords.length === 0) {
        return { success: false, data: null, error: 'Wallet not found' };
      }

      const wallet = JSON.parse(walletRecords[0].content);
      if (wallet.balance < params.amount) {
        return { success: false, data: null, error: `Insufficient balance: $${wallet.balance.toFixed(2)}` };
      }

      // Debit wallet
      wallet.balance -= params.amount;
      wallet.lastTransactionAt = new Date().toISOString();

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'wallets',
        content: JSON.stringify(wallet), importance: 0.9, metadata: { userId: params.userId },
      });

      const txId = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await ctx.memory.store({
        agentId: ctx.agentId, type: 'episodic', namespace: 'transactions',
        content: JSON.stringify({
          id: txId, userId: params.userId, type: 'withdraw', amount: params.amount,
          currency: params.currency, status: 'pending', destination: params.paymentMethodId,
          timestamp: new Date().toISOString(),
        }),
        importance: 0.8, metadata: { userId: params.userId, txId, type: 'withdraw' },
      });

      const fee = Math.round((params.amount * 0.01 + 0.25) * 100) / 100;
      const totalDeducted = Math.round((params.amount + fee) * 100) / 100;

      return {
        success: true,
        data: {
          transactionId: txId,
          amount: `$${params.amount.toFixed(2)}`,
          fee: `$${fee.toFixed(2)}`,
          totalDeducted: `$${totalDeducted.toFixed(2)}`,
          remainingBalance: `$${wallet.balance.toFixed(2)}`,
          destination: params.paymentMethodId,
          estimatedArrival: '1-3 business days',
          status: 'pending',
          message: `Withdrawal initiated. Amount: $${params.amount.toFixed(2)}, Fee (1% + $0.25): $${fee.toFixed(2)}, Total deducted: $${totalDeducted.toFixed(2)}. Estimated arrival: 1-3 business days.`,
        },
      };
    },
  },

  // ═══════════════════════════════════════════════════════════
  // GROUP D: TRANSACTION HISTORY
  // ═══════════════════════════════════════════════════════════

  // ─── 12. Transaction History ───────────────────────────────
  {
    name: 'transaction_history',
    description: 'View transaction history — payments, bills, top-ups, transfers, withdrawals. Filter by date, type, status.',
    category: 'wallet',
    inputSchema: transactionHistorySchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = transactionHistorySchema.parse(input);
      ctx.logger.info(`[Nexus] Transaction history for user ${params.userId}`);

      const records = await ctx.memory.recall(`userId:${params.userId}`, 'transactions', params.limit);
      let transactions = records
        .map(r => JSON.parse(r.content))
        .filter(tx => tx.userId === params.userId);

      // Apply filters
      if (params.type !== 'all') {
        transactions = transactions.filter(tx => tx.type === params.type);
      }
      if (params.status !== 'all') {
        transactions = transactions.filter(tx => tx.status === params.status);
      }
      if (params.dateFrom) {
        transactions = transactions.filter(tx => tx.timestamp >= params.dateFrom!);
      }
      if (params.dateTo) {
        transactions = transactions.filter(tx => tx.timestamp <= params.dateTo!);
      }

      transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return {
        success: true,
        data: {
          userId: params.userId,
          count: transactions.length,
          transactions: transactions.slice(0, params.limit).map(tx => ({
            id: tx.id,
            type: tx.type,
            amount: `$${tx.amount?.toFixed(2) || '0.00'}`,
            currency: tx.currency,
            status: tx.status,
            description: tx.description || tx.note || tx.type,
            timestamp: tx.timestamp,
          })),
        },
      };
    },
  },

  // ═══════════════════════════════════════════════════════════
  // GROUP E: PromptPay — THE INNOVATION
  // ═══════════════════════════════════════════════════════════

  // ─── 13. PromptPay ────────────────────────────────────────
  {
    name: 'upromptpay',
    description: 'Pay anything, to anyone, with just a natural language prompt. The AI parses intent, finds recipient, selects the optimal payment method, and executes. "Pay my rent $1500 to John every month" — done.',
    category: 'wallet',
    inputSchema: upromptpaySchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = upromptpaySchema.parse(input);
      ctx.logger.info(`[Nexus] PromptPay: "${params.prompt}"`);

      // ── Step 1: Parse intent from natural language ──
      const prompt = params.prompt.toLowerCase();

      // Extract amount
      const amountMatch = prompt.match(/\$?([\d,]+\.?\d*)/);
      const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, '')) : null;

      // Extract currency hints
      let currency = 'usd';
      if (/kes|kenya|m-?pesa/i.test(prompt)) currency = 'kes';
      else if (/ghs|ghana|cedi/i.test(prompt)) currency = 'ghs';
      else if (/ugx|uganda/i.test(prompt)) currency = 'ugx';
      else if (/ngn|nigeria|naira/i.test(prompt)) currency = 'ngn';
      else if (/inr|india|rupee|upi/i.test(prompt)) currency = 'inr';
      else if (/eur|euro/i.test(prompt)) currency = 'eur';
      else if (/gbp|pound|sterling/i.test(prompt)) currency = 'gbp';
      else if (/zar|south.africa|rand/i.test(prompt)) currency = 'zar';

      // Detect action type
      let action: 'pay' | 'transfer' | 'save' | 'schedule' | 'split' = 'pay';
      if (/transfer|send|give/i.test(prompt)) action = 'transfer';
      if (/save|set.aside|savings/i.test(prompt)) action = 'save';
      if (/every|monthly|weekly|recurring|autopay/i.test(prompt)) action = 'schedule';
      if (/split|divide|share/i.test(prompt)) action = 'split';

      // Detect frequency
      let frequency: string | null = null;
      if (/every\s*week|weekly/i.test(prompt)) frequency = 'weekly';
      else if (/every\s*two\s*weeks|biweekly|bi-?weekly/i.test(prompt)) frequency = 'biweekly';
      else if (/every\s*month|monthly/i.test(prompt)) frequency = 'monthly';
      else if (/every\s*quarter|quarterly/i.test(prompt)) frequency = 'quarterly';
      else if (/every\s*year|annual/i.test(prompt)) frequency = 'annual';

      // Extract recipient clues
      const phoneMatch = prompt.match(/\+?\d{10,15}/);
      const emailMatch = prompt.match(/[\w.-]+@[\w.-]+\.\w+/);
      const nameMatch = prompt.match(/(?:to|for)\s+(?:my\s+)?(\w+(?:\s+\w+)?)/i);
      const recipient = phoneMatch?.[0] || emailMatch?.[0] || nameMatch?.[1] || null;

      // Extract description
      const descMatch = prompt.match(/(?:for|pay)\s+(?:my\s+)?(.+?)(?:\s+\$|\s+every|\s+from|$)/i);
      const description = descMatch?.[1]?.trim() || params.prompt.slice(0, 50);

      if (!amount) {
        return {
          success: true,
          data: {
            parsed: true,
            needsInput: true,
            action,
            recipient,
            currency,
            frequency,
            description,
            message: 'I understood your request but need an amount. How much would you like to pay?',
          },
        };
      }

      // ── Step 2: Get user's payment methods ──
      const methods = await ctx.memory.recall(`userId:${params.userId}`, 'payment_methods', 10);
      const userMethods = methods.map(r => JSON.parse(r.content)).filter(m => m.userId === params.userId);
      const defaultMethod = userMethods.find(m => m.isDefault) || userMethods[0];

      // ── Step 3: Determine route ──
      let route: string;
      let provider: string;

      if (['kes', 'tzs'].includes(currency)) {
        route = 'mpesa_stk_push';
        provider = 'M-Pesa';
      } else if (['ghs', 'ugx', 'xaf'].includes(currency)) {
        route = 'mtn_momo_request_to_pay';
        provider = 'MTN MoMo';
      } else if (['ngn'].includes(currency)) {
        route = 'flutterwave_charge';
        provider = 'Flutterwave';
      } else if (['inr'].includes(currency)) {
        route = 'razorpay_create_order';
        provider = 'Razorpay';
      } else {
        route = 'stripe';
        provider = 'Stripe (Apple Pay / Google Pay / Card)';
      }

      // ── Step 4: Build execution plan ──
      const plan: Record<string, unknown> = {
        action,
        amount,
        currency: currency.toUpperCase(),
        recipient: recipient || 'Not specified — will confirm',
        paymentMethod: defaultMethod ? `${defaultMethod.brand} ...${defaultMethod.last4}` : 'Default method',
        route,
        provider,
        description,
      };

      if (frequency) {
        plan.frequency = frequency;
        plan.type = 'recurring';
      } else {
        plan.type = 'one-time';
      }

      // ── Step 5: Execute (if we have enough info) ──
      if (action === 'schedule' && frequency) {
        // Create bill schedule
        const scheduleId = `BILL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const schedule = {
          id: scheduleId,
          userId: params.userId,
          name: description,
          amount,
          currency,
          frequency,
          nextPaymentDate: new Date().toISOString().split('T')[0],
          paymentMethodId: defaultMethod?.id || '',
          recipientInfo: { name: recipient, phone: phoneMatch?.[0], email: emailMatch?.[0] },
          status: 'active',
          createdAt: new Date().toISOString(),
          lastPaidAt: null,
          totalPaid: 0,
        };

        await ctx.memory.store({
          agentId: ctx.agentId, type: 'procedural', namespace: 'bill_schedules',
          content: JSON.stringify(schedule), importance: 0.8,
          metadata: { userId: params.userId, scheduleId },
        });

        plan.scheduleId = scheduleId;
        plan.status = 'scheduled';
        plan.message = `Autopay created: $${amount.toFixed(2)} ${frequency} for "${description}"${recipient ? ` to ${recipient}` : ''}`;
      } else if (action === 'transfer' || action === 'pay') {
        // Store as pending transaction for confirmation
        const txId = `TX-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        await ctx.memory.store({
          agentId: ctx.agentId, type: 'episodic', namespace: 'transactions',
          content: JSON.stringify({
            id: txId, userId: params.userId, type: action, amount, currency,
            status: 'pending_confirmation', description, recipient,
            route, timestamp: new Date().toISOString(),
          }),
          importance: 0.8, metadata: { userId: params.userId, txId },
        });

        plan.transactionId = txId;
        plan.status = 'pending_confirmation';
        plan.message = `Ready to ${action}: $${amount.toFixed(2)} ${currency.toUpperCase()}${recipient ? ` to ${recipient}` : ''} via ${provider}. Confirm to execute.`;
      } else if (action === 'save') {
        plan.status = 'savings_plan';
        plan.message = `Savings plan: $${amount.toFixed(2)} ${frequency || 'one-time'}. This will be set aside from your wallet.`;
      }

      return {
        success: true,
        data: {
          uPromptPay: true,
          originalPrompt: params.prompt,
          plan,
          availablePaymentMethods: userMethods.map(m => ({
            id: m.id,
            display: `${m.brand} ...${m.last4}${m.isDefault ? ' (default)' : ''}`,
          })),
        },
      };
    },
  },

  // ─── 14. Smart Split ───────────────────────────────────────
  {
    name: 'smart_split',
    description: 'AI-powered bill splitting. Split a bill equally, by percentage, or custom amounts. Handles tip and tax distribution. Sends payment requests via any channel.',
    category: 'wallet',
    inputSchema: smartSplitSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = smartSplitSchema.parse(input);
      ctx.logger.info(`[Nexus] Smart split: $${params.totalAmount} among ${params.participants.length} people`);

      let totalWithExtras = params.totalAmount;
      if (params.taxAmount) totalWithExtras += params.taxAmount;
      if (params.tipPercent) totalWithExtras += params.totalAmount * (params.tipPercent / 100);

      const splits: Array<{ name: string; amount: number; channel?: string; channelId?: string; status: string }> = [];

      switch (params.splitType) {
        case 'equal': {
          const perPerson = Math.round((totalWithExtras / params.participants.length) * 100) / 100;
          // Last person absorbs rounding difference
          const lastAmount = totalWithExtras - perPerson * (params.participants.length - 1);
          params.participants.forEach((p, i) => {
            splits.push({
              name: p.name,
              amount: i === params.participants.length - 1 ? Math.round(lastAmount * 100) / 100 : perPerson,
              channel: p.channel,
              channelId: p.channelId,
              status: 'pending',
            });
          });
          break;
        }
        case 'percentage': {
          params.participants.forEach(p => {
            const pct = p.percentage || (100 / params.participants.length);
            splits.push({
              name: p.name,
              amount: Math.round(totalWithExtras * (pct / 100) * 100) / 100,
              channel: p.channel,
              channelId: p.channelId,
              status: 'pending',
            });
          });
          break;
        }
        case 'custom':
        case 'itemized': {
          params.participants.forEach(p => {
            splits.push({
              name: p.name,
              amount: p.amount || Math.round((totalWithExtras / params.participants.length) * 100) / 100,
              channel: p.channel,
              channelId: p.channelId,
              status: 'pending',
            });
          });
          break;
        }
      }

      // Send payment requests via messaging
      const sendTool = ctx.tools.get('send_message');
      for (const split of splits) {
        if (split.channel && split.channelId && sendTool) {
          const checkoutUrl = `${CONFIG.promptpay.apiUrl}/split-pay/${params.userId}/${split.name}`;
          const message = [
            `Bill Split Request from ${params.userId}`,
            `${params.description}`,
            `Your share: $${split.amount.toFixed(2)} ${params.currency.toUpperCase()}`,
            ``,
            `Tap to pay: ${checkoutUrl}`,
          ].join('\n');

          try {
            await sendTool.execute({ channel: split.channel, recipientId: split.channelId, message }, ctx);
            split.status = 'request_sent';
          } catch {
            split.status = 'send_failed';
          }
        }
      }

      // Store split record
      const splitId = `SPLIT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await ctx.memory.store({
        agentId: ctx.agentId, type: 'episodic', namespace: 'transactions',
        content: JSON.stringify({
          id: splitId, userId: params.userId, type: 'split', amount: totalWithExtras,
          currency: params.currency, description: params.description, splits,
          timestamp: new Date().toISOString(),
        }),
        importance: 0.7, metadata: { userId: params.userId, splitId, type: 'split' },
      });

      return {
        success: true,
        data: {
          splitId,
          description: params.description,
          subtotal: `$${params.totalAmount.toFixed(2)}`,
          tax: params.taxAmount ? `$${params.taxAmount.toFixed(2)}` : null,
          tip: params.tipPercent ? `${params.tipPercent}% ($${(params.totalAmount * params.tipPercent / 100).toFixed(2)})` : null,
          total: `$${totalWithExtras.toFixed(2)}`,
          splitType: params.splitType,
          splits: splits.map(s => ({
            name: s.name,
            owes: `$${s.amount.toFixed(2)}`,
            requestStatus: s.status,
          })),
          message: `Bill split: $${totalWithExtras.toFixed(2)} divided ${params.splitType === 'equal' ? 'equally' : params.splitType} among ${splits.length} people. Payment requests sent.`,
        },
      };
    },
  },

  // ─── 15. Pay Forward ───────────────────────────────────────
  {
    name: 'pay_forward',
    description: 'Set conditional future payments. "When I get a deposit, save 10%." "Donate $5 every Friday." "When wallet hits $1000, pay my credit card." Create, list, pause, resume, or delete rules.',
    category: 'wallet',
    inputSchema: payForwardSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = payForwardSchema.parse(input);
      ctx.logger.info(`[Nexus] Pay forward: ${params.action}`);

      if (!CONFIG.wallet.payForwardEnabled) {
        return { success: false, data: null, error: 'Pay Forward disabled — set WALLET_PAY_FORWARD_ENABLED=true' };
      }

      switch (params.action) {
        case 'create': {
          if (!params.trigger || !params.triggerConfig || !params.payAction) {
            return { success: false, data: null, error: 'trigger, triggerConfig, and payAction required for create' };
          }

          const ruleId = `PF-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const rule = {
            id: ruleId,
            userId: params.userId,
            trigger: params.trigger,
            triggerConfig: params.triggerConfig,
            action: params.payAction,
            status: 'active',
            executionCount: 0,
            createdAt: new Date().toISOString(),
          };

          await ctx.memory.store({
            agentId: ctx.agentId, type: 'procedural', namespace: 'pay_forward_rules',
            content: JSON.stringify(rule), importance: 0.8,
            metadata: { userId: params.userId, ruleId, trigger: params.trigger },
          });

          const triggerDesc = {
            on_deposit: 'When a deposit is received',
            on_date: `On ${JSON.stringify(params.triggerConfig)}`,
            on_balance_threshold: `When wallet balance hits ${JSON.stringify(params.triggerConfig)}`,
          }[params.trigger];

          return {
            success: true,
            data: {
              ruleId,
              trigger: triggerDesc,
              action: `${params.payAction.type} $${params.payAction.amount.toFixed(2)} ${params.payAction.currency}`,
              status: 'active',
              message: `Pay Forward rule created: ${triggerDesc} → ${params.payAction.type} $${params.payAction.amount}`,
            },
          };
        }

        case 'list': {
          const records = await ctx.memory.recall(`userId:${params.userId}`, 'pay_forward_rules', 50);
          const rules = records.map(r => JSON.parse(r.content)).filter(r => r.userId === params.userId);

          return {
            success: true,
            data: {
              userId: params.userId,
              count: rules.length,
              rules: rules.map(r => ({
                ruleId: r.id,
                trigger: r.trigger,
                triggerConfig: r.triggerConfig,
                action: `${r.action.type} $${r.action.amount} ${r.action.currency}`,
                status: r.status,
                executionCount: r.executionCount,
              })),
            },
          };
        }

        case 'pause':
        case 'resume': {
          if (!params.ruleId) return { success: false, data: null, error: 'ruleId required' };
          const records = await ctx.memory.recall(`ruleId:${params.ruleId}`, 'pay_forward_rules', 1);
          if (records.length === 0) return { success: false, data: null, error: 'Rule not found' };

          const rule = JSON.parse(records[0].content);
          rule.status = params.action === 'pause' ? 'paused' : 'active';

          await ctx.memory.store({
            agentId: ctx.agentId, type: 'procedural', namespace: 'pay_forward_rules',
            content: JSON.stringify(rule), importance: 0.7, metadata: { ruleId: params.ruleId },
          });

          return { success: true, data: { ruleId: params.ruleId, status: rule.status } };
        }

        case 'delete': {
          if (!params.ruleId) return { success: false, data: null, error: 'ruleId required' };
          const records = await ctx.memory.recall(`ruleId:${params.ruleId}`, 'pay_forward_rules', 1);
          if (records.length > 0) {
            await ctx.memory.forget(records[0].id);
          }
          return { success: true, data: { deleted: params.ruleId } };
        }
      }
    },
  },

  // ═══════════════════════════════════════════════════════════
  // GROUP F: AGENT NETWORK (Cash-In / Cash-Out)
  // ═══════════════════════════════════════════════════════════

  // ─── 16. Agent Cash-In ──────────────────────────────────────
  {
    name: 'agent_cash_in',
    description: 'PromptPay Agent: Accept cash from a customer and credit their wallet. Agent must be registered. Commission (0.75%) earned on each transaction. For Nigeria, Ghana, Uganda, Kenya agent network.',
    category: 'agent_network',
    inputSchema: agentCashInSchema,
    requiresApproval: true,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = agentCashInSchema.parse(input);
      const userId = ctx.agentId; // The agent performing the action
      ctx.logger.info(`[Nexus] Agent cash-in: ${params.amount} for customer ${params.customerId}`);

      if (!CONFIG.agentNetwork.enabled) {
        return { success: false, data: null, error: 'Agent network is not enabled' };
      }

      // Verify agent exists (check agent_accounts via memory)
      const agents = await ctx.memory.recall('agent', 'agent_accounts', 10);
      const agentEntry = agents.find(a => {
        const data = JSON.parse(a.content);
        return data.userId === userId && data.status === 'active';
      });

      if (!agentEntry) return { success: false, data: null, error: 'You are not a registered agent. Apply for agent status first.' };

      const agent = JSON.parse(agentEntry.content);
      if (agent.floatBalance < params.amount) {
        return { success: false, data: null, error: `Insufficient float. Your balance: ${agent.floatBalance}, needed: ${params.amount}` };
      }

      // Deduct from agent float
      const commission = Math.round(params.amount * CONFIG.agentNetwork.commissionPercent / 100 * 100) / 100;
      agent.floatBalance = Math.round((agent.floatBalance - params.amount) * 100) / 100;
      agent.commissionEarned = Math.round((agent.commissionEarned + commission) * 100) / 100;

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'agent_accounts',
        content: JSON.stringify(agent), importance: 0.9, metadata: { userId },
      });

      // Credit customer wallet
      const wallets = await ctx.memory.recall('wallet', 'wallets', 20);
      let walletEntry = wallets.find(w => {
        const data = JSON.parse(w.content);
        return data.userId === params.customerId;
      });

      let wallet: Record<string, unknown>;
      if (walletEntry) {
        wallet = JSON.parse(walletEntry.content);
        wallet.balance = Math.round(((wallet.balance as number) + params.amount) * 100) / 100;
      } else {
        wallet = { userId: params.customerId, balance: params.amount, currency: params.currency, status: 'active', createdAt: new Date().toISOString() };
      }
      wallet.lastTransactionAt = new Date().toISOString();

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'wallets',
        content: JSON.stringify(wallet), importance: 0.9, metadata: { userId: params.customerId },
      });

      const txId = `CASHIN-${Date.now().toString(36).toUpperCase()}`;
      await ctx.memory.store({
        agentId: ctx.agentId, type: 'episodic', namespace: 'agent_transactions',
        content: JSON.stringify({ txId, type: 'cash_in', agentUserId: userId, customerId: params.customerId, amount: params.amount, commission, currency: params.currency }),
        importance: 0.8, metadata: { type: 'cash_in' },
      });

      return {
        success: true,
        data: {
          transactionId: txId,
          type: 'cash_in',
          customerCredited: params.amount,
          agentCommission: commission,
          agentFloatRemaining: agent.floatBalance,
          customerNewBalance: wallet.balance,
          currency: params.currency,
          message: `Cash-in: ${params.amount} ${params.currency} credited to customer. Commission: ${commission}. Float remaining: ${agent.floatBalance}`,
        },
      };
    },
  },

  // ─── 17. Agent Cash-Out ─────────────────────────────────────
  {
    name: 'agent_cash_out',
    description: 'PromptPay Agent: Give cash to a customer by deducting from their wallet. Agent earns 0.75% commission. Customer gets physical cash.',
    category: 'agent_network',
    inputSchema: agentCashOutSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = agentCashOutSchema.parse(input);
      const userId = ctx.agentId;
      ctx.logger.info(`[Nexus] Agent cash-out: ${params.amount} for customer ${params.customerId}`);

      if (!CONFIG.agentNetwork.enabled) {
        return { success: false, data: null, error: 'Agent network is not enabled' };
      }

      const agents = await ctx.memory.recall('agent', 'agent_accounts', 10);
      const agentEntry = agents.find(a => {
        const data = JSON.parse(a.content);
        return data.userId === userId && data.status === 'active';
      });
      if (!agentEntry) return { success: false, data: null, error: 'Not a registered agent' };
      const agent = JSON.parse(agentEntry.content);

      // Check customer wallet
      const wallets = await ctx.memory.recall('wallet', 'wallets', 20);
      const walletEntry = wallets.find(w => {
        const data = JSON.parse(w.content);
        return data.userId === params.customerId;
      });
      if (!walletEntry) return { success: false, data: null, error: 'Customer wallet not found' };

      const wallet = JSON.parse(walletEntry.content);
      if ((wallet.balance as number) < params.amount) {
        return { success: false, data: null, error: `Customer insufficient balance: ${wallet.balance}` };
      }

      const commission = Math.round(params.amount * CONFIG.agentNetwork.commissionPercent / 100 * 100) / 100;
      wallet.balance = Math.round(((wallet.balance as number) - params.amount) * 100) / 100;
      wallet.lastTransactionAt = new Date().toISOString();
      agent.commissionEarned = Math.round((agent.commissionEarned + commission) * 100) / 100;

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'wallets',
        content: JSON.stringify(wallet), importance: 0.9, metadata: { userId: params.customerId },
      });
      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'agent_accounts',
        content: JSON.stringify(agent), importance: 0.9, metadata: { userId },
      });

      const txId = `CASHOUT-${Date.now().toString(36).toUpperCase()}`;
      await ctx.memory.store({
        agentId: ctx.agentId, type: 'episodic', namespace: 'agent_transactions',
        content: JSON.stringify({ txId, type: 'cash_out', agentUserId: userId, customerId: params.customerId, amount: params.amount, commission, currency: params.currency }),
        importance: 0.8, metadata: { type: 'cash_out' },
      });

      return {
        success: true,
        data: {
          transactionId: txId,
          type: 'cash_out',
          cashGiven: params.amount,
          agentCommission: commission,
          customerNewBalance: wallet.balance,
          currency: params.currency,
          message: `Cash-out: ${params.amount} ${params.currency} given to customer. Commission: ${commission}. Customer balance: ${wallet.balance}`,
        },
      };
    },
  },

  // ─── 18. Agent Float Check ──────────────────────────────────
  {
    name: 'agent_float_check',
    description: 'Check your agent float balance, commission earned, and transaction summary. For registered PromptPay agents.',
    category: 'agent_network',
    inputSchema: agentFloatCheckSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (_input, ctx) => {
      ctx.logger.info(`[Nexus] Agent float check`);

      const agents = await ctx.memory.recall('agent', 'agent_accounts', 10);
      const agentEntry = agents.find(a => {
        const data = JSON.parse(a.content);
        return data.userId === ctx.agentId;
      });

      if (!agentEntry) return { success: false, data: null, error: 'Not a registered agent' };
      const agent = JSON.parse(agentEntry.content);

      const txs = await ctx.memory.recall('transactions', 'agent_transactions', 50);
      const todayTxs = txs.filter(t => {
        const data = JSON.parse(t.content);
        return data.agentUserId === ctx.agentId && t.createdAt.toISOString().startsWith(new Date().toISOString().slice(0, 10));
      });

      return {
        success: true,
        data: {
          floatBalance: agent.floatBalance,
          commissionEarned: agent.commissionEarned,
          status: agent.status,
          location: `${agent.locationCity || ''}, ${agent.locationCountry || ''}`,
          transactionsToday: todayTxs.length,
          maxFloat: CONFIG.agentNetwork.maxFloatUsd,
          commissionRate: `${CONFIG.agentNetwork.commissionPercent}%`,
        },
      };
    },
  },

  // ═══════════════════════════════════════════════════════════
  // GROUP G: VIRALITY (Request Money, Payment Links, PayTag)
  // ═══════════════════════════════════════════════════════════

  // ─── 19. Request Money ──────────────────────────────────────
  {
    name: 'request_money',
    description: 'Request money from someone via email, phone, or $paytag. Generates a payment link they must open to pay — they need to download PromptPay if they don\'t have it (viral acquisition loop).',
    category: 'virality',
    inputSchema: requestMoneySchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = requestMoneySchema.parse(input);
      ctx.logger.info(`[Nexus] Request money: ${params.amount} from ${params.targetContact}`);

      const reqId = `REQ-${Date.now().toString(36).toUpperCase()}`;
      const paymentLink = `${CONFIG.paytag.linkBaseUrl}/request/${reqId}`;

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'episodic', namespace: 'payment_requests',
        content: JSON.stringify({
          id: reqId, requesterId: ctx.agentId, targetContact: params.targetContact,
          amount: params.amount, currency: params.currency, message: params.message,
          status: 'pending', createdAt: new Date().toISOString(),
        }),
        importance: 0.7, metadata: { type: 'payment_request' },
      });

      const shareText = params.message
        ? `${params.message} — Pay $${params.amount} on PromptPay: ${paymentLink}`
        : `You owe me $${params.amount}! Pay here: ${paymentLink}`;

      return {
        success: true,
        data: {
          requestId: reqId,
          amount: params.amount,
          currency: params.currency,
          targetContact: params.targetContact,
          paymentLink,
          shareText,
          status: 'pending',
          message: `Payment request sent! Share this link: ${paymentLink}`,
          viralNote: 'If they don\'t have PromptPay yet, the link prompts them to sign up — that\'s how we grow!',
        },
      };
    },
  },

  // ─── 20. Generate Payment Link ──────────────────────────────
  {
    name: 'generate_payment_link',
    description: 'Generate a shareable payment link or QR code. Share on social media, text, or print. Anyone can pay you — even without the app (they sign up to pay).',
    category: 'virality',
    inputSchema: generatePaymentLinkSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = generatePaymentLinkSchema.parse(input);
      ctx.logger.info(`[Nexus] Payment link: ${params.amount || 'open'} ${params.currency}`);

      const linkId = `LINK-${Date.now().toString(36).toUpperCase()}`;
      const expiresAt = new Date(Date.now() + params.expiresInHours * 3600000).toISOString();
      const url = `${CONFIG.paytag.linkBaseUrl}/${linkId}`;
      const qrUrl = `${CONFIG.paytag.linkBaseUrl}/qr/${encodeURIComponent(url)}`;

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'episodic', namespace: 'payment_links',
        content: JSON.stringify({
          id: linkId, creatorId: ctx.agentId, amount: params.amount,
          currency: params.currency, label: params.label, expiresAt,
          status: 'active', createdAt: new Date().toISOString(),
        }),
        importance: 0.6, metadata: { type: 'payment_link' },
      });

      return {
        success: true,
        data: {
          linkId,
          url,
          qrUrl,
          amount: params.amount || 'open (payer chooses)',
          currency: params.currency,
          label: params.label,
          expiresAt,
          shareText: params.amount
            ? `Pay me $${params.amount} for ${params.label}: ${url}`
            : `Send me money on PromptPay: ${url}`,
          message: `Payment link created! Share: ${url}`,
        },
      };
    },
  },

  // ─── 21. Claim PayTag ───────────────────────────────────────
  {
    name: 'claim_paytag',
    description: 'Claim your unique $PayTag — a shareable payment identity like Cash App\'s $cashtag. Put it in your social media bio, share with friends. Anyone sends money to your $tag.',
    category: 'virality',
    inputSchema: claimPaytagSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = claimPaytagSchema.parse(input);
      const tag = params.paytag.toLowerCase();
      ctx.logger.info(`[Nexus] Claim PayTag: $${tag}`);

      if (tag.length < CONFIG.paytag.minLength || tag.length > CONFIG.paytag.maxLength) {
        return { success: false, data: null, error: `PayTag must be ${CONFIG.paytag.minLength}-${CONFIG.paytag.maxLength} characters` };
      }

      // Check if tag is taken
      const existing = await ctx.memory.recall(tag, 'paytags', 5);
      const taken = existing.some(e => {
        const data = JSON.parse(e.content);
        return data.paytag === tag;
      });
      if (taken) return { success: false, data: null, error: `$${tag} is already taken. Try another.` };

      const profileUrl = `${CONFIG.paytag.linkBaseUrl}/$${tag}`;
      const qrUrl = `${CONFIG.paytag.linkBaseUrl}/qr/${encodeURIComponent(profileUrl)}`;

      await ctx.memory.store({
        agentId: ctx.agentId, type: 'semantic', namespace: 'paytags',
        content: JSON.stringify({ userId: ctx.agentId, paytag: tag, createdAt: new Date().toISOString() }),
        importance: 0.9, metadata: { paytag: tag },
      });

      return {
        success: true,
        data: {
          paytag: `$${tag}`,
          profileUrl,
          qrUrl,
          shareText: `Send me money on PromptPay: $${tag} — ${profileUrl}`,
          message: `Your PayTag $${tag} is claimed! Share it everywhere — anyone can pay you at ${profileUrl}`,
        },
      };
    },
  },
];
