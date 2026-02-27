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
import { CONFIG } from '../core/config.js';

export interface DaemonDependencies {
  orchestrator: Orchestrator;
  db: Database.Database;
  auditTrail: AuditTrail;
  hookEngine: HookEngine;
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
      if (now.getUTCHours() === CONFIG.hooks.streakResetHour) {
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
