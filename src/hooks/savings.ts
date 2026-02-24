// ═══════════════════════════════════════════════════════════════
// PromptPay :: Smart Savings Engine
// Round-up, % of deposit, threshold skim, goal tracking
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import type { TransactionEvent } from './cashback.js';

export class SavingsEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Process a transaction against active savings rules. Returns total saved. */
  processTransaction(userId: string, tx: TransactionEvent): number {
    const rules = this.db.prepare(
      'SELECT * FROM savings_rules WHERE user_id = ? AND enabled = 1'
    ).all(userId) as Array<{
      id: string; goal_id: string | null; rule_type: string; config: string;
      executions: number; total_saved: number;
    }>;

    let totalSaved = 0;
    const now = new Date().toISOString();

    for (const rule of rules) {
      const cfg = JSON.parse(rule.config) as Record<string, number>;
      let saveAmount = 0;

      switch (rule.rule_type) {
        case 'round_up': {
          const roundTo = cfg.roundTo || 1; // Round to nearest dollar by default
          const rounded = Math.ceil(tx.amount / roundTo) * roundTo;
          saveAmount = rounded - tx.amount;
          break;
        }
        case 'percent_of_deposit': {
          if (tx.type === 'deposit' || tx.type === 'topup') {
            saveAmount = tx.amount * (cfg.percent || 0.05);
          }
          break;
        }
        case 'threshold_skim': {
          // This is handled in daily jobs, not per-transaction
          break;
        }
      }

      if (saveAmount > 0) {
        saveAmount = Math.round(saveAmount * 100) / 100;

        this.db.prepare(`
          INSERT INTO savings_transactions (id, user_id, goal_id, rule_id, amount, source_transaction_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), userId, rule.goal_id, rule.id, saveAmount, tx.id, now);

        // Update rule stats
        this.db.prepare(
          'UPDATE savings_rules SET executions = executions + 1, total_saved = total_saved + ? WHERE id = ?'
        ).run(saveAmount, rule.id);

        // Update goal if linked
        if (rule.goal_id) {
          this.db.prepare(
            'UPDATE savings_goals SET current_amount = current_amount + ?, updated_at = ? WHERE id = ?'
          ).run(saveAmount, now, rule.goal_id);

          // Check if goal completed
          const goal = this.db.prepare(
            'SELECT * FROM savings_goals WHERE id = ?'
          ).get(rule.goal_id) as { current_amount: number; target_amount: number; status: string } | undefined;

          if (goal && goal.current_amount >= goal.target_amount && goal.status === 'active') {
            this.db.prepare("UPDATE savings_goals SET status = 'completed', updated_at = ? WHERE id = ?").run(now, rule.goal_id);
            this.logger.info(`[Savings] Goal completed for ${userId}!`);
          }
        }

        totalSaved += saveAmount;
      }
    }

    if (totalSaved > 0) {
      this.logger.info(`[Savings] ${userId}: auto-saved $${totalSaved} from transaction $${tx.amount}`);
    }

    return totalSaved;
  }

  /** Get all savings goals for a user */
  getGoals(userId: string): Array<{ id: string; name: string; targetAmount: number; currentAmount: number; currency: string; status: string; deadline: string | null }> {
    return this.db.prepare(
      'SELECT id, name, target_amount as targetAmount, current_amount as currentAmount, currency, status, deadline FROM savings_goals WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId) as Array<{ id: string; name: string; targetAmount: number; currentAmount: number; currency: string; status: string; deadline: string | null }>;
  }

  /** Get aggregate savings stats */
  getStats(): { totalGoals: number; activeGoals: number; completedGoals: number; totalSaved: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
        COALESCE(SUM(current_amount), 0) as saved
      FROM savings_goals
    `).get() as { total: number; active: number; completed: number; saved: number };

    return { totalGoals: row.total, activeGoals: row.active, completedGoals: row.completed, totalSaved: row.saved };
  }
}
