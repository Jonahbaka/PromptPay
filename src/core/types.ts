// ═══════════════════════════════════════════════════════════════
// PromptPay :: Core Type Definitions
// Agentic-first type system — 9 agents (4 agentic + 5 payment) + hooks
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

// ── Agent Identity ──────────────────────────────────────────

export type AgentRole =
  | 'orchestrator'
  // Agentic agents (primary)
  | 'shopping_ops'
  | 'assistant_ops'
  // Payment infrastructure agents
  | 'wallet_ops'
  | 'us_payment_ops'
  | 'payment_ops'
  | 'banking_ops'
  | 'financial_ops';

export type AgentStatus = 'idle' | 'running' | 'blocked' | 'failed' | 'terminated';

export interface AgentIdentity {
  id: string;
  role: AgentRole;
  name: string;
  description: string;
  capabilities: string[];
  spawnedAt: Date;
  parentId: string | null;
}

export interface AgentState {
  identity: AgentIdentity;
  status: AgentStatus;
  currentTask: string | null;
  memoryTokens: number;
  contextWindowUsage: number;
  lastExecution: Date | null;
  executionCount: number;
  errorCount: number;
  metadata: Record<string, unknown>;
}

// ── Task & Execution ────────────────────────────────────────

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskType =
  // Financial
  | 'financial_assessment'
  | 'credit_repair'
  | 'self_evaluation'
  | 'custom'
  // Shopping (Aria)
  | 'shopping_list_create'
  | 'shopping_list_manage'
  | 'shopping_price_compare'
  | 'shopping_order_place'
  | 'shopping_order_track'
  | 'shopping_reorder'
  // Assistant (Otto)
  | 'assistant_subscriptions'
  | 'assistant_negotiate_bill'
  | 'assistant_appointment'
  | 'assistant_document'
  | 'assistant_price_alert'
  | 'assistant_process_return'
  | 'assistant_find_deals'
  | 'assistant_auto_pay'
  // Payments (Mercury)
  | 'payment_initiate'
  | 'payment_status'
  | 'payment_refund'
  | 'payment_providers'
  // Banking (Plutus)
  | 'bank_link'
  | 'bank_data'
  | 'bank_debit'
  // US Payments (Janus)
  | 'us_payment_charge'
  | 'us_payment_subscribe'
  | 'us_payment_connect'
  | 'us_payment_ach'
  | 'us_payment_wallet'
  | 'apple_pay_payment'
  | 'google_pay_payment'
  | 'express_checkout'
  // Wallet & PromptPay (Nexus)
  | 'wallet_topup'
  | 'wallet_transfer'
  | 'wallet_withdraw'
  | 'payment_method_add'
  | 'payment_method_manage'
  | 'bill_schedule'
  | 'bill_pay'
  | 'upromptpay'
  | 'smart_split'
  | 'tx_history'
  // Messaging
  | 'messaging_outbound'
  | 'messaging_inbound'
  // Protocols
  | 'health_check';

export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  title: string;
  description: string;
  assignedAgent: AgentRole | null;
  payload: Record<string, unknown>;
  dependencies: string[];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  result: TaskResult | null;
}

export interface TaskResult {
  success: boolean;
  output: unknown;
  tokensUsed: number;
  executionTimeMs: number;
  subTasksSpawned: string[];
  errors: string[];
}

// ── Tool Definitions ────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  category: 'financial' | 'payment' | 'banking' | 'us_payment' | 'wallet' | 'messaging' | 'system' | 'hooks' | 'agent_network' | 'virality' | 'airtime' | 'merchant' | 'cross_border' | 'shopping' | 'advisory' | 'trading' | 'assistant';
  inputSchema: z.ZodType;
  requiresApproval: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  execute: (input: unknown, context: ExecutionContext) => Promise<ToolResult>;
}

export interface ToolResult {
  success: boolean;
  data: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ExecutionContext {
  agentId: string;
  taskId: string;
  sessionId: string;
  memory: MemoryHandle;
  logger: LoggerHandle;
  tools: Map<string, ToolDefinition>;
}

// ── Memory ──────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  agentId: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'working';
  namespace: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  importance: number;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
}

export interface MemoryHandle {
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'accessedAt' | 'accessCount'>): Promise<string>;
  recall(query: string, namespace?: string, limit?: number): Promise<MemoryEntry[]>;
  forget(id: string): Promise<void>;
  consolidate(): Promise<number>;
}

// ── Event System ────────────────────────────────────────────

export type EventType =
  | 'agent:spawned'
  | 'agent:terminated'
  | 'agent:error'
  | 'task:created'
  | 'task:started'
  | 'task:completed'
  | 'task:failed'
  | 'tool:invoked'
  | 'tool:result'
  | 'memory:stored'
  | 'memory:recalled'
  | 'loop:tick'
  | 'loop:self_eval'
  | 'system:error'
  | 'healing:health_check'
  | 'healing:circuit_break'
  | 'healing:recovery'
  | 'channel:message_in'
  | 'channel:message_out'
  // Payment events
  | 'payment:initiated'
  | 'payment:completed'
  | 'payment:failed'
  | 'payment:refunded'
  // Banking events
  | 'banking:account_linked'
  | 'banking:debit_initiated'
  | 'banking:data_fetched'
  // US Payment events
  | 'us_payment:charged'
  | 'us_payment:subscribed'
  | 'us_payment:ach_sent'
  // Wallet events
  | 'wallet:topup'
  | 'wallet:transfer'
  | 'wallet:withdraw'
  | 'wallet:method_added'
  | 'wallet:method_removed'
  | 'wallet:bill_scheduled'
  | 'wallet:bill_paid'
  | 'wallet:upromptpay'
  | 'wallet:split'
  | 'wallet:pay_forward'
  // Shopping events (Aria)
  | 'shopping:list_created'
  | 'shopping:order_placed'
  | 'shopping:order_tracked'
  | 'shopping:price_compared'
  // Advisory events (Sage)
  | 'advisor:budget_created'
  | 'advisor:spending_analyzed'
  | 'advisor:goal_set'
  | 'advisor:health_scored'
  // Trading events (Quant)
  | 'trading:trade_placed'
  | 'trading:portfolio_updated'
  | 'trading:dca_executed'
  | 'trading:stop_loss_triggered'
  | 'trading:rebalanced'
  // Assistant events (Otto)
  | 'assistant:subscription_managed'
  | 'assistant:bill_negotiated'
  | 'assistant:appointment_scheduled'
  | 'assistant:price_alert_triggered'
  | 'assistant:deal_found'
  // Hook events
  | 'hook:streak_updated'
  | 'hook:cashback_earned'
  | 'hook:referral_redeemed'
  | 'hook:savings_deposited'
  | 'hook:achievement_unlocked'
  | 'hook:loyalty_earned'
  | 'hook:insight_generated'
  | 'hook:reminder_sent'
  // Model routing events
  | 'model:routed'
  | 'model:escalated'
  | 'model:confidence_low'
  | 'model:context_compressed'
  // Admin
  | 'admin:query'
  | 'admin:action';

export interface SystemEvent {
  id: string;
  type: EventType;
  source: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  severity: 'debug' | 'info' | 'warn' | 'error' | 'critical';
}

// ── Self Evaluation ─────────────────────────────────────────

export interface SelfEvaluation {
  id: string;
  timestamp: Date;
  period: { start: Date; end: Date };
  metrics: {
    tasksCompleted: number;
    tasksFailed: number;
    avgExecutionTimeMs: number;
    tokensConsumed: number;
    subAgentsSpawned: number;
    toolInvocations: number;
    memoryOperations: number;
    errorsEncountered: number;
  };
  analysis: string;
  recommendations: string[];
  routingChanges: RoutingChange[];
  applied: boolean;
}

export interface RoutingChange {
  type: 'add_tool' | 'remove_tool' | 'modify_prompt' | 'adjust_priority' | 'spawn_agent' | 'terminate_agent';
  target: string;
  reason: string;
  payload: Record<string, unknown>;
}

// ── Gateway Protocol ────────────────────────────────────────

export interface GatewayMessage {
  id: string;
  type: 'command' | 'query' | 'event' | 'response';
  channel: string;
  payload: Record<string, unknown>;
  timestamp: Date;
  auth?: { token: string; role: string };
}

// ── Logger ──────────────────────────────────────────────────

export interface LoggerHandle {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

// ── Circuit Breaker ─────────────────────────────────────────

export interface CircuitBreakerState {
  toolName: string;
  failureCount: number;
  lastFailure: Date | null;
  state: 'closed' | 'open' | 'half_open';
  openedAt: Date | null;
  cooldownMs: number;
}

// ── Health Check ────────────────────────────────────────────

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs: number;
  message: string;
  timestamp: Date;
}

// ── Channel / Messaging ─────────────────────────────────────

export type ChannelType =
  | 'telegram' | 'sms' | 'webchat'
  | 'whatsapp' | 'signal' | 'viber' | 'line'
  | 'wechat' | 'messenger' | 'slack' | 'discord'
  | 'email' | 'push';

export interface ChannelMessage {
  id: string;
  channelType: ChannelType;
  direction: 'inbound' | 'outbound';
  senderId: string;
  recipientId: string;
  content: string;
  media?: { type: string; url: string };
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface ChannelCapabilities {
  canSendText: boolean;
  canSendMedia: boolean;
  canCreatePolls: boolean;
  canReact: boolean;
  canThread: boolean;
  canVoice: boolean;
  maxMessageLength: number;
}

// ── Payment Types ───────────────────────────────────────────

export type PaymentProvider = 'mpesa' | 'mtn_momo' | 'flutterwave' | 'paystack' | 'razorpay';

export interface PaymentTransaction {
  id: string;
  provider: PaymentProvider;
  externalRef: string;
  amount: number;
  currency: string;
  status: 'pending' | 'success' | 'failed' | 'refunded';
  phoneNumber?: string;
  email?: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  completedAt: Date | null;
}

export type BankingProvider = 'mono' | 'stitch';

export interface BankConnection {
  id: string;
  provider: BankingProvider;
  accountId: string;
  institutionName: string;
  accountType: string;
  currency: string;
  linkedAt: Date;
  lastSyncAt: Date | null;
  status: 'active' | 'disconnected' | 'pending';
}

export type WalletPaymentProvider = 'stripe' | 'mpesa' | 'mtn_momo' | 'flutterwave' | 'paystack' | 'razorpay' | 'mono' | 'stitch';

export interface StoredPaymentMethod {
  id: string;
  userId: string;
  type: 'card' | 'bank_account' | 'mobile_money' | 'upi' | 'wallet';
  provider: WalletPaymentProvider;
  last4: string;
  brand?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
  nickname?: string;
  externalId: string;
  currency: string;
  addedAt: Date;
  lastUsedAt: Date | null;
}

export interface BillSchedule {
  id: string;
  userId: string;
  name: string;
  amount: number;
  currency: string;
  frequency: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'annual';
  nextPaymentDate: string;
  paymentMethodId: string;
  recipientInfo: Record<string, unknown>;
  status: 'active' | 'paused' | 'cancelled';
  createdAt: Date;
  lastPaidAt: Date | null;
  totalPaid: number;
}

export interface WalletAccount {
  id: string;
  userId: string;
  balance: number;
  currency: string;
  status: 'active' | 'frozen' | 'closed';
  createdAt: Date;
  lastTransactionAt: Date | null;
}

export interface PayForwardRule {
  id: string;
  userId: string;
  trigger: 'on_deposit' | 'on_date' | 'on_balance_threshold';
  triggerConfig: Record<string, unknown>;
  action: { type: 'pay' | 'transfer' | 'save'; amount: number; currency: string; recipientInfo: Record<string, unknown> };
  status: 'active' | 'paused';
  executionCount: number;
  createdAt: Date;
}

// ── Engagement Hook Types ───────────────────────────────────

export interface StreakRecord {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string; // YYYY-MM-DD
  multiplier: number;
  streakStartDate: string | null;
  totalStreakDays: number;
}

export interface CashbackRule {
  id: string;
  name: string;
  ruleType: 'merchant' | 'category' | 'amount_tier' | 'global';
  matchPattern: string;
  cashbackPercent: number;
  maxCashbackUsd: number | null;
  minTransactionUsd: number;
  validFrom: string | null;
  validUntil: string | null;
  enabled: boolean;
}

export interface CashbackLedgerEntry {
  id: string;
  userId: string;
  transactionId: string;
  ruleId: string;
  originalAmount: number;
  cashbackAmount: number;
  currency: string;
  status: 'pending' | 'credited' | 'expired';
  creditedAt: string | null;
  createdAt: string;
}

export interface ReferralCode {
  code: string;
  ownerUserId: string;
  usesCount: number;
  maxUses: number;
  bonusUsd: number;
  enabled: boolean;
}

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  currency: string;
  deadline: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
}

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  category: 'payment' | 'savings' | 'social' | 'streak' | 'milestone';
  conditionType: string;
  conditionThreshold: number;
  pointsReward: number;
  cashbackReward: number;
  enabled: boolean;
}

export interface LoyaltyAccount {
  userId: string;
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  tier: 'bronze' | 'silver' | 'gold' | 'platinum';
}

// ── Shopping Domain (Aria) ───────────────────────────────

export interface ShoppingItem {
  id: string;
  listId: string;
  name: string;
  quantity: number;
  unit: string;
  estimatedPrice: number | null;
  actualPrice: number | null;
  purchased: boolean;
  store: string | null;
  notes: string | null;
}

export interface ShoppingList {
  id: string;
  userId: string;
  name: string;
  items: ShoppingItem[];
  status: 'active' | 'completed' | 'archived';
  totalEstimated: number;
  totalActual: number;
  createdAt: Date;
  updatedAt: Date;
}

// ── Trading Domain (Quant) ──────────────────────────────

export interface TradingPosition {
  id: string;
  portfolioId: string;
  symbol: string;
  type: 'stock' | 'crypto' | 'etf';
  quantity: number;
  avgCostBasis: number;
  currentPrice: number | null;
  unrealizedPnl: number | null;
  openedAt: Date;
}

export interface TradingOrder {
  id: string;
  portfolioId: string;
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop_loss';
  quantity: number;
  price: number | null;
  status: 'pending' | 'filled' | 'cancelled' | 'rejected';
  paperTrade: boolean;
  filledAt: Date | null;
  createdAt: Date;
}

export interface TradingPortfolio {
  id: string;
  userId: string;
  name: string;
  cashBalance: number;
  totalValue: number;
  positions: TradingPosition[];
  paperMode: boolean;
  createdAt: Date;
}

// ── Advisory Domain (Sage) ──────────────────────────────

export interface BudgetCategory {
  id: string;
  budgetId: string;
  name: string;
  allocatedAmount: number;
  spentAmount: number;
}

export interface Budget {
  id: string;
  userId: string;
  name: string;
  totalAmount: number;
  period: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  categories: BudgetCategory[];
  startDate: string;
  endDate: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: Date;
}

// ── Assistant Domain (Otto) ─────────────────────────────

export interface Subscription {
  id: string;
  userId: string;
  serviceName: string;
  amount: number;
  currency: string;
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  nextBillingDate: string;
  category: string;
  status: 'active' | 'paused' | 'cancelled';
  createdAt: Date;
}

export interface StoredDocument {
  id: string;
  userId: string;
  name: string;
  type: string;
  category: 'receipt' | 'warranty' | 'contract' | 'insurance' | 'tax' | 'other';
  content: string;
  metadata: Record<string, unknown>;
  expiresAt: string | null;
  createdAt: Date;
}

export interface PriceAlert {
  id: string;
  userId: string;
  productName: string;
  targetPrice: number;
  currentPrice: number | null;
  sourceUrl: string | null;
  status: 'active' | 'triggered' | 'expired';
  createdAt: Date;
  triggeredAt: Date | null;
}

// ── Multi-Model Orchestration ────────────────────────────────

export type ModelTier = 'economy' | 'premium';
export type ModelProvider = 'deepseek' | 'anthropic' | 'openai' | 'google';

export type EscalationReason =
  | 'complex_reasoning'
  | 'multi_step_planning'
  | 'advanced_trading'
  | 'ambiguous_instruction'
  | 'high_risk_action'
  | 'compliance_reasoning'
  | 'long_form_summary'
  | 'low_confidence';

export type TransactionAction =
  | 'transfer'
  | 'trade'
  | 'buy'
  | 'sell'
  | 'deposit'
  | 'withdraw'
  | 'balance_check';

export interface TransactionIntent {
  action: TransactionAction;
  parameters: Record<string, unknown>;
  confidence_score: number;
}

export interface ModelRoutingDecision {
  provider: ModelProvider;
  model: string;
  tier: ModelTier;
  reason: string;
  escalatedFrom?: ModelProvider;
  escalationReason?: EscalationReason;
}

export interface ConfidenceResult {
  score: number;
  intent: TransactionIntent | null;
  requiresEscalation: boolean;
  escalationReason: EscalationReason | null;
  rawResponse: string;
}

export type SubscriptionTier = 'free' | 'premium' | 'enterprise';

export interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  premiumModelsEnabled: boolean;
  maxContextTokens: number;
  maxResponseTokens: number;
}

// ── Governance ──────────────────────────────────────────────

export type AuthorityLevel = 'auto_approve' | 'log_only' | 'require_approval' | 'require_human';

export interface GovernancePolicy {
  riskLevel: ToolDefinition['riskLevel'];
  authority: AuthorityLevel;
  maxAutoApproveValue?: number;
  auditRequired: boolean;
}

// ── Access Control & Multi-Tenancy ──────────────────────────

export type UserRole = 'owner' | 'partner_admin' | 'user';
export type TenantStatus = 'pending' | 'active' | 'suspended' | 'deactivated';

export type CommunicationChannel =
  | 'whatsapp' | 'telegram' | 'sms' | 'signal' | 'viber'
  | 'line' | 'wechat' | 'messenger' | 'slack' | 'discord'
  | 'email' | 'push';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  displayName: string;
  logoUrl: string | null;
  primaryColor: string;
  contactEmail: string;
  contactPhone: string | null;
  status: TenantStatus;
  tier: 'standard' | 'premium' | 'enterprise';
  config: Record<string, unknown>;
  createdAt: string;
  activatedAt: string | null;
  updatedAt: string;
}

export interface User {
  id: string;
  tenantId: string | null;
  email: string;
  displayName: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'deactivated';
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  userId: string;
  aiModelApiKey: string | null;
  aiModelProvider: string;
  aiModelName: string | null;
  preferredChannels: CommunicationChannel[];
  notificationEnabled: boolean;
  language: string;
  timezone: string;
  metadata: Record<string, unknown>;
}

export interface AuthPayload {
  userId: string;
  tenantId: string | null;
  role: UserRole;
  exp: number;
}

// ── Zod Schemas ─────────────────────────────────────────────

export const TaskSchema = z.object({
  type: z.enum([
    'financial_assessment', 'credit_repair', 'self_evaluation', 'custom',
    // Shopping (Aria)
    'shopping_list_create', 'shopping_list_manage', 'shopping_price_compare',
    'shopping_order_place', 'shopping_order_track', 'shopping_reorder',
    // Assistant (Otto)
    'assistant_subscriptions', 'assistant_negotiate_bill', 'assistant_appointment',
    'assistant_document', 'assistant_price_alert', 'assistant_process_return',
    'assistant_find_deals', 'assistant_auto_pay',
    // Payment infrastructure
    'payment_initiate', 'payment_status', 'payment_refund', 'payment_providers',
    'bank_link', 'bank_data', 'bank_debit',
    'us_payment_charge', 'us_payment_subscribe', 'us_payment_connect',
    'us_payment_ach', 'us_payment_wallet',
    'apple_pay_payment', 'google_pay_payment', 'express_checkout',
    'wallet_topup', 'wallet_transfer', 'wallet_withdraw',
    'payment_method_add', 'payment_method_manage',
    'bill_schedule', 'bill_pay', 'upromptpay', 'smart_split', 'tx_history',
    'messaging_outbound', 'messaging_inbound', 'health_check',
  ]),
  priority: z.enum(['critical', 'high', 'medium', 'low']),
  title: z.string().min(1),
  description: z.string(),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});
