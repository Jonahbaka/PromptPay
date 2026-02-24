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

  /** Credit pending referral bonuses. */
  creditPending(): number {
    const pending = this.db.prepare("SELECT id FROM referral_events WHERE status = 'pending'").all() as Array<{ id: string }>;
    const now = new Date().toISOString();

    for (const p of pending) {
      this.db.prepare("UPDATE referral_events SET status = 'credited', credited_at = ? WHERE id = ?").run(now, p.id);
    }

    return pending.length;
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
