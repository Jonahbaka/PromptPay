// ═══════════════════════════════════════════════════════════════
// PromptPay :: Daemon Loop
// Scheduled jobs: hook engine daily/weekly, self-eval, health checks
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
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

    // Referral bonus crediting (every 4 hours)
    this.addJob('referral_credits', 'Referral Bonus Credits', 14400000, async () => {
      const credited = this.deps.hookEngine.referrals.creditPending();
      if (credited > 0) {
        this.deps.logger.info(`[Daemon] Credited ${credited} referral bonuses`);
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
