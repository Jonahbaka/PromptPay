// ═══════════════════════════════════════════════════════════════
// PromptPay :: Referral Engine
// Referral codes, multi-tier bonuses, usage tracking
// ═══════════════════════════════════════════════════════════════

import { randomBytes } from 'crypto';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';

export class ReferralEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Generate a unique referral code for a user. */
  generateCode(userId: string): string {
    // Check if user already has a code
    const existing = this.db.prepare(
      'SELECT code FROM referral_codes WHERE owner_user_id = ? AND enabled = 1'
    ).get(userId) as { code: string } | undefined;

    if (existing) return existing.code;

    const code = 'PP-' + randomBytes(3).toString('hex').toUpperCase();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO referral_codes (code, owner_user_id, uses_count, max_uses, bonus_usd, enabled, created_at)
      VALUES (?, ?, 0, 0, ?, 1, ?)
    `).run(code, userId, CONFIG.hooks.referralBonusUsd, now);

    this.logger.info(`[Referral] Code generated for ${userId}: ${code}`);
    return code;
  }

  /** Redeem a referral code. Credits bonuses to both referrer and new user. */
  redeemCode(code: string, newUserId: string): { success: boolean; error?: string; referrerBonus?: number; newUserBonus?: number } {
    const codeRecord = this.db.prepare(
      'SELECT * FROM referral_codes WHERE code = ? AND enabled = 1'
    ).get(code) as { code: string; owner_user_id: string; uses_count: number; max_uses: number; bonus_usd: number } | undefined;

    if (!codeRecord) {
      return { success: false, error: 'Invalid or disabled referral code' };
    }

    if (codeRecord.owner_user_id === newUserId) {
      return { success: false, error: 'Cannot use your own referral code' };
    }

    if (codeRecord.max_uses > 0 && codeRecord.uses_count >= codeRecord.max_uses) {
      return { success: false, error: 'Referral code has reached maximum uses' };
    }

    // Check if new user already used a code
    const alreadyReferred = this.db.prepare(
      'SELECT id FROM referral_events WHERE referred_user_id = ?'
    ).get(newUserId);

    if (alreadyReferred) {
      return { success: false, error: 'User has already been referred' };
    }

    const now = new Date().toISOString();
    const bonusAmount = codeRecord.bonus_usd;

    // Tier 1: Direct referral — both get bonus
    this.db.prepare(`
      INSERT INTO referral_events (id, code, referrer_user_id, referred_user_id, tier, bonus_amount, status, created_at)
      VALUES (?, ?, ?, ?, 1, ?, 'pending', ?)
    `).run(uuid(), code, codeRecord.owner_user_id, newUserId, bonusAmount, now);

    // Tier 2: If the referrer was themselves referred, credit the "grandparent"
    let tier2Bonus = 0;
    if (CONFIG.hooks.referralTiers >= 2) {
      const referrerReferral = this.db.prepare(
        'SELECT referrer_user_id FROM referral_events WHERE referred_user_id = ? AND tier = 1'
      ).get(codeRecord.owner_user_id) as { referrer_user_id: string } | undefined;

      if (referrerReferral) {
        tier2Bonus = Math.round(bonusAmount * 0.25 * 100) / 100; // 25% of tier 1 bonus
        this.db.prepare(`
          INSERT INTO referral_events (id, code, referrer_user_id, referred_user_id, tier, bonus_amount, status, created_at)
          VALUES (?, ?, ?, ?, 2, ?, 'pending', ?)
        `).run(uuid(), code, referrerReferral.referrer_user_id, newUserId, tier2Bonus, now);
      }
    }

    // Increment uses count
    this.db.prepare('UPDATE referral_codes SET uses_count = uses_count + 1 WHERE code = ?').run(code);

    this.logger.info(`[Referral] ${code} redeemed by ${newUserId}. Referrer: $${bonusAmount}, New user: $${bonusAmount}`);

    return { success: true, referrerBonus: bonusAmount, newUserBonus: bonusAmount };
  }

  /** Credit pending referral bonuses (delegates to 3-tx validation). */
  creditPending(): number {
    return this.checkAndCreditEligible();
  }

  /**
   * For each pending referral_event, verify the referred user completed
   * 3+ real transactions on 3+ distinct days before crediting the referrer.
   */
  private checkAndCreditEligible(): number {
    const pending = this.db.prepare(
      "SELECT id, referrer_user_id, referred_user_id, bonus_amount FROM referral_events WHERE status = 'pending'"
    ).all() as Array<{ id: string; referrer_user_id: string; referred_user_id: string; bonus_amount: number }>;

    let credited = 0;
    const now = new Date().toISOString();

    for (const evt of pending) {
      // Check referred user has 3+ fee_ledger entries with amount > 0 on 3+ distinct days
      const txCheck = this.db.prepare(`
        SELECT COUNT(*) as tx_count, COUNT(DISTINCT DATE(created_at)) as distinct_days
        FROM fee_ledger
        WHERE user_id = ? AND amount > 0
      `).get(evt.referred_user_id) as { tx_count: number; distinct_days: number };

      if (txCheck.tx_count >= 3 && txCheck.distinct_days >= 3) {
        // Eligible — credit the referrer's reward balance
        this.creditRewardBalance(
          evt.referrer_user_id,
          evt.bonus_amount,
          evt.id,
          `Referral bonus: referred user completed ${txCheck.tx_count} transactions`
        );
        this.db.prepare(
          "UPDATE referral_events SET status = 'credited', credited_at = ? WHERE id = ?"
        ).run(now, evt.id);
        credited++;
        this.logger.info(`[Referral] Credited $${evt.bonus_amount} to ${evt.referrer_user_id} (event ${evt.id})`);
      }
      // Otherwise skip — will be re-checked on next daemon cycle
    }

    return credited;
  }

  /** Upsert reward balance and record a reward transaction. */
  private creditRewardBalance(userId: string, amount: number, referenceId: string, description: string): void {
    const now = new Date().toISOString();

    // Upsert reward_balances
    this.db.prepare(`
      INSERT INTO reward_balances (user_id, balance, lifetime_earned, last_credited_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        balance = balance + ?,
        lifetime_earned = lifetime_earned + ?,
        last_credited_at = ?
    `).run(userId, amount, amount, now, now, amount, amount, now);

    // Record transaction
    this.db.prepare(`
      INSERT INTO reward_transactions (id, user_id, amount, type, reference_id, description, created_at)
      VALUES (?, ?, ?, 'referral_bonus', ?, ?, ?)
    `).run(uuid(), userId, amount, referenceId, description, now);
  }

  /** Get a user's current reward balance. */
  getRewardBalance(userId: string): { balance: number; lifetimeEarned: number; lastCreditedAt: string | null } {
    const row = this.db.prepare(
      'SELECT balance, lifetime_earned, last_credited_at FROM reward_balances WHERE user_id = ?'
    ).get(userId) as { balance: number; lifetime_earned: number; last_credited_at: string | null } | undefined;

    return {
      balance: row?.balance ?? 0,
      lifetimeEarned: row?.lifetime_earned ?? 0,
      lastCreditedAt: row?.last_credited_at ?? null,
    };
  }

  /** Admin-only: credit a reward balance with an admin_credit transaction type. */
  adminCreditReward(userId: string, amount: number, description: string): void {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO reward_balances (user_id, balance, lifetime_earned, last_credited_at, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        balance = balance + ?,
        lifetime_earned = lifetime_earned + ?,
        last_credited_at = ?
    `).run(userId, amount, amount, now, now, amount, amount, now);

    this.db.prepare(`
      INSERT INTO reward_transactions (id, user_id, amount, type, reference_id, description, created_at)
      VALUES (?, ?, ?, 'admin_credit', NULL, ?, ?)
    `).run(uuid(), userId, amount, description, now);

    this.logger.info(`[Referral] Admin credited $${amount} reward to ${userId}: ${description}`);
  }

  /** Get referral stats */
  getStats(): { totalCodes: number; totalRedemptions: number; totalBonusPaid: number; topReferrers: Array<{ userId: string; count: number }> } {
    const codes = (this.db.prepare('SELECT COUNT(*) as c FROM referral_codes').get() as { c: number }).c;
    const redemptions = (this.db.prepare('SELECT COUNT(*) as c FROM referral_events WHERE tier = 1').get() as { c: number }).c;
    const bonusPaid = (this.db.prepare("SELECT COALESCE(SUM(bonus_amount), 0) as total FROM referral_events WHERE status = 'credited'").get() as { total: number }).total;

    const topReferrers = this.db.prepare(`
      SELECT referrer_user_id as userId, COUNT(*) as count
      FROM referral_events WHERE tier = 1
      GROUP BY referrer_user_id ORDER BY count DESC LIMIT 10
    `).all() as Array<{ userId: string; count: number }>;

    return { totalCodes: codes, totalRedemptions: redemptions, totalBonusPaid: bonusPaid, topReferrers };
  }
}
