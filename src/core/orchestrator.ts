// ═══════════════════════════════════════════════════════════════
// PromptPay :: Core Orchestrator
// Primary Claude 4.6 Opus node — 5 payment agents, 45 tools
// ═══════════════════════════════════════════════════════════════

import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import fs from 'fs';
import {
  AgentIdentity, AgentState, AgentRole, AgentStatus,
  Task, TaskResult, TaskType, TaskPriority,
  ToolDefinition, ToolResult, ExecutionContext,
  MemoryHandle,
  SystemEvent, EventType, SelfEvaluation,
  type LoggerHandle,
} from './types.js';
import { CONFIG } from './config.js';

// ── Event Bus ───────────────────────────────────────────────

type OrchestratorEvents = {
  [K in EventType]: (event: SystemEvent) => void;
} & {
  'ready': () => void;
  'shutdown': () => void;
};

// ── Sub-Agent Definition ────────────────────────────────────

interface SubAgentConfig {
  role: AgentRole;
  name: string;
  description: string;
  systemPromptOverride?: string;
  capabilities: string[];
  tools: string[];
  maxTokens?: number;
  temperature?: number;
}

const SUB_AGENT_CONFIGS: Record<string, SubAgentConfig> = {
  wallet_ops: {
    role: 'wallet_ops',
    name: 'Nexus',
    description: 'User payment hub — card/bank management, recurring bill autopay, wallet (P2P transfers, top-up, withdraw), transaction history, uPromptPay, smart split, pay forward',
    capabilities: ['add_card', 'remove_card', 'set_default', 'bill_autopay', 'wallet_topup', 'wallet_transfer', 'wallet_withdraw', 'transaction_history', 'upromptpay', 'smart_split', 'pay_forward'],
    tools: ['add_payment_method', 'list_payment_methods', 'remove_payment_method', 'set_default_payment_method', 'create_bill_schedule', 'list_bill_schedules', 'cancel_bill_schedule', 'bill_pay_now', 'wallet_topup', 'wallet_transfer', 'wallet_withdraw', 'transaction_history', 'upromptpay', 'smart_split', 'pay_forward'],
    temperature: 0.2,
  },
  us_payment_ops: {
    role: 'us_payment_ops',
    name: 'Janus',
    description: 'US payment operations via Stripe — charges, subscriptions, Connect onboarding, ACH transfers, Apple Pay, Google Pay, wallet balance',
    capabilities: ['stripe_charge', 'subscriptions', 'connect_onboarding', 'ach_transfers', 'apple_pay', 'google_pay', 'payment_requests', 'wallet_balance'],
    tools: ['stripe_charge', 'stripe_subscription', 'stripe_connect_onboard', 'ach_transfer', 'apple_pay_session', 'google_pay_token', 'payment_request_api', 'wallet_balance', 'apple_pay_complete_payment', 'apple_pay_subscription', 'apple_pay_express_checkout', 'google_pay_complete_payment'],
    temperature: 0.1,
  },
  payment_ops: {
    role: 'payment_ops',
    name: 'Mercury',
    description: 'Mobile POS payments for Africa & India — M-Pesa, MTN MoMo, Flutterwave, Paystack, Razorpay',
    capabilities: ['mpesa_payments', 'mtn_momo_payments', 'flutterwave_payments', 'paystack_payments', 'razorpay_payments', 'payment_status', 'refunds'],
    tools: ['mpesa_stk_push', 'mtn_momo_request_to_pay', 'flutterwave_charge', 'paystack_initialize', 'razorpay_create_order', 'payment_status_check', 'payment_refund', 'payment_providers_status'],
    temperature: 0.1,
  },
  banking_ops: {
    role: 'banking_ops',
    name: 'Plutus',
    description: 'Open banking — Mono (Nigeria) and Stitch (South Africa) for account linking, balance/transaction data, and direct debit',
    capabilities: ['account_linking', 'balance_inquiry', 'transaction_history', 'direct_debit', 'identity_verification', 'income_verification'],
    tools: ['mono_link_account', 'mono_get_account_data', 'mono_initiate_debit', 'stitch_link_account', 'stitch_get_account_data', 'banking_providers_status'],
    temperature: 0.1,
  },
  financial_ops: {
    role: 'financial_ops',
    name: 'Atlas',
    description: 'Financial operations for credit assessment, dispute automation, and payment optimization',
    capabilities: ['credit_assessment', 'dispute_filing', 'payment_plan', 'insurance_eligibility'],
    tools: ['credit_bureau_api', 'dispute_form_filler', 'payment_calculator', 'insurance_checker'],
    temperature: 0.2,
  },
};

// ── Orchestrator ────────────────────────────────────────────

export class Orchestrator extends EventEmitter<OrchestratorEvents> {
  private client: Anthropic;
  private systemPrompt: string;
  private agents: Map<string, AgentState> = new Map();
  private tasks: Map<string, Task> = new Map();
  private tools: Map<string, ToolDefinition> = new Map();
  private conversationHistory: Anthropic.MessageParam[] = [];
  private executionLog: SystemEvent[] = [];
  private selfEvaluations: SelfEvaluation[] = [];
  private isRunning = false;
  private logger: LoggerHandle;
  private identity: AgentIdentity;
  private memoryHandle: MemoryHandle | null = null;

  constructor(logger: LoggerHandle) {
    super();
    this.logger = logger;
    this.client = new Anthropic({ apiKey: CONFIG.anthropic.apiKey });

    try {
      this.systemPrompt = fs.readFileSync(CONFIG.systemPrompt.path, 'utf-8');
    } catch {
      this.systemPrompt = 'You are PromptPay Operations Intelligence. Manage all financial operations autonomously.';
      this.logger.warn('System prompt file not found, using default');
    }

    this.identity = {
      id: uuid(),
      role: 'orchestrator',
      name: 'POI',
      description: 'PromptPay Operations Intelligence — Primary Orchestrator Node',
      capabilities: ['routing', 'sub_agent_spawning', 'self_evaluation', 'task_management'],
      spawnedAt: new Date(),
      parentId: null,
    };

    this.logger.info(`Orchestrator initialized: ${this.identity.id}`);
  }

  // ── Memory Injection ───────────────────────────────────

  setMemoryHandle(handle: MemoryHandle): void {
    this.memoryHandle = handle;
    this.logger.info('Memory handle injected into orchestrator');
  }

  // ── Tool Registration ───────────────────────────────────

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
    this.logger.info(`Tool registered: ${tool.name} [${tool.category}] risk=${tool.riskLevel}`);
    this.emitEvent('tool:invoked', { tool: tool.name, action: 'registered' });
  }

  registerTools(tools: ToolDefinition[]): void {
    tools.forEach(t => this.registerTool(t));
  }

  // ── Task Management ─────────────────────────────────────

  createTask(type: TaskType, priority: TaskPriority, title: string, description = '', payload: Record<string, unknown> = {}): Task {
    const task: Task = {
      id: uuid(), type, priority, title, description,
      assignedAgent: null, payload, dependencies: [],
      createdAt: new Date(), startedAt: null, completedAt: null, result: null,
    };
    this.tasks.set(task.id, task);
    this.emitEvent('task:created', { taskId: task.id, type, title, priority });
    this.logger.info(`Task created: [${priority}] ${title} (${task.id})`);
    return task;
  }

  // ── Core Execution ────────────────────────────────────────

  async executeTask(task: Task): Promise<TaskResult> {
    const start = Date.now();
    task.startedAt = new Date();
    this.emitEvent('task:started', { taskId: task.id });

    try {
      const agentRole = this.routeTask(task);
      task.assignedAgent = agentRole;
      this.logger.info(`Task ${task.id} routed to ${agentRole}`);

      const result = agentRole === 'orchestrator'
        ? await this.executeDirect(task)
        : await this.spawnSubAgent(agentRole, task);

      task.completedAt = new Date();
      task.result = result;
      result.executionTimeMs = Date.now() - start;

      if (result.success) {
        this.emitEvent('task:completed', { taskId: task.id, result });
        this.logger.info(`Task ${task.id} completed in ${result.executionTimeMs}ms`);
      } else {
        this.emitEvent('task:failed', { taskId: task.id, errors: result.errors });
        this.logger.error(`Task ${task.id} failed: ${result.errors.join(', ')}`);
      }

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const result: TaskResult = {
        success: false, output: null, tokensUsed: 0,
        executionTimeMs: Date.now() - start, subTasksSpawned: [], errors: [error],
      };
      task.result = result;
      task.completedAt = new Date();
      this.emitEvent('task:failed', { taskId: task.id, errors: [error] });
      this.logger.error(`Task ${task.id} threw: ${error}`);
      return result;
    }
  }

  // ── Task Routing ──────────────────────────────────────────

  private routeTask(task: Task): AgentRole {
    const routing: Record<TaskType, AgentRole> = {
      // Financial
      financial_assessment: 'financial_ops',
      credit_repair: 'financial_ops',
      // Payments (Mercury)
      payment_initiate: 'payment_ops',
      payment_status: 'payment_ops',
      payment_refund: 'payment_ops',
      payment_providers: 'payment_ops',
      // Banking (Plutus)
      bank_link: 'banking_ops',
      bank_data: 'banking_ops',
      bank_debit: 'banking_ops',
      // US Payments (Janus)
      us_payment_charge: 'us_payment_ops',
      us_payment_subscribe: 'us_payment_ops',
      us_payment_connect: 'us_payment_ops',
      us_payment_ach: 'us_payment_ops',
      us_payment_wallet: 'us_payment_ops',
      apple_pay_payment: 'us_payment_ops',
      google_pay_payment: 'us_payment_ops',
      express_checkout: 'us_payment_ops',
      // Wallet (Nexus)
      wallet_topup: 'wallet_ops',
      wallet_transfer: 'wallet_ops',
      wallet_withdraw: 'wallet_ops',
      payment_method_add: 'wallet_ops',
      payment_method_manage: 'wallet_ops',
      bill_schedule: 'wallet_ops',
      bill_pay: 'wallet_ops',
      upromptpay: 'wallet_ops',
      smart_split: 'wallet_ops',
      tx_history: 'wallet_ops',
      // Messaging
      messaging_outbound: 'orchestrator',
      messaging_inbound: 'orchestrator',
      // System
      self_evaluation: 'orchestrator',
      health_check: 'orchestrator',
      custom: 'orchestrator',
    };
    return routing[task.type] || 'orchestrator';
  }

  // ── Direct Execution ──────────────────────────────────────

  /** Resolve which model to use based on task context */
  private resolveModel(task: Task): { model: string; maxTokens: number } {
    // Partner bank custom AI model
    if (task.payload?.tenantAiModel) {
      return { model: task.payload.tenantAiModel as string, maxTokens: CONFIG.anthropic.maxTokens };
    }

    const isUserTask = task.payload?.userInitiated;
    if (isUserTask) {
      return { model: CONFIG.anthropic.userModel, maxTokens: CONFIG.anthropic.userMaxTokens };
    }
    return { model: CONFIG.anthropic.adminModel, maxTokens: CONFIG.anthropic.maxTokens };
  }

  private async executeDirect(task: Task): Promise<TaskResult> {
    const toolDefs = this.getAnthropicTools();
    const { model, maxTokens } = this.resolveModel(task);

    const messages: Anthropic.MessageParam[] = [
      ...this.conversationHistory.slice(-20),
      {
        role: 'user',
        content: `TASK [${task.priority.toUpperCase()}]: ${task.title}\n\n${task.description}\n\nPayload: ${JSON.stringify(task.payload, null, 2)}`,
      },
    ];

    const response = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: CONFIG.anthropic.temperature,
      system: this.systemPrompt,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      messages,
    });

    const subTasksSpawned: string[] = [];
    let output: unknown = null;

    for (const block of response.content) {
      if (block.type === 'text') {
        output = block.text;
      } else if (block.type === 'tool_use') {
        const tool = this.tools.get(block.name);
        if (tool) {
          const ctx = this.createContext(task);
          await tool.execute(block.input, ctx);
        }
      }
    }

    this.conversationHistory.push({ role: 'user', content: task.description });
    this.conversationHistory.push({ role: 'assistant', content: typeof output === 'string' ? output : JSON.stringify(output) });

    return {
      success: true, output,
      tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      executionTimeMs: 0, subTasksSpawned, errors: [],
    };
  }

  // ── Sub-Agent Spawning ────────────────────────────────────

  private async spawnSubAgent(role: AgentRole, task: Task): Promise<TaskResult> {
    const config = SUB_AGENT_CONFIGS[role];
    if (!config) {
      return { success: false, output: null, tokensUsed: 0, executionTimeMs: 0, subTasksSpawned: [], errors: [`No config for role: ${role}`] };
    }

    const agentId = uuid();
    const agentState: AgentState = {
      identity: {
        id: agentId, role: config.role, name: config.name,
        description: config.description, capabilities: config.capabilities,
        spawnedAt: new Date(), parentId: this.identity.id,
      },
      status: 'running', currentTask: task.id, memoryTokens: 0,
      contextWindowUsage: 0, lastExecution: new Date(),
      executionCount: 0, errorCount: 0, metadata: {},
    };

    this.agents.set(agentId, agentState);
    this.emitEvent('agent:spawned', { agentId, role, name: config.name, taskId: task.id });
    this.logger.info(`Sub-agent spawned: ${config.name} (${agentId}) for task ${task.id}`);

    try {
      const subPrompt = `[AGENT::${config.role.toUpperCase()} | NAME::${config.name}]

You are ${config.name}, a specialized sub-agent of PromptPay Operations Intelligence.
Role: ${config.description}
Capabilities: ${config.capabilities.join(', ')}
Available tools: ${config.tools.join(', ')}

Execute the given task with precision.`;

      const subTools = this.getAnthropicToolsForAgent(config.tools);
      const resolved = this.resolveModel(task);

      const response = await this.client.messages.create({
        model: resolved.model,
        max_tokens: config.maxTokens || resolved.maxTokens,
        temperature: config.temperature ?? CONFIG.anthropic.temperature,
        system: subPrompt,
        tools: subTools.length > 0 ? subTools : undefined,
        messages: [{
          role: 'user',
          content: `Execute: ${task.title}\n\n${task.description}\nPriority: ${task.priority}\nPayload: ${JSON.stringify(task.payload, null, 2)}`,
        }],
      });

      let output: unknown = null;
      for (const block of response.content) {
        if (block.type === 'text') {
          output = block.text;
        } else if (block.type === 'tool_use') {
          const tool = this.tools.get(block.name);
          if (tool) {
            const ctx = this.createContext(task, agentId);
            await tool.execute(block.input, ctx);
          }
        }
      }

      agentState.status = 'idle';
      agentState.executionCount++;
      agentState.lastExecution = new Date();

      return {
        success: true, output,
        tokensUsed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        executionTimeMs: 0, subTasksSpawned: [], errors: [],
      };
    } catch (err) {
      agentState.status = 'failed';
      agentState.errorCount++;
      const error = err instanceof Error ? err.message : String(err);
      this.emitEvent('agent:error', { agentId, error });
      return { success: false, output: null, tokensUsed: 0, executionTimeMs: 0, subTasksSpawned: [], errors: [error] };
    }
  }

  // ── Anthropic Tool Conversion ─────────────────────────────

  private getAnthropicTools(): Anthropic.Tool[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name, description: t.description,
      input_schema: { type: 'object' as const, properties: {} },
    }));
  }

  private getAnthropicToolsForAgent(toolNames: string[]): Anthropic.Tool[] {
    return toolNames
      .map(name => this.tools.get(name))
      .filter((t): t is ToolDefinition => !!t)
      .map(t => ({
        name: t.name, description: t.description,
        input_schema: { type: 'object' as const, properties: {} },
      }));
  }

  // ── Context Factory ───────────────────────────────────────

  private createContext(task: Task, agentId?: string): ExecutionContext {
    const noopMemory: MemoryHandle = {
      store: async () => '', recall: async () => [],
      forget: async () => {}, consolidate: async () => 0,
    };

    return {
      agentId: agentId || this.identity.id,
      taskId: task.id, sessionId: uuid(),
      memory: this.memoryHandle || noopMemory,
      logger: this.logger, tools: this.tools,
    };
  }

  // ── Event Emission ────────────────────────────────────────

  private emitEvent(type: EventType, payload: Record<string, unknown>, severity: SystemEvent['severity'] = 'info'): void {
    const event: SystemEvent = {
      id: uuid(), type, source: this.identity.id,
      timestamp: new Date(), payload, severity,
    };
    this.executionLog.push(event);
    this.emit(type, event);
  }

  // ── Self-Evaluation ───────────────────────────────────────

  async runSelfEvaluation(): Promise<SelfEvaluation> {
    this.logger.info('Starting self-evaluation cycle...');

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 86400000);

    const recentEvents = this.executionLog.filter(e => e.timestamp >= oneDayAgo);
    const tasksCompleted = recentEvents.filter(e => e.type === 'task:completed').length;
    const tasksFailed = recentEvents.filter(e => e.type === 'task:failed').length;
    const subAgentsSpawned = recentEvents.filter(e => e.type === 'agent:spawned').length;
    const toolInvocations = recentEvents.filter(e => e.type === 'tool:invoked').length;
    const errors = recentEvents.filter(e => e.type === 'system:error' || e.type === 'agent:error').length;

    const response = await this.client.messages.create({
      model: CONFIG.anthropic.adminModel,
      max_tokens: 4096,
      temperature: 0.5,
      system: 'You are performing a metacognitive self-evaluation of PromptPay financial operations. Be ruthlessly honest.',
      messages: [{
        role: 'user',
        content: `24h metrics: ${tasksCompleted} completed, ${tasksFailed} failed, ${subAgentsSpawned} agents spawned, ${toolInvocations} tool calls, ${errors} errors.\n\nAnalyze performance, identify bottlenecks, and recommend optimizations.`,
      }],
    });

    const analysis = response.content.find(b => b.type === 'text')?.text || 'No analysis generated.';

    const evaluation: SelfEvaluation = {
      id: uuid(), timestamp: now,
      period: { start: oneDayAgo, end: now },
      metrics: {
        tasksCompleted, tasksFailed, avgExecutionTimeMs: 0,
        tokensConsumed: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
        subAgentsSpawned, toolInvocations, memoryOperations: 0, errorsEncountered: errors,
      },
      analysis, recommendations: [], routingChanges: [], applied: false,
    };

    this.selfEvaluations.push(evaluation);
    this.emitEvent('loop:self_eval', { evaluationId: evaluation.id });
    this.logger.info(`Self-evaluation complete: ${evaluation.id}`);
    return evaluation;
  }

  // ── State Queries ─────────────────────────────────────────

  getState(): {
    identity: AgentIdentity; isRunning: boolean;
    agentCount: number; taskCount: number; toolCount: number; eventCount: number;
  } {
    return {
      identity: this.identity, isRunning: this.isRunning,
      agentCount: this.agents.size, taskCount: this.tasks.size,
      toolCount: this.tools.size, eventCount: this.executionLog.length,
    };
  }

  getAgents(): AgentState[] { return Array.from(this.agents.values()); }
  getTasks(): Task[] { return Array.from(this.tasks.values()); }
  getExecutionLog(limit = 100): SystemEvent[] { return this.executionLog.slice(-limit); }
  getSelfEvaluations(): SelfEvaluation[] { return this.selfEvaluations; }

  // ── Lifecycle ─────────────────────────────────────────────

  start(): void {
    this.isRunning = true;
    this.logger.info('Orchestrator ONLINE');
    this.emit('ready');
  }

  stop(): void {
    this.isRunning = false;
    this.logger.info('Orchestrator OFFLINE');
    this.emit('shutdown');
  }
}
