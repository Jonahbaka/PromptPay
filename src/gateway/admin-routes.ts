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
      platform: 'uPromptPay',
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

  deps.logger.info('Admin portal: 23 routes registered');
  return router;
}
