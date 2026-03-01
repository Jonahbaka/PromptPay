// ═══════════════════════════════════════════════════════════════
// POS Settlement Service
// Records agent stats, credits commission, handles super-agent
// override commission. Called after every successful sale/bill.
// ═══════════════════════════════════════════════════════════════

import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';

export interface AgentSaleOpts {
  agentUserId: string;
  txId: string;
  sourceType: 'airtime' | 'data' | 'bill';
  faceValue: number;
  agentProfit: number;
}

/**
 * Record an agent sale: update stats, credit commission, handle override.
 * This is THE fix for the bug where pos_agents stats were never updated.
 */
export function recordAgentSale(db: Database.Database, opts: AgentSaleOpts): void {
  const { agentUserId, txId, sourceType, faceValue, agentProfit } = opts;
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // 1. Get agent record
  const agent = db.prepare('SELECT * FROM pos_agents WHERE user_id = ?').get(agentUserId) as Record<string, unknown> | undefined;
  if (!agent) return; // Not a registered agent — skip silently

  // 2. Reset daily_used if stale (not today)
  if (agent.daily_reset_date !== today) {
    db.prepare('UPDATE pos_agents SET daily_used = 0, daily_reset_date = ? WHERE id = ?').run(today, agent.id);
  }

  // 3. Update pos_agents stats (THE BUG FIX)
  db.prepare(`
    UPDATE pos_agents
    SET daily_used = daily_used + ?,
        total_transactions = total_transactions + 1,
        total_volume = total_volume + ?,
        updated_at = ?
    WHERE id = ?
  `).run(faceValue, faceValue, now, agent.id);

  // 4. Credit agent wallet total_earned
  if (agentProfit > 0) {
    db.prepare(`
      UPDATE user_wallets SET total_earned = total_earned + ?, updated_at = ? WHERE user_id = ?
    `).run(agentProfit, now, agentUserId);
  }

  // 5. Read commission rate from platform_settings
  const commRow = db.prepare("SELECT value FROM platform_settings WHERE key = 'agent_commission_pct'").get() as { value: string } | undefined;
  const commissionRate = parseFloat(commRow?.value || '0.75') / 100;
  const commissionAmount = Math.round(faceValue * commissionRate * 100) / 100;

  // 6. Record in commission_ledger
  db.prepare(`
    INSERT INTO commission_ledger (id, agent_user_id, source_tx_id, source_type, gross_amount, commission_rate, commission_amount, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), agentUserId, txId, sourceType, faceValue, commissionRate, commissionAmount, now);

  // 7. Check for super agent (override commission)
  let parentAgentId: string | null = null;
  try {
    parentAgentId = (agent.parent_agent_id as string) || null;
  } catch { /* column may not exist yet */ }

  if (parentAgentId) {
    const superAgent = db.prepare('SELECT * FROM pos_agents WHERE id = ?').get(parentAgentId) as Record<string, unknown> | undefined;
    if (superAgent) {
      const overrideRow = db.prepare("SELECT value FROM platform_settings WHERE key = 'super_agent_override_pct'").get() as { value: string } | undefined;
      const overrideRate = parseFloat(overrideRow?.value || '0.15') / 100;
      const overrideAmount = Math.round(faceValue * overrideRate * 100) / 100;

      if (overrideAmount > 0) {
        // Credit super agent's wallet
        const superUserId = superAgent.user_id as string;
        db.prepare(`
          UPDATE user_wallets SET total_earned = total_earned + ?, updated_at = ? WHERE user_id = ?
        `).run(overrideAmount, now, superUserId);

        // Record override commission
        db.prepare(`
          INSERT INTO commission_ledger (id, agent_user_id, source_tx_id, source_type, gross_amount, commission_rate, commission_amount, override_from, override_rate, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(uuid(), superUserId, txId, sourceType, faceValue, overrideRate, overrideAmount, agentUserId, overrideRate, now);
      }
    }
  }
}

/**
 * Check if agent would exceed daily limit with this sale.
 * Returns { allowed, dailyUsed, dailyLimit, dailyRemaining }.
 */
export function checkDailyLimit(db: Database.Database, agentUserId: string, amount: number): {
  allowed: boolean;
  dailyUsed: number;
  dailyLimit: number;
  dailyRemaining: number;
} {
  const today = new Date().toISOString().slice(0, 10);
  const agent = db.prepare('SELECT * FROM pos_agents WHERE user_id = ?').get(agentUserId) as Record<string, unknown> | undefined;

  if (!agent) {
    return { allowed: true, dailyUsed: 0, dailyLimit: Infinity, dailyRemaining: Infinity };
  }

  // Reset if stale
  let dailyUsed = agent.daily_used as number || 0;
  if (agent.daily_reset_date !== today) {
    db.prepare('UPDATE pos_agents SET daily_used = 0, daily_reset_date = ? WHERE id = ?').run(today, agent.id);
    dailyUsed = 0;
  }

  const dailyLimit = agent.daily_limit as number || 50000;
  const dailyRemaining = Math.max(0, dailyLimit - dailyUsed);

  return {
    allowed: dailyUsed + amount <= dailyLimit,
    dailyUsed,
    dailyLimit,
    dailyRemaining,
  };
}
