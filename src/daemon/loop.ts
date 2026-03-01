// ═══════════════════════════════════════════════════════════════
// PromptPay :: Daemon Loop
// Scheduled jobs: hook engine, self-eval, health checks, agentic jobs
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { AuditTrail } from '../protocols/audit-trail.js';
import type { HookEngine } from '../hooks/engine.js';
import type { TelegramChannel } from '../channels/telegram.js';
import type { FeeEngine } from '../hooks/fees.js';
import { CONFIG } from '../core/config.js';

export interface DaemonDependencies {
  orchestrator: Orchestrator;
  db: Database.Database;
  auditTrail: AuditTrail;
  hookEngine: HookEngine;
  telegram?: TelegramChannel;
  feeEngine?: FeeEngine;
  logger: LoggerHandle;
}

interface ScheduledJob {
  id: string;
  name: string;
  intervalMs: number;
  lastRun: Date | null;
  nextRun: Date;
  execute: () => Promise<void>;
  enabled: boolean;
}

export class DaemonLoop {
  private jobs: Map<string, ScheduledJob> = new Map();
  private timer: ReturnType<typeof setInterval> | null = null;
  private deps: DaemonDependencies;
  private running = false;

  constructor(deps: DaemonDependencies) {
    this.deps = deps;
    this.registerJobs();
    this.deps.logger.info(`Daemon initialized with ${this.jobs.size} scheduled jobs`);
  }

  private registerJobs(): void {
    // Daily hook jobs (every hour, but hook engine handles idempotency)
    this.addJob('hook_daily', 'Hook Engine Daily Jobs', 3600000, async () => {
      const now = new Date();
      // Only run at the configured streak reset hour
      const streakResetHour = 0; // Midnight UTC
      if (now.getUTCHours() === streakResetHour) {
        const results = this.deps.hookEngine.runDailyJobs();
        this.deps.auditTrail.record('daemon', 'hook_daily_jobs', 'hook_engine', results);
        this.deps.logger.info(`[Daemon] Daily hooks: ${JSON.stringify(results)}`);
      }
    });

    // Weekly insights (every 24h, but only on Sundays)
    this.addJob('hook_weekly', 'Hook Engine Weekly Insights', 86400000, async () => {
      const now = new Date();
      if (now.getUTCDay() === 0) { // Sunday
        // Get all user IDs with recent activity
        const users = this.deps.db.prepare(
          "SELECT DISTINCT agent_id FROM execution_log WHERE timestamp > datetime('now', '-30 days')"
        ).all() as Array<{ agent_id: string }>;

        const userIds = users.map(u => u.agent_id);
        const results = this.deps.hookEngine.runWeeklyJobs(userIds);
        this.deps.auditTrail.record('daemon', 'hook_weekly_jobs', 'hook_engine', results);
        this.deps.logger.info(`[Daemon] Weekly hooks: ${JSON.stringify(results)}`);
      }
    });

    // Self-evaluation
    this.addJob('self_eval', 'Orchestrator Self-Evaluation', CONFIG.daemon.selfEvalIntervalMs, async () => {
      try {
        const evaluation = await this.deps.orchestrator.runSelfEvaluation();
        this.deps.auditTrail.record('daemon', 'self_evaluation', 'orchestrator', {
          evaluationId: evaluation.id,
          tasksCompleted: evaluation.metrics.tasksCompleted,
          tasksFailed: evaluation.metrics.tasksFailed,
        });
      } catch (err) {
        this.deps.logger.error(`Self-evaluation failed: ${err}`);
      }
    });

    // Health check
    this.addJob('health_check', 'System Health Check', 60000, async () => {
      const state = this.deps.orchestrator.getState();
      const auditCount = this.deps.auditTrail.getCount();
      this.deps.logger.debug(`[Health] Tools: ${state.toolCount}, Agents: ${state.agentCount}, Audit: ${auditCount}`);
    });

    // Reminder dispatch (every 15 minutes)
    this.addJob('reminder_dispatch', 'Payment Reminder Dispatch', 900000, async () => {
      const pending = this.deps.hookEngine.reminders.getPendingReminders();
      for (const reminder of pending) {
        // In production, this would route through the channel manager
        this.deps.hookEngine.reminders.markSent(reminder.id);
      }
      if (pending.length > 0) {
        this.deps.logger.info(`[Daemon] Dispatched ${pending.length} reminders`);
      }
    });

    // Calendar AI (Chrono) — proactive reminder checks (every 5 minutes)
    this.addJob('calendar_reminders', 'Chrono Calendar Reminder Check', 300000, async () => {
      try {
        const now = new Date().toISOString();
        // Check todos with due reminders
        const dueReminders = this.deps.db.prepare(`
          SELECT id, owner_id, owner_type, title, priority FROM calendar_todos
          WHERE status = 'pending' AND reminder_at IS NOT NULL
            AND reminder_at <= ? AND reminder_sent = 0
        `).all(now) as Array<{ id: string; owner_id: string; owner_type: string; title: string; priority: string }>;

        for (const todo of dueReminders) {
          this.deps.db.prepare("UPDATE calendar_todos SET reminder_sent = 1 WHERE id = ?").run(todo.id);
          const msg = `⏰ Reminder: "${todo.title}" — ${todo.priority === 'urgent' ? 'URGENT!' : 'needs attention'}`;
          this.deps.db.prepare(`INSERT INTO calendar_reminders_log (id, owner_id, owner_type, message, message_type)
            VALUES (?, ?, ?, ?, 'reminder')`).run(
            'cr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            todo.owner_id, todo.owner_type, msg
          );
        }

        // Check events with approaching start times (15 min window)
        const soon = new Date(Date.now() + 15 * 60000).toISOString();
        const upcomingEvents = this.deps.db.prepare(`
          SELECT id, owner_id, owner_type, title, location FROM calendar_events
          WHERE start_time > ? AND start_time <= ? AND reminder_sent = 0
        `).all(now, soon) as Array<{ id: string; owner_id: string; owner_type: string; title: string; location: string }>;

        for (const evt of upcomingEvents) {
          this.deps.db.prepare("UPDATE calendar_events SET reminder_sent = 1 WHERE id = ?").run(evt.id);
          this.deps.db.prepare(`INSERT INTO calendar_reminders_log (id, owner_id, owner_type, message, message_type)
            VALUES (?, ?, ?, ?, 'event_reminder')`).run(
            'ce_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            evt.owner_id, evt.owner_type,
            `📅 "${evt.title}" starts soon${evt.location ? ` at ${evt.location}` : ''}`
          );
        }

        const total = dueReminders.length + upcomingEvents.length;
        if (total > 0) {
          this.deps.logger.info(`[Daemon/Chrono] Processed ${total} calendar reminders`);
        }
      } catch (err) {
        // Tables may not exist yet if calendar routes haven't been loaded
        this.deps.logger.debug(`[Daemon/Chrono] Calendar check skipped: ${err}`);
      }
    });

    // Referral bonus crediting (every 4 hours)
    this.addJob('referral_credits', 'Referral Bonus Credits', 14400000, async () => {
      const credited = this.deps.hookEngine.referrals.creditPending();
      if (credited > 0) {
        this.deps.logger.info(`[Daemon] Credited ${credited} referral bonuses`);
      }
    });

    // ── Agentic Agent Jobs ──

    // Price alerts (every hour): check and trigger price alerts
    this.addJob('price_alerts', 'Price Alert Check', 3600000, async () => {
      const active = this.deps.db.prepare(
        "SELECT * FROM price_alerts WHERE status = 'active'"
      ).all() as Array<Record<string, unknown>>;

      // In production, this would fetch current prices from APIs
      // For now, just log the number of active alerts
      if (active.length > 0) {
        this.deps.logger.debug(`[Daemon] Monitoring ${active.length} active price alerts`);
      }
    });

    // Subscription alerts (every 6 hours): flag upcoming renewals
    this.addJob('subscription_alerts', 'Subscription Renewal Alerts', 21600000, async () => {
      const upcoming = this.deps.db.prepare(`
        SELECT * FROM subscriptions
        WHERE status = 'active'
          AND next_billing_date <= datetime('now', '+3 days')
      `).all() as Array<Record<string, unknown>>;

      if (upcoming.length > 0) {
        this.deps.logger.info(`[Daemon] ${upcoming.length} subscription(s) renewing within 3 days`);
        this.deps.auditTrail.record('daemon', 'subscription_alerts', 'otto', {
          upcoming: upcoming.length,
          services: upcoming.map(s => s.service_name),
        });
      }
    });

    // Budget checks (every 24 hours): alert on budgets exceeding threshold
    this.addJob('budget_checks', 'Budget Threshold Alerts', 86400000, async () => {
      const budgets = this.deps.db.prepare(`
        SELECT b.*,
          (SELECT COALESCE(SUM(bc.spent_amount), 0) FROM budget_categories bc WHERE bc.budget_id = b.id) as total_spent
        FROM budgets b
        WHERE b.status = 'active'
      `).all() as Array<Record<string, unknown>>;

      const overThreshold = budgets.filter(b => {
        const spent = b.total_spent as number;
        const total = b.total_amount as number;
        return total > 0 && (spent / total) * 100 >= 80;
      });

      if (overThreshold.length > 0) {
        this.deps.logger.info(`[Daemon] ${overThreshold.length} budget(s) exceeding 80% threshold`);
        this.deps.auditTrail.record('daemon', 'budget_alerts', 'sage', {
          overThreshold: overThreshold.length,
          budgets: overThreshold.map(b => ({ name: b.name, spent: b.total_spent, total: b.total_amount })),
        });
      }
    });

    // ── Owner Daily Briefing via Telegram (every hour, fires at configured hour) ──
    this.addJob('owner_daily_briefing', 'Owner Daily Telegram Briefing', 3600000, async () => {
      const now = new Date();
      if (now.getUTCHours() !== CONFIG.telegram.briefingHourUtc) return;
      if (!CONFIG.telegram.ownerChatId || !this.deps.telegram?.isActive()) return;

      try {
        const briefing = this.buildDailyBriefing();
        await this.deps.telegram.sendMessage(CONFIG.telegram.ownerChatId, briefing);
        this.deps.auditTrail.record('daemon', 'daily_briefing_sent', 'system', { channel: 'telegram' });
        this.deps.logger.info('[Daemon] Daily briefing sent to owner via Telegram');
      } catch (err) {
        this.deps.logger.error(`[Daemon] Daily briefing failed: ${err}`);
      }
    });
  }

  private addJob(id: string, name: string, intervalMs: number, execute: () => Promise<void>): void {
    this.jobs.set(id, {
      id, name, intervalMs, execute,
      lastRun: null,
      nextRun: new Date(Date.now() + intervalMs),
      enabled: true,
    });
  }

  start(): void {
    this.running = true;
    this.timer = setInterval(() => this.tick(), CONFIG.daemon.cycleIntervalMs > 60000 ? 60000 : CONFIG.daemon.cycleIntervalMs);
    this.deps.logger.info('Daemon loop started');
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.deps.logger.info('Daemon loop stopped');
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    const now = new Date();
    for (const job of this.jobs.values()) {
      if (!job.enabled || now < job.nextRun) continue;

      try {
        await job.execute();
        job.lastRun = now;
        job.nextRun = new Date(now.getTime() + job.intervalMs);
      } catch (err) {
        this.deps.logger.error(`[Daemon] Job ${job.id} failed: ${err}`);
      }
    }
  }

  private buildDailyBriefing(): string {
    const db = this.deps.db;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

    // ── Revenue & Fees ──
    const revenueToday = this.deps.feeEngine?.getRevenueSummary('today') as Record<string, unknown> | undefined;
    const revenueMonth = this.deps.feeEngine?.getRevenueSummary('month') as Record<string, unknown> | undefined;
    const todayVolume = Number(revenueToday?.total_volume || 0);
    const todayFees = Number(revenueToday?.total_fees_net || 0);
    const todayTxCount = Number(revenueToday?.transaction_count || 0);
    const monthVolume = Number(revenueMonth?.total_volume || 0);
    const monthFees = Number(revenueMonth?.total_fees_net || 0);
    const monthTxCount = Number(revenueMonth?.transaction_count || 0);

    // ── POS Agent Network ──
    const posTotal = (db.prepare('SELECT COUNT(*) as c FROM pos_agents').get() as { c: number })?.c || 0;
    const posActive = (db.prepare("SELECT COUNT(*) as c FROM pos_agents WHERE status = 'active'").get() as { c: number })?.c || 0;
    let posDailyVolume = 0;
    let posDailyTx = 0;
    try {
      const posStats = db.prepare(`
        SELECT COUNT(*) as tx_count, COALESCE(SUM(amount), 0) as volume
        FROM agent_transactions WHERE created_at >= ?
      `).get(today) as { tx_count: number; volume: number } | undefined;
      posDailyVolume = posStats?.volume || 0;
      posDailyTx = posStats?.tx_count || 0;
    } catch { /* table may not have data */ }

    // ── Users ──
    const totalUsers = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number })?.c || 0;
    const newUsersToday = (db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(today) as { c: number })?.c || 0;
    const activeToday = (db.prepare("SELECT COUNT(DISTINCT id) as c FROM users WHERE last_login_at >= ?").get(today) as { c: number })?.c || 0;
    const newUsersYesterday = (db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ? AND created_at < ?').get(yesterday, today) as { c: number })?.c || 0;

    // ── User Growth Trajectory ──
    const usersLastWeek = (db.prepare('SELECT COUNT(*) as c FROM users WHERE created_at >= ?').get(weekAgo) as { c: number })?.c || 0;

    // ── Cross-Border ──
    let xbCount = 0;
    let xbVolume = 0;
    try {
      const xb = db.prepare('SELECT COUNT(*) as c, COALESCE(SUM(source_amount), 0) as vol FROM cross_border_transfers WHERE created_at >= ?').get(today) as { c: number; vol: number } | undefined;
      xbCount = xb?.c || 0;
      xbVolume = xb?.vol || 0;
    } catch { /* table may not exist */ }

    // ── Wallet Balances ──
    let totalWalletBalance = 0;
    try {
      const wb = db.prepare("SELECT COALESCE(SUM(balance), 0) as total FROM users WHERE status = 'active'").get() as { total: number } | undefined;
      totalWalletBalance = wb?.total || 0;
    } catch { /* no balance column */ }

    // ── Calendar / Upcoming Events ──
    let todosOverdue = 0;
    let todosToday = 0;
    let eventsToday = 0;
    try {
      todosOverdue = (db.prepare("SELECT COUNT(*) as c FROM calendar_todos WHERE status = 'pending' AND due_date < ?").get(today) as { c: number })?.c || 0;
      todosToday = (db.prepare("SELECT COUNT(*) as c FROM calendar_todos WHERE status = 'pending' AND due_date = ?").get(today) as { c: number })?.c || 0;
      eventsToday = (db.prepare("SELECT COUNT(*) as c FROM calendar_events WHERE DATE(start_time) = ?").get(today) as { c: number })?.c || 0;
    } catch { /* calendar tables may not exist yet */ }

    // ── System Health ──
    const uptime = Math.round(process.uptime() / 3600);
    const state = this.deps.orchestrator.getState() as Record<string, unknown>;

    // ── Engagement Hooks ──
    let activeSavingsGoals = 0;
    let totalSaved = 0;
    try {
      const sg = db.prepare("SELECT COUNT(*) as c, COALESCE(SUM(current_amount), 0) as saved FROM savings_goals WHERE status = 'active'").get() as { c: number; saved: number } | undefined;
      activeSavingsGoals = sg?.c || 0;
      totalSaved = sg?.saved || 0;
    } catch { /* */ }

    // ── Build Trajectory Analysis ──
    const userGrowthRate = totalUsers > 0 ? ((usersLastWeek / totalUsers) * 100).toFixed(1) : '0';
    const avgDailyRevenue = monthFees > 0 ? (monthFees / 30).toFixed(2) : '0';

    // ── Build Solutions ──
    const solutions: string[] = [];
    if (todayTxCount === 0) solutions.push('💡 No transactions today — consider a push notification campaign or flash cashback promo to activate users');
    if (newUsersToday === 0 && newUsersYesterday === 0) solutions.push('💡 Zero signups for 2 days — amplify referral bonuses or run a social media campaign');
    if (posActive < posTotal * 0.5 && posTotal > 0) solutions.push(`💡 Only ${posActive}/${posTotal} POS agents active — reach out to dormant agents with incentives`);
    if (todosOverdue > 3) solutions.push(`💡 ${todosOverdue} overdue tasks — block time today to clear the backlog`);
    if (monthFees < 100 && monthTxCount > 0) solutions.push('💡 Revenue below $100/month — review fee structure or push cross-border & merchant transactions (higher margin)');
    if (totalWalletBalance > 10000) solutions.push(`💡 $${totalWalletBalance.toFixed(0)} sitting in wallets — promote investment features or interest-bearing products`);
    if (solutions.length === 0) solutions.push('✅ All metrics healthy — keep executing the current strategy');

    // ── Format Message ──
    const lines = [
      `☀️ *PromptPay Daily Briefing — ${today}*`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━',
      '📊 *REVENUE & TRANSACTIONS*',
      `• Today: $${todayFees.toFixed(2)} fees on $${todayVolume.toFixed(2)} volume (${todayTxCount} tx)`,
      `• This Month: $${monthFees.toFixed(2)} fees on $${monthVolume.toFixed(2)} volume (${monthTxCount} tx)`,
      `• Avg Daily Revenue: $${avgDailyRevenue}`,
      '',
      '🏪 *POS NETWORK*',
      `• Agents: ${posActive} active / ${posTotal} total`,
      `• Daily Volume: $${posDailyVolume.toFixed(2)} (${posDailyTx} transactions)`,
      '',
      '👥 *USERS & GROWTH*',
      `• Total Users: ${totalUsers}`,
      `• New Today: ${newUsersToday} | Active Today: ${activeToday}`,
      `• Weekly Signup Rate: ${usersLastWeek} (${userGrowthRate}% of base)`,
      '',
      '🌍 *CROSS-BORDER*',
      `• Today: ${xbCount} transfers ($${xbVolume.toFixed(2)} volume)`,
      '',
      '💰 *FINANCIAL HEALTH*',
      `• Platform Wallet Float: $${totalWalletBalance.toFixed(2)}`,
      `• Active Savings Goals: ${activeSavingsGoals} ($${totalSaved.toFixed(2)} saved)`,
      '',
      '📅 *CALENDAR SYNC*',
      `• Today's Events: ${eventsToday}`,
      `• Pending Tasks: ${todosToday} | Overdue: ${todosOverdue}`,
      '',
      '🖥️ *SYSTEM*',
      `• Uptime: ${uptime}h | Tools: ${state.toolCount} | Agents: 7`,
      '',
      '━━━━━━━━━━━━━━━━━━━━━',
      '🎯 *RECOMMENDED ACTIONS*',
      ...solutions.map(s => `${s}`),
      '',
      `_Sent by POI Orchestrator at ${new Date().toISOString().slice(11, 16)} UTC_`,
    ];

    return lines.join('\n');
  }

  getJobs(): Array<{ id: string; name: string; lastRun: Date | null; nextRun: Date; enabled: boolean }> {
    return Array.from(this.jobs.values()).map(j => ({
      id: j.id, name: j.name, lastRun: j.lastRun, nextRun: j.nextRun, enabled: j.enabled,
    }));
  }

  triggerJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (!job) return false;
    job.execute().catch(err => this.deps.logger.error(`Manual job ${jobId} failed: ${err}`));
    return true;
  }
}
