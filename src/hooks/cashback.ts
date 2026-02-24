// ═══════════════════════════════════════════════════════════════
// PromptPay :: Cashback Engine
// Rules-based cashback with streak multipliers and daily caps
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';

export interface TransactionEvent {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  merchant?: string;
  category?: string;
  type: string;
}

export class CashbackEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Process a transaction and record any matching cashback (pending). */
  processTransaction(userId: string, tx: TransactionEvent, streakMultiplier = 1.0): number {
    const rules = this.db.prepare(
      'SELECT * FROM cashback_rules WHERE enabled = 1'
    ).all() as Array<{
      id: string; name: string; rule_type: string; match_pattern: string;
      cashback_percent: number; max_cashback_usd: number | null; min_transaction_usd: number;
      valid_from: string | null; valid_until: string | null;
    }>;

    let totalCashback = 0;
    const now = new Date().toISOString();

    // Check daily cap
    const todayStart = new Date().toISOString().split('T')[0];
    const dailyTotal = this.db.prepare(`
      SELECT COALESCE(SUM(cashback_amount), 0) as total FROM cashback_ledger
      WHERE user_id = ? AND created_at >= ? AND status != 'expired'
    `).get(userId, todayStart) as { total: number };

    if (dailyTotal.total >= CONFIG.hooks.cashbackMaxDailyUsd) {
      return 0; // Daily cap reached
    }

    for (const rule of rules) {
      if (tx.amount < rule.min_transaction_usd) continue;

      // Check validity dates
      if (rule.valid_from && now < rule.valid_from) continue;
      if (rule.valid_until && now > rule.valid_until) continue;

      // Match rule
      let matches = false;
      switch (rule.rule_type) {
        case 'global':
          matches = true;
          break;
        case 'merchant':
          matches = tx.merchant?.toLowerCase().includes(rule.match_pattern.toLowerCase()) ?? false;
          break;
        case 'category':
          matches = tx.category?.toLowerCase() === rule.match_pattern.toLowerCase();
          break;
        case 'amount_tier': {
          const tier = JSON.parse(rule.match_pattern) as { minAmount: number; maxAmount: number };
          matches = tx.amount >= tier.minAmount && tx.amount <= tier.maxAmount;
          break;
        }
      }

      if (!matches) continue;

      // Calculate cashback with streak multiplier
      let cashback = tx.amount * rule.cashback_percent * streakMultiplier;
      if (rule.max_cashback_usd) {
        cashback = Math.min(cashback, rule.max_cashback_usd);
      }

      // Respect daily cap
      const remaining = CONFIG.hooks.cashbackMaxDailyUsd - dailyTotal.total - totalCashback;
      if (remaining <= 0) break;
      cashback = Math.min(cashback, remaining);

      cashback = Math.round(cashback * 100) / 100; // Round to cents

      if (cashback > 0) {
        this.db.prepare(`
          INSERT INTO cashback_ledger (id, user_id, transaction_id, rule_id, original_amount, cashback_amount, currency, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(uuid(), userId, tx.id, rule.id, tx.amount, cashback, tx.currency, now);

        totalCashback += cashback;
        this.logger.info(`[Cashback] ${userId}: $${cashback} from rule "${rule.name}" (tx: $${tx.amount})`);
      }
    }

    return totalCashback;
  }

  /** Credit all pending cashback entries. Run daily. Returns count credited. */
  creditPending(): number {
    const pending = this.db.prepare(
      "SELECT * FROM cashback_ledger WHERE status = 'pending'"
    ).all() as Array<{ id: string; user_id: string; cashback_amount: number }>;

    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      "UPDATE cashback_ledger SET status = 'credited', credited_at = ? WHERE id = ?"
    );

    let credited = 0;
    for (const entry of pending) {
      stmt.run(now, entry.id);
      credited++;
    }

    if (credited > 0) {
      this.logger.info(`[Cashback] Credited ${credited} pending entries`);
    }
    return credited;
  }

  /** Get cashback summary for a user */
  getUserSummary(userId: string): { pending: number; credited: number; total: number } {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status = 'pending' THEN cashback_amount END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'credited' THEN cashback_amount END), 0) as credited,
        COALESCE(SUM(cashback_amount), 0) as total
      FROM cashback_ledger WHERE user_id = ?
    `).get(userId) as { pending: number; credited: number; total: number };
    return row;
  }

  /** Get global cashback stats */
  getStats(): { totalRules: number; activeRules: number; pendingCredits: number; totalCredited: number } {
    const rules = this.db.prepare('SELECT COUNT(*) as total, COUNT(CASE WHEN enabled = 1 THEN 1 END) as active FROM cashback_rules').get() as { total: number; active: number };
    const ledger = this.db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN cashback_amount END), 0) as pending,
        COALESCE(SUM(CASE WHEN status = 'credited' THEN cashback_amount END), 0) as credited
      FROM cashback_ledger
    `).get() as { pending: number; credited: number };

    return { totalRules: rules.total, activeRules: rules.active, pendingCredits: ledger.pending, totalCredited: ledger.credited };
  }
}
