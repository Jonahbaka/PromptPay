// ═══════════════════════════════════════════════════════════════
// Agent::Assistant_Ops (Otto)
// Subscriptions, bill negotiation, appointments, documents, alerts
// ═══════════════════════════════════════════════════════════════

import { ToolDefinition, ToolResult, ExecutionContext } from '../../core/types.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { CONFIG } from '../../core/config.js';

// ── Helper: get DB ──

function getDb(): Database.Database {
  return new Database(CONFIG.database.path);
}

// ── Manage Subscriptions ──

const ManageSubInput = z.object({
  userId: z.string(),
  action: z.enum(['list', 'add', 'cancel', 'pause']),
  // For add:
  serviceName: z.string().optional(),
  amount: z.number().positive().optional(),
  currency: z.string().default('usd'),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'annual']).optional(),
  nextBillingDate: z.string().optional(),
  category: z.string().default('other'),
  // For cancel/pause:
  subscriptionId: z.string().optional(),
});

export const manageSubscriptionsTool: ToolDefinition = {
  name: 'manage_subscriptions',
  description: 'Manage recurring subscriptions — list all active subscriptions, add new ones, cancel, or pause existing ones.',
  category: 'assistant',
  inputSchema: ManageSubInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = ManageSubInput.parse(input);
    ctx.logger.info(`Subscription ${parsed.action} for user ${parsed.userId}`);

    const db = getDb();
    const now = new Date().toISOString();

    switch (parsed.action) {
      case 'list': {
        const subs = db.prepare(
          "SELECT * FROM subscriptions WHERE user_id = ? AND status != 'cancelled' ORDER BY next_billing_date"
        ).all(parsed.userId);
        const totalMonthly = (subs as Array<Record<string, unknown>>).reduce((sum, s) => {
          const amount = s.amount as number;
          switch (s.frequency) {
            case 'weekly': return sum + amount * 4.33;
            case 'monthly': return sum + amount;
            case 'quarterly': return sum + amount / 3;
            case 'annual': return sum + amount / 12;
            default: return sum + amount;
          }
        }, 0);
        db.close();
        return {
          success: true,
          data: { subscriptions: subs, totalMonthly: +totalMonthly.toFixed(2), count: subs.length },
        };
      }
      case 'add': {
        if (!parsed.serviceName || !parsed.amount || !parsed.frequency) {
          db.close();
          return { success: false, data: null, error: 'serviceName, amount, and frequency are required for add' };
        }
        const id = uuid();
        const billing = parsed.nextBillingDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        db.prepare(`
          INSERT INTO subscriptions (id, user_id, service_name, amount, currency, frequency, next_billing_date, category, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        `).run(id, parsed.userId, parsed.serviceName, parsed.amount, parsed.currency, parsed.frequency, billing, parsed.category, now, now);
        db.close();
        return { success: true, data: { subscriptionId: id, serviceName: parsed.serviceName, amount: parsed.amount } };
      }
      case 'cancel': {
        if (!parsed.subscriptionId) { db.close(); return { success: false, data: null, error: 'subscriptionId required' }; }
        db.prepare("UPDATE subscriptions SET status = 'cancelled', updated_at = ? WHERE id = ? AND user_id = ?")
          .run(now, parsed.subscriptionId, parsed.userId);
        db.close();
        return { success: true, data: { subscriptionId: parsed.subscriptionId, status: 'cancelled' } };
      }
      case 'pause': {
        if (!parsed.subscriptionId) { db.close(); return { success: false, data: null, error: 'subscriptionId required' }; }
        db.prepare("UPDATE subscriptions SET status = 'paused', updated_at = ? WHERE id = ? AND user_id = ?")
          .run(now, parsed.subscriptionId, parsed.userId);
        db.close();
        return { success: true, data: { subscriptionId: parsed.subscriptionId, status: 'paused' } };
      }
    }
  },
};

// ── Negotiate Bill ──

const NegotiateBillInput = z.object({
  userId: z.string(),
  billType: z.enum(['internet', 'phone', 'cable', 'insurance', 'medical', 'utility', 'other']),
  currentMonthlyAmount: z.number().positive(),
  provider: z.string(),
  accountYears: z.number().min(0).default(1),
});

export const negotiateBillTool: ToolDefinition = {
  name: 'negotiate_bill',
  description: 'Generate a bill negotiation strategy and talking points to help lower recurring bills. AI-powered script generation.',
  category: 'assistant',
  inputSchema: NegotiateBillInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = NegotiateBillInput.parse(input);
    ctx.logger.info(`Bill negotiation: ${parsed.provider} ($${parsed.currentMonthlyAmount}/mo)`);

    const targetSavings = +(parsed.currentMonthlyAmount * 0.2).toFixed(2);
    const targetAmount = +(parsed.currentMonthlyAmount - targetSavings).toFixed(2);

    const scripts: string[] = [
      `"Hi, I've been a loyal customer for ${parsed.accountYears} year(s) and I'd like to discuss my current rate of $${parsed.currentMonthlyAmount}/month."`,
      `"I've been looking at competitors and found better rates. I'd like to stay with ${parsed.provider}, but I need a better deal."`,
      `"Is there a loyalty discount or promotion you can apply to my account?"`,
      `"I'd like to speak with the retention department about my options."`,
    ];

    const tips: string[] = [
      'Call during business hours for shorter wait times.',
      'Be polite but firm — you have leverage as a long-term customer.',
      `Ask for a target rate of $${targetAmount}/month (20% reduction).`,
      'If the first agent can\'t help, ask for a supervisor or retention specialist.',
      'Mention competitors by name with their rates.',
    ];

    return {
      success: true,
      data: {
        provider: parsed.provider,
        billType: parsed.billType,
        currentAmount: parsed.currentMonthlyAmount,
        targetAmount,
        potentialAnnualSavings: +(targetSavings * 12).toFixed(2),
        scripts,
        tips,
      },
    };
  },
};

// ── Schedule Appointment ──

const AppointmentInput = z.object({
  userId: z.string(),
  title: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  scheduledAt: z.string(),
  durationMinutes: z.number().positive().default(60),
});

export const scheduleAppointmentTool: ToolDefinition = {
  name: 'schedule_appointment',
  description: 'Schedule an appointment or reminder with date, time, location, and duration.',
  category: 'assistant',
  inputSchema: AppointmentInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = AppointmentInput.parse(input);
    ctx.logger.info(`Scheduling appointment: ${parsed.title} at ${parsed.scheduledAt}`);

    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();

    db.prepare(`
      INSERT INTO appointments (id, user_id, title, description, location, scheduled_at, duration_minutes, reminder_sent, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'scheduled', ?)
    `).run(id, parsed.userId, parsed.title, parsed.description ?? null, parsed.location ?? null, parsed.scheduledAt, parsed.durationMinutes, now);
    db.close();

    return {
      success: true,
      data: {
        appointmentId: id,
        title: parsed.title,
        scheduledAt: parsed.scheduledAt,
        durationMinutes: parsed.durationMinutes,
      },
    };
  },
};

// ── Store Document ──

const StoreDocInput = z.object({
  userId: z.string(),
  name: z.string().min(1),
  type: z.string(),
  category: z.enum(['receipt', 'warranty', 'contract', 'insurance', 'tax', 'other']).default('other'),
  content: z.string(),
  expiresAt: z.string().optional(),
});

export const storeDocumentTool: ToolDefinition = {
  name: 'store_document',
  description: 'Store a document (receipt, warranty, contract, etc.) for future reference. Includes category tagging and optional expiration.',
  category: 'assistant',
  inputSchema: StoreDocInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = StoreDocInput.parse(input);
    ctx.logger.info(`Storing document: ${parsed.name} (${parsed.category})`);

    // Check size limit
    const sizeMb = Buffer.byteLength(parsed.content, 'utf-8') / (1024 * 1024);
    if (sizeMb > CONFIG.assistant.maxDocumentSizeMb) {
      return { success: false, data: null, error: `Document exceeds ${CONFIG.assistant.maxDocumentSizeMb}MB limit` };
    }

    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();

    db.prepare(`
      INSERT INTO stored_documents (id, user_id, name, doc_type, category, content, metadata, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)
    `).run(id, parsed.userId, parsed.name, parsed.type, parsed.category, parsed.content, parsed.expiresAt ?? null, now);
    db.close();

    return {
      success: true,
      data: { documentId: id, name: parsed.name, category: parsed.category },
    };
  },
};

// ── Set Price Alert ──

const PriceAlertInput = z.object({
  userId: z.string(),
  productName: z.string().min(1),
  targetPrice: z.number().positive(),
  sourceUrl: z.string().optional(),
});

export const setPriceAlertTool: ToolDefinition = {
  name: 'set_price_alert',
  description: 'Set a price alert for a product. Get notified when the price drops to or below your target.',
  category: 'assistant',
  inputSchema: PriceAlertInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = PriceAlertInput.parse(input);
    ctx.logger.info(`Price alert: ${parsed.productName} <= $${parsed.targetPrice}`);

    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();

    db.prepare(`
      INSERT INTO price_alerts (id, user_id, product_name, target_price, current_price, source_url, status, created_at, triggered_at)
      VALUES (?, ?, ?, ?, NULL, ?, 'active', ?, NULL)
    `).run(id, parsed.userId, parsed.productName, parsed.targetPrice, parsed.sourceUrl ?? null, now);
    db.close();

    return {
      success: true,
      data: { alertId: id, productName: parsed.productName, targetPrice: parsed.targetPrice },
    };
  },
};

// ── Process Return ──

const ProcessReturnInput = z.object({
  userId: z.string(),
  orderId: z.string(),
  reason: z.enum(['defective', 'wrong_item', 'changed_mind', 'not_as_described', 'other']),
  description: z.string().optional(),
});

export const processReturnTool: ToolDefinition = {
  name: 'process_return',
  description: 'Initiate a product return process. Generates return instructions and updates order status.',
  category: 'assistant',
  inputSchema: ProcessReturnInput,
  requiresApproval: false,
  riskLevel: 'medium',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = ProcessReturnInput.parse(input);
    ctx.logger.info(`Processing return for order ${parsed.orderId}: ${parsed.reason}`);

    const db = getDb();
    const order = db.prepare('SELECT * FROM shopping_orders WHERE id = ? AND user_id = ?')
      .get(parsed.orderId, parsed.userId) as Record<string, unknown> | undefined;

    if (!order) {
      db.close();
      return { success: false, data: null, error: 'Order not found' };
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE shopping_orders SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, parsed.orderId);
    db.close();

    return {
      success: true,
      data: {
        orderId: parsed.orderId,
        reason: parsed.reason,
        returnInstructions: [
          `Contact ${order.store} customer service with order #${parsed.orderId}.`,
          `Reason: ${parsed.reason}`,
          'Package the item securely in its original packaging.',
          'Ship within 14 days for a full refund.',
        ],
        estimatedRefund: order.total_amount,
      },
    };
  },
};

// ── Find Deals ──

const FindDealsInput = z.object({
  userId: z.string(),
  categories: z.array(z.string()).optional(),
  maxBudget: z.number().positive().optional(),
});

export const findDealsTool: ToolDefinition = {
  name: 'find_deals',
  description: 'Find current deals and discounts based on shopping history and preferences.',
  category: 'assistant',
  inputSchema: FindDealsInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = FindDealsInput.parse(input);
    ctx.logger.info(`Finding deals for user ${parsed.userId}`);

    const db = getDb();
    // Check active price alerts that might have deals
    const alerts = db.prepare(
      "SELECT * FROM price_alerts WHERE user_id = ? AND status = 'active'"
    ).all(parsed.userId) as Array<Record<string, unknown>>;

    // Check subscription renewals coming up
    const upcomingRenewals = db.prepare(`
      SELECT * FROM subscriptions
      WHERE user_id = ? AND status = 'active'
        AND next_billing_date <= datetime('now', '+7 days')
      ORDER BY next_billing_date
    `).all(parsed.userId) as Array<Record<string, unknown>>;
    db.close();

    return {
      success: true,
      data: {
        activePriceAlerts: alerts.length,
        upcomingRenewals: upcomingRenewals.map(s => ({
          service: s.service_name,
          amount: s.amount,
          billingDate: s.next_billing_date,
        })),
        tips: [
          'Check if any subscriptions can be downgraded to a cheaper tier.',
          'Compare prices before making purchases over $50.',
          'Set price alerts on items you want — buy when the price drops.',
        ],
      },
    };
  },
};

// ── Auto Pay Optimize ──

const AutoPayInput = z.object({
  userId: z.string(),
});

export const autoPayOptimizeTool: ToolDefinition = {
  name: 'auto_pay_optimize',
  description: 'Analyze all recurring payments and subscriptions, suggest optimizations like better billing dates, unused services, and potential savings.',
  category: 'assistant',
  inputSchema: AutoPayInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = AutoPayInput.parse(input);
    ctx.logger.info(`Auto-pay optimization for user ${parsed.userId}`);

    const db = getDb();
    const subs = db.prepare(
      "SELECT * FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY amount DESC"
    ).all(parsed.userId) as Array<Record<string, unknown>>;

    const bills = db.prepare(
      "SELECT * FROM bill_schedules WHERE user_id = ? AND status = 'active' ORDER BY amount DESC"
    ).all(parsed.userId) as Array<Record<string, unknown>>;
    db.close();

    const totalMonthlySubscriptions = subs.reduce((sum, s) => {
      const amount = s.amount as number;
      switch (s.frequency) {
        case 'weekly': return sum + amount * 4.33;
        case 'monthly': return sum + amount;
        case 'quarterly': return sum + amount / 3;
        case 'annual': return sum + amount / 12;
        default: return sum + amount;
      }
    }, 0);

    const suggestions: string[] = [];
    if (subs.length > 5) suggestions.push(`You have ${subs.length} active subscriptions. Review if all are needed.`);
    if (totalMonthlySubscriptions > 200) suggestions.push(`Subscriptions cost $${totalMonthlySubscriptions.toFixed(2)}/mo. Consider reducing.`);
    const annualCandidates = subs.filter(s => s.frequency === 'monthly' && (s.amount as number) > 10);
    if (annualCandidates.length > 0) {
      suggestions.push(`Switch ${annualCandidates.length} monthly subscription(s) to annual billing for potential 15-20% savings.`);
    }

    return {
      success: true,
      data: {
        activeSubscriptions: subs.length,
        activeBills: bills.length,
        totalMonthlySubscriptions: +totalMonthlySubscriptions.toFixed(2),
        totalAnnualSubscriptions: +(totalMonthlySubscriptions * 12).toFixed(2),
        suggestions,
      },
    };
  },
};

export const assistantTools: ToolDefinition[] = [
  manageSubscriptionsTool,
  negotiateBillTool,
  scheduleAppointmentTool,
  storeDocumentTool,
  setPriceAlertTool,
  processReturnTool,
  findDealsTool,
  autoPayOptimizeTool,
];
