// ═══════════════════════════════════════════════════════════════
// PromptPay :: Core Type Definitions
// Fintech-focused type system for 5 payment agents + hooks
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';

// ── Agent Identity ──────────────────────────────────────────

export type AgentRole =
  | 'orchestrator'
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
  // Wallet & uPromptPay (Nexus)
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
  category: 'financial' | 'payment' | 'banking' | 'us_payment' | 'wallet' | 'messaging' | 'system' | 'hooks';
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
  // Hook events
  | 'hook:streak_updated'
  | 'hook:cashback_earned'
  | 'hook:referral_redeemed'
  | 'hook:savings_deposited'
  | 'hook:achievement_unlocked'
  | 'hook:loyalty_earned'
  | 'hook:insight_generated'
  | 'hook:reminder_sent'
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

export type ChannelType = 'telegram' | 'sms' | 'webchat';

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

// ── Governance ──────────────────────────────────────────────

export type AuthorityLevel = 'auto_approve' | 'log_only' | 'require_approval' | 'require_human';

export interface GovernancePolicy {
  riskLevel: ToolDefinition['riskLevel'];
  authority: AuthorityLevel;
  maxAutoApproveValue?: number;
  auditRequired: boolean;
}

// ── Zod Schemas ─────────────────────────────────────────────

export const TaskSchema = z.object({
  type: z.enum([
    'financial_assessment', 'credit_repair', 'self_evaluation', 'custom',
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
