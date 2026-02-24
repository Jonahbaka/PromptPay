// ═══════════════════════════════════════════════════════════════
// PromptPay :: Achievement Engine
// Milestone detection, unlocking, and reward distribution
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';

export class AchievementEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Check and unlock any new milestones for a user. Returns newly unlocked achievements. */
  checkMilestones(userId: string): Array<{ id: string; name: string; pointsReward: number; cashbackReward: number }> {
    const definitions = this.db.prepare(
      'SELECT * FROM achievement_definitions WHERE enabled = 1'
    ).all() as Array<{
      id: string; name: string; description: string; category: string;
      condition_type: string; condition_threshold: number;
      points_reward: number; cashback_reward: number;
    }>;

    // Get user's already-unlocked achievements
    const unlocked = new Set(
      (this.db.prepare('SELECT achievement_id FROM user_achievements WHERE user_id = ?').all(userId) as Array<{ achievement_id: string }>)
        .map(r => r.achievement_id)
    );

    // Get user stats for checking
    const stats = this.getUserStats(userId);
    const now = new Date().toISOString();
    const newlyUnlocked: Array<{ id: string; name: string; pointsReward: number; cashbackReward: number }> = [];

    for (const def of definitions) {
      if (unlocked.has(def.id)) continue;

      let value = 0;
      switch (def.condition_type) {
        case 'payment_count': value = stats.paymentCount; break;
        case 'total_saved': value = stats.totalSaved; break;
        case 'streak_days': value = stats.currentStreak; break;
        case 'referral_count': value = stats.referralCount; break;
        case 'total_volume': value = stats.totalVolume; break;
        case 'autopay_count': value = stats.autopayCount; break;
        case 'goals_completed': value = stats.goalsCompleted; break;
        case 'loyalty_tier': value = stats.loyaltyLifetimeEarned; break;
        default: continue;
      }

      if (value >= def.condition_threshold) {
        this.db.prepare(`
          INSERT OR IGNORE INTO user_achievements (id, user_id, achievement_id, unlocked_at, notified)
          VALUES (?, ?, ?, ?, 0)
        `).run(uuid(), userId, def.id, now);

        newlyUnlocked.push({
          id: def.id, name: def.name,
          pointsReward: def.points_reward, cashbackReward: def.cashback_reward,
        });

        this.logger.info(`[Achievement] ${userId} unlocked: "${def.name}" (+${def.points_reward} pts)`);
      }
    }

    return newlyUnlocked;
  }

  private getUserStats(userId: string): {
    paymentCount: number; totalSaved: number; currentStreak: number;
    referralCount: number; totalVolume: number; autopayCount: number;
    goalsCompleted: number; loyaltyLifetimeEarned: number;
  } {
    const paymentCount = (this.db.prepare(
      "SELECT COUNT(*) as c FROM execution_log WHERE agent_id = ? AND action LIKE '%payment%' AND success = 1"
    ).get(userId) as { c: number } | undefined)?.c || 0;

    const totalSaved = (this.db.prepare(
      'SELECT COALESCE(SUM(current_amount), 0) as total FROM savings_goals WHERE user_id = ?'
    ).get(userId) as { total: number } | undefined)?.total || 0;

    const streak = (this.db.prepare(
      'SELECT current_streak FROM user_streaks WHERE user_id = ?'
    ).get(userId) as { current_streak: number } | undefined)?.current_streak || 0;

    const referralCount = (this.db.prepare(
      'SELECT COUNT(*) as c FROM referral_events WHERE referrer_user_id = ? AND tier = 1'
    ).get(userId) as { c: number } | undefined)?.c || 0;

    const goalsCompleted = (this.db.prepare(
      "SELECT COUNT(*) as c FROM savings_goals WHERE user_id = ? AND status = 'completed'"
    ).get(userId) as { c: number } | undefined)?.c || 0;

    const loyaltyLifetimeEarned = (this.db.prepare(
      'SELECT lifetime_earned FROM loyalty_accounts WHERE user_id = ?'
    ).get(userId) as { lifetime_earned: number } | undefined)?.lifetime_earned || 0;

    return {
      paymentCount, totalSaved, currentStreak: streak,
      referralCount, totalVolume: 0, autopayCount: 0,
      goalsCompleted, loyaltyLifetimeEarned,
    };
  }

  /** Get all achievements for a user */
  getUserAchievements(userId: string): Array<{ achievementId: string; name: string; description: string; unlockedAt: string }> {
    return this.db.prepare(`
      SELECT ua.achievement_id as achievementId, ad.name, ad.description, ua.unlocked_at as unlockedAt
      FROM user_achievements ua JOIN achievement_definitions ad ON ua.achievement_id = ad.id
      WHERE ua.user_id = ? ORDER BY ua.unlocked_at DESC
    `).all(userId) as Array<{ achievementId: string; name: string; description: string; unlockedAt: string }>;
  }

  /** Get achievement unlock stats */
  getStats(): { totalDefinitions: number; totalUnlocks: number; mostUnlocked: Array<{ name: string; count: number }> } {
    const defs = (this.db.prepare('SELECT COUNT(*) as c FROM achievement_definitions WHERE enabled = 1').get() as { c: number }).c;
    const unlocks = (this.db.prepare('SELECT COUNT(*) as c FROM user_achievements').get() as { c: number }).c;
    const most = this.db.prepare(`
      SELECT ad.name, COUNT(*) as count FROM user_achievements ua
      JOIN achievement_definitions ad ON ua.achievement_id = ad.id
      GROUP BY ua.achievement_id ORDER BY count DESC LIMIT 10
    `).all() as Array<{ name: string; count: number }>;

    return { totalDefinitions: defs, totalUnlocks: unlocks, mostUnlocked: most };
  }
}
