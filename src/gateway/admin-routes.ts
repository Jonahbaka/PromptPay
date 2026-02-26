// ═══════════════════════════════════════════════════════════════
// PromptPay :: Admin Portal (23 Routes)
// Dashboard, agents, tasks, audit, hooks, providers, health
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import type { LoggerHandle } from '../core/types.js';
import type { AuditTrail } from '../protocols/audit-trail.js';
import type { CircuitBreakerRegistry } from '../healing/circuit-breaker.js';
import type { ChannelManager } from '../channels/manager.js';
import type { HookEngine } from '../hooks/engine.js';
import type { FeeEngine } from '../hooks/fees.js';
import type { DaemonLoop } from '../daemon/loop.js';
import type { MemoryStore } from '../memory/store.js';
import { authenticate, requireRole, getTenantFilter } from '../auth/middleware.js';
import { readFileSync } from 'fs';
import path from 'path';
import { CONFIG } from '../core/config.js';

const EXECUTIVE_PERSONAS: Record<string, string> = {
  ceo: 'CEO',
  cfo: 'CFO',
  analyst: 'Financial Analyst',
  economist: 'Economist',
  cto: 'CTO',
  growth: 'Growth Lead',
};

function gatherPlatformContext(deps: AdminDependencies) {
  const db = deps.memory.getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  const activeToday = (db.prepare("SELECT COUNT(DISTINCT id) as c FROM users WHERE last_login_at >= date('now')").get() as { c: number }).c;
  const txCount = (db.prepare('SELECT COUNT(*) as c FROM fee_ledger').get() as { c: number }).c;

  const agents = db.prepare('SELECT * FROM agent_accounts WHERE status = ?').all('active') as Array<Record<string, unknown>>;
  const totalFloat = agents.reduce((sum, a) => sum + ((a.float_balance as number) || 0), 0);
  const totalCommissions = agents.reduce((sum, a) => sum + ((a.commission_earned as number) || 0), 0);

  const xbTransfers = db.prepare('SELECT COUNT(*) as c FROM cross_border_transfers').get() as { c: number };

  const events = deps.orchestrator.getExecutionLog(500) as Array<Record<string, unknown>>;
  const toolInvocations = events.filter(e => e.type === 'tool:result');
  const toolSuccesses = toolInvocations.filter(e => (e.payload as Record<string, unknown>)?.success).length;

  return {
    users: { total: userCount, activeToday },
    revenue: {
      today: deps.feeEngine.getRevenueSummary('today'),
      thisMonth: deps.feeEngine.getRevenueSummary('month'),
    },
    transactions: { totalRecorded: txCount },
    agentNetwork: { activeAgents: agents.length, totalFloat, totalCommissions },
    crossBorder: { totalTransfers: xbTransfers.c },
    toolHealth: {
      totalInvocations: toolInvocations.length,
      successRate: toolInvocations.length > 0 ? Math.round((toolSuccesses / toolInvocations.length) * 100) : 100,
    },
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      circuitBreakers: deps.circuitBreakers.getState().map(b => ({ tool: b.toolName, state: b.state, failures: b.failureCount })),
      memoryStats: deps.memory.getStats(),
    },
    feeConfig: CONFIG.fees,
    platformVersion: CONFIG.platform.version,
  };
}

async function callDeepSeek(systemPrompt: string, messages: Array<{ role: string; content: string }>): Promise<{ text: string; usage: { input: number; output: number } }> {
  const res = await fetch(`${CONFIG.deepseek.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.deepseek.apiKey}`,
    },
    body: JSON.stringify({
      model: CONFIG.deepseek.model,
      max_tokens: CONFIG.deepseek.maxTokens,
      temperature: CONFIG.deepseek.temperature,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`DeepSeek API error ${res.status}: ${errBody}`);
  }

  const data = await res.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    text: data.choices[0]?.message?.content || '',
    usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 },
  };
}

export interface AdminDependencies {
  orchestrator: {
    getState(): unknown;
    getAgents(): unknown[];
    getTasks(): unknown[];
    getExecutionLog(limit?: number): unknown[];
    getSelfEvaluations(): unknown[];
  };
  memory: MemoryStore;
  auditTrail: AuditTrail;
  hookEngine: HookEngine;
  circuitBreakers: CircuitBreakerRegistry;
  channelManager: ChannelManager;
  feeEngine: FeeEngine;
  daemon: DaemonLoop;
  config: Record<string, unknown>;
  logger: LoggerHandle;
}

export function createAdminRoutes(deps: AdminDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // All admin routes require authentication + owner or partner_admin role
  router.use('/admin', authenticate, requireRole('owner', 'partner_admin'));

  // ═══════════════════════════════════════════════════════
  // 1. GET /admin/dashboard — Full dashboard summary
  // ═══════════════════════════════════════════════════════
  router.get('/admin/dashboard', (req: Request, res: Response) => {
    const tenantId = getTenantFilter(req.auth!);
    const state = deps.orchestrator.getState();
    const memStats = deps.memory.getStats();
    const hookStats = deps.hookEngine.getStats();
    const channels = deps.channelManager.getStatus();
    const breakers = deps.circuitBreakers.getState();
    const auditCount = deps.auditTrail.getCount();

    // Partner count (owner only)
    let partnerStats = null;
    if (!tenantId) {
      const row = db.prepare(`
        SELECT COUNT(*) as total,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
          COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending
        FROM tenants
      `).get() as Record<string, number>;
      const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
      partnerStats = { ...row, totalUsers: userCount };
    }

    res.json({
      platform: 'PromptPay',
      version: '1.1.0',
      domain: 'https://www.upromptpay.com',
      uptime: process.uptime(),
      orchestrator: state,
      memory: memStats,
      hooks: hookStats,
      channels,
      circuitBreakers: breakers.map(b => ({ name: b.toolName, state: b.state, failures: b.failureCount })),
      auditEntries: auditCount,
      partners: partnerStats,
      role: req.auth!.role,
      tenantId,
    });
  });

  // ═══════════════════════════════════════════════════════
  // 2. GET /admin/agents — All 5 agents with status
  // ═══════════════════════════════════════════════════════
  router.get('/admin/agents', (_req: Request, res: Response) => {
    const agents = deps.orchestrator.getAgents() as Array<Record<string, unknown>>;
    res.json({
      count: agents.length,
      agents,
      registeredRoles: ['wallet_ops', 'us_payment_ops', 'payment_ops', 'banking_ops', 'financial_ops'],
    });
  });

  // ═══════════════════════════════════════════════════════
  // 3. GET /admin/agents/:role — Single agent + recent events
  // ═══════════════════════════════════════════════════════
  router.get('/admin/agents/:role', (req: Request, res: Response) => {
    const role = String(req.params.role);
    const agents = deps.orchestrator.getAgents() as Array<Record<string, unknown>>;
    const agent = agents.find((a) => {
      const identity = a.identity as Record<string, unknown> | undefined;
      return identity?.role === role;
    });

    const events = (deps.orchestrator.getExecutionLog(500) as Array<Record<string, unknown>>)
      .filter(e => {
        const payload = e.payload as Record<string, unknown> | undefined;
        return payload?.role === role || payload?.agentId === role;
      })
      .slice(-20);

    res.json({ role, agent: agent || null, recentEvents: events });
  });

  // ═══════════════════════════════════════════════════════
  // 4. GET /admin/tasks — Task queue with filters
  // ═══════════════════════════════════════════════════════
  router.get('/admin/tasks', (req: Request, res: Response) => {
    let tasks = deps.orchestrator.getTasks() as Array<Record<string, unknown>>;
    const status = req.query.status as string | undefined;
    const type = req.query.type as string | undefined;

    if (status) tasks = tasks.filter(t => t.status === status);
    if (type) tasks = tasks.filter(t => t.type === type);

    res.json({ count: tasks.length, tasks });
  });

  // ═══════════════════════════════════════════════════════
  // 5. GET /admin/tasks/:id — Task detail + execution trace
  // ═══════════════════════════════════════════════════════
  router.get('/admin/tasks/:id', (req: Request, res: Response) => {
    const taskId = String(req.params.id);
    const tasks = deps.orchestrator.getTasks() as Array<Record<string, unknown>>;
    const task = tasks.find(t => t.id === taskId);

    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const events = (deps.orchestrator.getExecutionLog(1000) as Array<Record<string, unknown>>)
      .filter(e => {
        const payload = e.payload as Record<string, unknown> | undefined;
        return payload?.taskId === taskId;
      });

    res.json({ task, executionTrace: events });
  });

  // ═══════════════════════════════════════════════════════
  // 6. GET /admin/audit — Paginated audit trail
  // ═══════════════════════════════════════════════════════
  router.get('/admin/audit', (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit || '50'));
    const entries = deps.auditTrail.getRecent(limit);

    res.json({
      count: entries.length,
      totalEntries: deps.auditTrail.getCount(),
      entries,
    });
  });

  // ═══════════════════════════════════════════════════════
  // 7. GET /admin/audit/verify — Hash chain integrity check
  // ═══════════════════════════════════════════════════════
  router.get('/admin/audit/verify', (_req: Request, res: Response) => {
    const result = deps.auditTrail.verifyChain();
    res.json(result);
  });

  // ═══════════════════════════════════════════════════════
  // 8. GET /admin/health — Health report
  // ═══════════════════════════════════════════════════════
  router.get('/admin/health', (_req: Request, res: Response) => {
    const state = deps.orchestrator.getState() as Record<string, unknown>;
    const breakers = deps.circuitBreakers.getState();
    const channels = deps.channelManager.getStatus();
    const memStats = deps.memory.getStats();

    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      orchestrator: { isRunning: state.isRunning, tools: state.toolCount },
      circuitBreakers: breakers,
      channels,
      memory: memStats,
    });
  });

  // ═══════════════════════════════════════════════════════
  // 9. GET /admin/health/circuit-breakers — All breaker states
  // ═══════════════════════════════════════════════════════
  router.get('/admin/health/circuit-breakers', (_req: Request, res: Response) => {
    res.json(deps.circuitBreakers.getState());
  });

  // ═══════════════════════════════════════════════════════
  // 10. POST /admin/health/circuit-breakers/:name/reset
  // ═══════════════════════════════════════════════════════
  router.post('/admin/health/circuit-breakers/:name/reset', (req: Request, res: Response) => {
    const name = String(req.params.name);
    deps.circuitBreakers.reset(name);
    deps.auditTrail.record('admin', 'circuit_breaker_reset', name, {});
    res.json({ success: true, message: `Circuit breaker ${name} reset` });
  });

  // ═══════════════════════════════════════════════════════
  // 11. GET /admin/hooks/streaks — Streak leaderboard + stats
  // ═══════════════════════════════════════════════════════
  router.get('/admin/hooks/streaks', (_req: Request, res: Response) => {
    const stats = deps.hookEngine.streaks.getStats();
    const leaderboard = deps.hookEngine.streaks.getLeaderboard(20);
    res.json({ stats, leaderboard });
  });

  // ═══════════════════════════════════════════════════════
  // 12. GET /admin/hooks/cashback — Cashback rules + ledger summary
  // ═══════════════════════════════════════════════════════
  router.get('/admin/hooks/cashback', (_req: Request, res: Response) => {
    const stats = deps.hookEngine.cashback.getStats();
    res.json(stats);
  });

  // ═══════════════════════════════════════════════════════
  // 13. POST /admin/hooks/cashback/rules — Create/update cashback rules
  // ═══════════════════════════════════════════════════════
  router.post('/admin/hooks/cashback/rules', (req: Request, res: Response) => {
    const { name, ruleType, matchPattern, cashbackPercent, maxCashbackUsd, minTransactionUsd } = req.body as {
      name: string; ruleType: string; matchPattern: string;
      cashbackPercent: number; maxCashbackUsd?: number; minTransactionUsd?: number;
    };

    if (!name || !ruleType || cashbackPercent === undefined) {
      res.status(400).json({ error: 'Missing required fields: name, ruleType, cashbackPercent' });
      return;
    }

    deps.auditTrail.record('admin', 'cashback_rule_created', 'cashback', {
      name, ruleType, cashbackPercent,
    });

    res.json({ success: true, message: 'Cashback rule created' });
  });

  // ═══════════════════════════════════════════════════════
  // 14. GET /admin/hooks/referrals — Referral stats
  // ═══════════════════════════════════════════════════════
  router.get('/admin/hooks/referrals', (_req: Request, res: Response) => {
    const stats = deps.hookEngine.referrals.getStats();
    res.json(stats);
  });

  // ═══════════════════════════════════════════════════════
  // 15. GET /admin/hooks/achievements — Achievement unlock stats
  // ═══════════════════════════════════════════════════════
  router.get('/admin/hooks/achievements', (_req: Request, res: Response) => {
    const stats = deps.hookEngine.achievements.getStats();
    res.json(stats);
  });

  // ═══════════════════════════════════════════════════════
  // 16. GET /admin/hooks/loyalty — Loyalty stats
  // ═══════════════════════════════════════════════════════
  router.get('/admin/hooks/loyalty', (_req: Request, res: Response) => {
    const stats = deps.hookEngine.loyalty.getStats();
    res.json(stats);
  });

  // ═══════════════════════════════════════════════════════
  // 17. GET /admin/hooks/insights — Insights stats
  // ═══════════════════════════════════════════════════════
  router.get('/admin/hooks/insights', (_req: Request, res: Response) => {
    const stats = deps.hookEngine.insights.getStats();
    res.json(stats);
  });

  // ═══════════════════════════════════════════════════════
  // 18. GET /admin/providers — Payment provider health
  // ═══════════════════════════════════════════════════════
  router.get('/admin/providers', (_req: Request, res: Response) => {
    const breakers = deps.circuitBreakers.getState();
    const providers = [
      'stripe', 'mpesa', 'mtn_momo', 'flutterwave',
      'paystack', 'razorpay', 'mono', 'stitch',
    ].map(name => {
      const breaker = breakers.find(b => b.toolName === name);
      return {
        name,
        status: !breaker || breaker.state === 'closed' ? 'healthy'
          : breaker.state === 'half_open' ? 'degraded' : 'unhealthy',
        circuitBreaker: breaker ? {
          state: breaker.state,
          failures: breaker.failureCount,
          lastFailure: breaker.lastFailure,
        } : { state: 'closed', failures: 0, lastFailure: null },
      };
    });

    res.json({ count: providers.length, providers });
  });

  // ═══════════════════════════════════════════════════════
  // 19. GET /admin/config — Config (secrets masked) [Owner only]
  // ═══════════════════════════════════════════════════════
  router.get('/admin/config', requireRole('owner'), (_req: Request, res: Response) => {
    const config = deps.config as Record<string, Record<string, unknown>>;
    const masked: Record<string, unknown> = {};

    for (const [section, values] of Object.entries(config)) {
      if (typeof values === 'object' && values !== null) {
        const sectionMasked: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(values as Record<string, unknown>)) {
          const lk = key.toLowerCase();
          if (lk.includes('key') || lk.includes('secret') || lk.includes('token') || lk.includes('password')) {
            sectionMasked[key] = typeof value === 'string' && value.length > 0 ? '***set***' : '***empty***';
          } else {
            sectionMasked[key] = value;
          }
        }
        masked[section] = sectionMasked;
      } else {
        masked[section] = values;
      }
    }

    res.json(masked);
  });

  // ═══════════════════════════════════════════════════════
  // 20. GET /admin/tools/analytics — Tool stats
  // ═══════════════════════════════════════════════════════
  router.get('/admin/tools/analytics', (_req: Request, res: Response) => {
    const events = deps.orchestrator.getExecutionLog(1000) as Array<Record<string, unknown>>;
    const toolInvocations = events.filter(e => e.type === 'tool:result');

    const toolStats: Record<string, { invocations: number; successes: number; failures: number }> = {};

    for (const event of toolInvocations) {
      const payload = event.payload as Record<string, unknown>;
      const toolName = String(payload?.tool || 'unknown');
      if (!toolStats[toolName]) toolStats[toolName] = { invocations: 0, successes: 0, failures: 0 };
      toolStats[toolName].invocations++;
      if (payload?.success) toolStats[toolName].successes++;
      else toolStats[toolName].failures++;
    }

    const analytics = Object.entries(toolStats).map(([name, stats]) => ({
      name,
      ...stats,
      successRate: stats.invocations > 0 ? Math.round((stats.successes / stats.invocations) * 10000) / 100 : 0,
    })).sort((a, b) => b.invocations - a.invocations);

    res.json({ totalInvocations: toolInvocations.length, tools: analytics });
  });

  // ═══════════════════════════════════════════════════════
  // 21. GET /admin/revenue — Revenue dashboard
  // ═══════════════════════════════════════════════════════
  router.get('/admin/revenue', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const period = (req.query.period as string) || 'today';
    const validPeriods = ['today', 'week', 'month'];
    if (!validPeriods.includes(period)) {
      res.status(400).json({ error: 'Invalid period. Use: today, week, month' });
      return;
    }
    const summary = deps.feeEngine.getRevenueSummary(period as 'today' | 'week' | 'month');
    res.json(summary);
  });

  // ═══════════════════════════════════════════════════════
  // 22. GET /admin/agents-network — Agent network overview
  // ═══════════════════════════════════════════════════════
  router.get('/admin/agents-network', (_req: Request, res: Response) => {
    const db = deps.memory.getDb();
    const agents = db.prepare('SELECT * FROM agent_accounts WHERE status = ?').all('active') as Array<Record<string, unknown>>;
    const txToday = db.prepare("SELECT COUNT(*) as c FROM agent_transactions WHERE created_at >= date('now')").get() as { c: number } | undefined;
    const totalFloat = agents.reduce((sum, a) => sum + ((a.float_balance as number) || 0), 0);
    const totalCommissions = agents.reduce((sum, a) => sum + ((a.commission_earned as number) || 0), 0);

    res.json({
      count: agents.length,
      totalFloat,
      totalCommissions,
      transactionsToday: txToday?.c ?? 0,
      agents: agents.map(a => ({
        userId: a.user_id,
        floatBalance: a.float_balance,
        commissionEarned: a.commission_earned,
        locationCountry: a.location_country,
        locationCity: a.location_city,
        status: a.status,
      })),
    });
  });

  // ═══════════════════════════════════════════════════════
  // 23. GET /admin/cross-border — Cross-border transfer monitoring
  // ═══════════════════════════════════════════════════════
  router.get('/admin/cross-border', (_req: Request, res: Response) => {
    const db = deps.memory.getDb();
    const transfers = db.prepare('SELECT * FROM cross_border_transfers ORDER BY created_at DESC LIMIT 50').all() as Array<Record<string, unknown>>;
    const wiseCount = transfers.filter(t => t.provider === 'wise').length;
    const usdcCount = transfers.filter(t => t.provider === 'circle_usdc').length;
    const totalVolume = transfers.reduce((sum, t) => sum + ((t.source_amount as number) || 0), 0);

    res.json({
      count: transfers.length,
      totalVolume,
      wiseCount,
      usdcCount,
      transfers: transfers.map(t => ({
        id: t.id,
        provider: t.provider,
        sourceAmount: t.source_amount,
        sourceCurrency: t.source_currency,
        targetAmount: t.target_amount,
        targetCurrency: t.target_currency,
        fxRate: t.fx_rate,
        status: t.status,
        createdAt: t.created_at,
      })),
    });
  });

  // ═══════════════════════════════════════════════════════
  // 24. GET /admin/executive/context — Live platform data for AI
  // ═══════════════════════════════════════════════════════
  router.get('/admin/executive/context', requireRole('owner'), (_req: Request, res: Response) => {
    try {
      const context = gatherPlatformContext(deps);
      res.json(context);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Executive context error: ${msg}`);
      res.status(500).json({ error: 'Failed to gather platform context' });
    }
  });

  // ═══════════════════════════════════════════════════════
  // 25. POST /admin/executive/chat — Executive AI Board (DeepSeek)
  // ═══════════════════════════════════════════════════════
  router.post('/admin/executive/chat', requireRole('owner'), async (req: Request, res: Response) => {
    try {
      const { persona, message, history } = req.body as {
        persona: string;
        message: string;
        history?: Array<{ role: string; content: string }>;
      };

      if (!persona || !EXECUTIVE_PERSONAS[persona]) {
        res.status(400).json({ error: `Invalid persona. Use: ${Object.keys(EXECUTIVE_PERSONAS).join(', ')}` });
        return;
      }
      if (!message || message.trim().length === 0) {
        res.status(400).json({ error: 'message is required' });
        return;
      }
      if (!CONFIG.deepseek.apiKey) {
        res.status(503).json({ error: 'DeepSeek API key not configured. Set DEEPSEEK_API_KEY in .env' });
        return;
      }

      const personaName = EXECUTIVE_PERSONAS[persona];
      const context = gatherPlatformContext(deps);

      // Load soul.md (proprietary system prompt)
      let soulPrompt = '';
      try {
        const soulPath = path.join(process.cwd(), 'config', 'soul.md');
        soulPrompt = readFileSync(soulPath, 'utf-8');
      } catch {
        soulPrompt = 'You are an AI executive advisor for PromptPay, a fintech platform. Analyze the live data provided and give actionable business advice.';
      }

      const systemPrompt = `${soulPrompt}\n\n## Active Persona: ${personaName}\n\nYou are now acting as the ${personaName}. Stay fully in this role.\n\n## Live Platform Data (Real-Time)\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``;

      // Build message history (max 20 messages)
      const msgs: Array<{ role: string; content: string }> = [];
      if (history && Array.isArray(history)) {
        const trimmed = history.slice(-20);
        for (const m of trimmed) {
          if (m.role === 'user' || m.role === 'assistant') {
            msgs.push({ role: m.role, content: m.content });
          }
        }
      }
      msgs.push({ role: 'user', content: message });

      const result = await callDeepSeek(systemPrompt, msgs);

      deps.auditTrail.record('admin', 'executive_chat', persona, { messageLength: message.length });
      deps.logger.info(`[Executive] ${personaName} consulted, ${result.usage.input + result.usage.output} tokens`);

      res.json({
        persona,
        personaName,
        response: result.text,
        usage: result.usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Executive chat error: ${msg}`);
      res.status(500).json({ error: `Executive AI error: ${msg}` });
    }
  });

  // ═══════════════════════════════════════════════════════
  // 26. POST /admin/rewards/credit — Credit reward balance (owner-only)
  // ═══════════════════════════════════════════════════════
  router.post('/admin/rewards/credit', requireRole('owner'), (req: Request, res: Response) => {
    try {
      const { userId, amount, description } = req.body as {
        userId: string;
        amount: number;
        description?: string;
      };

      if (!userId || !amount || amount <= 0) {
        res.status(400).json({ error: 'userId and a positive amount are required' });
        return;
      }

      // Verify user exists
      const user = db.prepare('SELECT id, display_name FROM users WHERE id = ?')
        .get(userId) as { id: string; display_name: string } | undefined;

      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      const desc = description || `Admin credit by ${req.auth!.userId}`;
      deps.hookEngine.referrals.adminCreditReward(userId, amount, desc);

      deps.auditTrail.record('admin', 'reward_credit', userId, {
        amount,
        description: desc,
        creditedBy: req.auth!.userId,
      });

      deps.logger.info(`[Admin] Credited $${amount} reward to ${user.display_name} (${userId})`);

      res.json({
        success: true,
        userId,
        amount,
        userName: user.display_name,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Admin reward credit error: ${msg}`);
      res.status(500).json({ error: 'Failed to credit reward' });
    }
  });

  // ═══════════════════════════════════════════════════════
  // 27. GET /admin/pos/revenue — POS Revenue Dashboard
  // ═══════════════════════════════════════════════════════
  router.get('/admin/pos/revenue', authenticate, requireRole('owner'), (_req: Request, res: Response) => {
    const db = deps.memory.getDb();
    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    // Total wallet fundings (= money that entered your Stripe account)
    const totalFunded = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total, COUNT(*) as count FROM wallet_transactions WHERE type = 'fund'"
    ).get() as { total: number; count: number };

    // Total Reloadly spend (= money you paid to Reloadly)
    const totalReloadlySpend = db.prepare(
      "SELECT COALESCE(SUM(cost_price), 0) as total FROM pos_transactions WHERE status = 'completed'"
    ).get() as { total: number };

    // Platform fees collected
    const totalPlatformFees = db.prepare(
      "SELECT COALESCE(SUM(platform_fee), 0) as total FROM pos_transactions WHERE status = 'completed'"
    ).get() as { total: number };

    // Agent profits paid out (from your margin)
    const totalAgentProfits = db.prepare(
      "SELECT COALESCE(SUM(agent_profit), 0) as total FROM pos_transactions WHERE status = 'completed'"
    ).get() as { total: number };

    // Gross profit = fundings - reloadly spend (what stays in your Stripe)
    const grossProfit = totalFunded.total - totalReloadlySpend.total;

    // Today's breakdown
    const todayStats = db.prepare(`
      SELECT COUNT(*) as txCount,
        COALESCE(SUM(face_value), 0) as volume,
        COALESCE(SUM(platform_fee), 0) as fees,
        COALESCE(SUM(cost_price), 0) as reloadlySpend,
        COALESCE(SUM(agent_profit), 0) as agentProfits
      FROM pos_transactions WHERE status = 'completed' AND created_at >= ?
    `).get(today) as { txCount: number; volume: number; fees: number; reloadlySpend: number; agentProfits: number };

    const todayFundings = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE type = 'fund' AND created_at >= ?"
    ).get(today) as { total: number };

    // Weekly breakdown
    const weekStats = db.prepare(`
      SELECT COUNT(*) as txCount,
        COALESCE(SUM(face_value), 0) as volume,
        COALESCE(SUM(platform_fee), 0) as fees,
        COALESCE(SUM(cost_price), 0) as reloadlySpend
      FROM pos_transactions WHERE status = 'completed' AND created_at >= ?
    `).get(weekAgo) as { txCount: number; volume: number; fees: number; reloadlySpend: number };

    const weekFundings = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE type = 'fund' AND created_at >= ?"
    ).get(weekAgo) as { total: number };

    // Monthly breakdown
    const monthStats = db.prepare(`
      SELECT COUNT(*) as txCount,
        COALESCE(SUM(face_value), 0) as volume,
        COALESCE(SUM(platform_fee), 0) as fees,
        COALESCE(SUM(cost_price), 0) as reloadlySpend
      FROM pos_transactions WHERE status = 'completed' AND created_at >= ?
    `).get(monthAgo) as { txCount: number; volume: number; fees: number; reloadlySpend: number };

    const monthFundings = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions WHERE type = 'fund' AND created_at >= ?"
    ).get(monthAgo) as { total: number };

    // Active agents (users with wallets who have made sales)
    const activeAgents = db.prepare(
      "SELECT COUNT(DISTINCT agent_user_id) as count FROM pos_transactions WHERE status = 'completed'"
    ).get() as { count: number };

    const totalAgents = db.prepare(
      "SELECT COUNT(*) as count FROM user_wallets"
    ).get() as { count: number };

    // Top agents
    const topAgents = db.prepare(`
      SELECT p.agent_user_id, u.display_name, u.email,
        COUNT(*) as sales,
        SUM(p.face_value) as volume,
        SUM(p.platform_fee) as feesGenerated,
        SUM(p.agent_profit) as agentEarned
      FROM pos_transactions p
      JOIN users u ON u.id = p.agent_user_id
      WHERE p.status = 'completed'
      GROUP BY p.agent_user_id
      ORDER BY volume DESC LIMIT 10
    `).all() as Array<Record<string, unknown>>;

    // Current platform fee setting
    const feeSetting = db.prepare("SELECT value FROM platform_settings WHERE key = 'pos_platform_fee_pct'").get() as { value: string } | undefined;

    // Failed transactions
    const failedCount = db.prepare(
      "SELECT COUNT(*) as count FROM pos_transactions WHERE status = 'failed'"
    ).get() as { count: number };

    res.json({
      allTime: {
        walletFundings: totalFunded.total,
        fundingCount: totalFunded.count,
        reloadlySpend: totalReloadlySpend.total,
        platformFees: totalPlatformFees.total,
        agentProfits: totalAgentProfits.total,
        grossProfit,
        netRevenue: totalPlatformFees.total, // platform fee is your guaranteed cut
      },
      today: {
        fundings: todayFundings.total,
        transactions: todayStats.txCount,
        volume: todayStats.volume,
        platformFees: todayStats.fees,
        reloadlySpend: todayStats.reloadlySpend,
        profit: todayFundings.total - todayStats.reloadlySpend,
      },
      week: {
        fundings: weekFundings.total,
        transactions: weekStats.txCount,
        volume: weekStats.volume,
        platformFees: weekStats.fees,
        profit: weekFundings.total - weekStats.reloadlySpend,
      },
      month: {
        fundings: monthFundings.total,
        transactions: monthStats.txCount,
        volume: monthStats.volume,
        platformFees: monthStats.fees,
        profit: monthFundings.total - monthStats.reloadlySpend,
      },
      agents: {
        total: totalAgents.count,
        active: activeAgents.count,
        top: topAgents,
      },
      failedTransactions: failedCount.count,
      currentPlatformFeePct: parseFloat(feeSetting?.value || '1'),
    });
  });

  // ═══════════════════════════════════════════════════════
  // 28. GET /admin/pos/settings — Get POS platform settings
  // ═══════════════════════════════════════════════════════
  router.get('/admin/pos/settings', authenticate, requireRole('owner'), (_req: Request, res: Response) => {
    const db = deps.memory.getDb();
    const settings = db.prepare("SELECT * FROM platform_settings").all() as Array<{ key: string; value: string; updated_by: string | null; updated_at: string }>;
    const obj: Record<string, { value: string; updatedBy: string | null; updatedAt: string }> = {};
    for (const s of settings) {
      obj[s.key] = { value: s.value, updatedBy: s.updated_by, updatedAt: s.updated_at };
    }
    res.json({ settings: obj });
  });

  // ═══════════════════════════════════════════════════════
  // 29. POST /admin/pos/settings — Update POS platform settings
  // ═══════════════════════════════════════════════════════
  router.post('/admin/pos/settings', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const db = deps.memory.getDb();
    const { platformFeePct } = req.body as { platformFeePct?: number };

    if (platformFeePct !== undefined) {
      if (typeof platformFeePct !== 'number' || platformFeePct < 0 || platformFeePct > 25) {
        res.status(400).json({ error: 'Platform fee must be between 0% and 25%' });
        return;
      }

      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO platform_settings (key, value, updated_by, updated_at)
        VALUES ('pos_platform_fee_pct', ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at
      `).run(String(platformFeePct), req.auth!.userId, now);

      deps.auditTrail.record('admin', 'settings_update', req.auth!.userId, {
        setting: 'pos_platform_fee_pct',
        oldValue: undefined,
        newValue: platformFeePct,
      });

      deps.logger.info(`[Admin] Platform fee updated to ${platformFeePct}% by ${req.auth!.userId}`);
    }

    res.json({ success: true, platformFeePct: platformFeePct ?? null });
  });

  deps.logger.info('Admin portal: 29 routes registered');
  return router;
}
