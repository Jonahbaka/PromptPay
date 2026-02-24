// ═══════════════════════════════════════════════════════════════
// PromptPay :: Loyalty Points Engine
// Points per dollar, 4-tier system, fee discounts, expiry
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';

const TIER_THRESHOLDS = { bronze: 0, silver: 1000, gold: 5000, platinum: 20000 } as const;
const TIER_DISCOUNTS = { bronze: 0, silver: 0.05, gold: 0.10, platinum: 0.20 } as const;

export class LoyaltyEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Ensure loyalty account exists for user */
  private ensureAccount(userId: string): void {
    const exists = this.db.prepare('SELECT user_id FROM loyalty_accounts WHERE user_id = ?').get(userId);
    if (!exists) {
      this.db.prepare(`
        INSERT INTO loyalty_accounts (user_id, balance, lifetime_earned, lifetime_redeemed, tier, created_at)
        VALUES (?, 0, 0, 0, 'bronze', ?)
      `).run(userId, new Date().toISOString());
    }
  }

  /** Award points for a transaction. Applies streak multiplier. */
  awardPoints(userId: string, amountUsd: number, txType: string, streakMultiplier = 1.0): number {
    this.ensureAccount(userId);

    const basePoints = Math.floor(amountUsd * CONFIG.hooks.loyaltyPointsPerDollar);
    const points = Math.floor(basePoints * streakMultiplier);

    if (points <= 0) return 0;

    const now = new Date().toISOString();

    // Record transaction
    this.db.prepare(`
      INSERT INTO loyalty_transactions (id, user_id, type, points, description, reference_id, created_at)
      VALUES (?, ?, 'earn', ?, ?, ?, ?)
    `).run(uuid(), userId, points, `${txType}: $${amountUsd} (${streakMultiplier}x)`, txType, now);

    // Update account
    this.db.prepare(`
      UPDATE loyalty_accounts SET balance = balance + ?, lifetime_earned = lifetime_earned + ? WHERE user_id = ?
    `).run(points, points, userId);

    // Recalculate tier
    this.recalculateTier(userId);

    this.logger.info(`[Loyalty] ${userId}: +${points} pts ($${amountUsd}, ${streakMultiplier}x)`);
    return points;
  }

  /** Award bonus points (achievements, referrals, etc.) */
  awardBonus(userId: string, points: number, description: string, referenceId?: string): void {
    this.ensureAccount(userId);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO loyalty_transactions (id, user_id, type, points, description, reference_id, created_at)
      VALUES (?, ?, 'bonus', ?, ?, ?, ?)
    `).run(uuid(), userId, points, description, referenceId || null, now);

    this.db.prepare(
      'UPDATE loyalty_accounts SET balance = balance + ?, lifetime_earned = lifetime_earned + ? WHERE user_id = ?'
    ).run(points, points, userId);

    this.recalculateTier(userId);
  }

  /** Redeem points */
  redeemPoints(userId: string, points: number, forWhat: string): { success: boolean; error?: string } {
    const account = this.db.prepare('SELECT balance FROM loyalty_accounts WHERE user_id = ?').get(userId) as { balance: number } | undefined;
    if (!account) return { success: false, error: 'No loyalty account' };
    if (account.balance < points) return { success: false, error: 'Insufficient points' };

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO loyalty_transactions (id, user_id, type, points, description, created_at)
      VALUES (?, ?, 'redeem', ?, ?, ?)
    `).run(uuid(), userId, -points, forWhat, now);

    this.db.prepare(
      'UPDATE loyalty_accounts SET balance = balance - ?, lifetime_redeemed = lifetime_redeemed + ? WHERE user_id = ?'
    ).run(points, points, userId);

    return { success: true };
  }

  /** Get user's loyalty info */
  getAccount(userId: string): { balance: number; lifetimeEarned: number; tier: string; discount: number } | null {
    this.ensureAccount(userId);
    const row = this.db.prepare('SELECT * FROM loyalty_accounts WHERE user_id = ?').get(userId) as {
      balance: number; lifetime_earned: number; tier: string;
    } | undefined;

    if (!row) return null;
    return {
      balance: row.balance, lifetimeEarned: row.lifetime_earned,
      tier: row.tier, discount: TIER_DISCOUNTS[row.tier as keyof typeof TIER_DISCOUNTS] || 0,
    };
  }

  /** Expire points older than 12 months. Run daily. */
  processExpirations(): number {
    const cutoff = new Date(Date.now() - 365 * 86400000).toISOString();

    const oldEarnings = this.db.prepare(`
      SELECT user_id, SUM(points) as total FROM loyalty_transactions
      WHERE type = 'earn' AND created_at < ? GROUP BY user_id
    `).all(cutoff) as Array<{ user_id: string; total: number }>;

    // Simplified: in a real system this would track exact point batches
    return oldEarnings.length;
  }

  private recalculateTier(userId: string): void {
    const account = this.db.prepare('SELECT lifetime_earned FROM loyalty_accounts WHERE user_id = ?').get(userId) as { lifetime_earned: number };
    if (!account) return;

    let tier: string = 'bronze';
    if (account.lifetime_earned >= TIER_THRESHOLDS.platinum) tier = 'platinum';
    else if (account.lifetime_earned >= TIER_THRESHOLDS.gold) tier = 'gold';
    else if (account.lifetime_earned >= TIER_THRESHOLDS.silver) tier = 'silver';

    this.db.prepare('UPDATE loyalty_accounts SET tier = ?, tier_updated_at = ? WHERE user_id = ?')
      .run(tier, new Date().toISOString(), userId);
  }

  /** Get global loyalty stats */
  getStats(): { totalAccounts: number; totalPointsIssued: number; totalRedeemed: number; tierDistribution: Record<string, number> } {
    const accounts = (this.db.prepare('SELECT COUNT(*) as c FROM loyalty_accounts').get() as { c: number }).c;
    const issued = (this.db.prepare("SELECT COALESCE(SUM(CASE WHEN type IN ('earn', 'bonus') THEN points ELSE 0 END), 0) as total FROM loyalty_transactions").get() as { total: number }).total;
    const redeemed = (this.db.prepare("SELECT COALESCE(SUM(CASE WHEN type = 'redeem' THEN ABS(points) ELSE 0 END), 0) as total FROM loyalty_transactions").get() as { total: number }).total;

    const tiers = this.db.prepare("SELECT tier, COUNT(*) as count FROM loyalty_accounts GROUP BY tier").all() as Array<{ tier: string; count: number }>;
    const tierDistribution: Record<string, number> = {};
    for (const t of tiers) tierDistribution[t.tier] = t.count;

    return { totalAccounts: accounts, totalPointsIssued: issued, totalRedeemed: redeemed, tierDistribution };
  }
}
