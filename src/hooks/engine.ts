// ═══════════════════════════════════════════════════════════════
// PromptPay :: Hook Engine — Central Dispatcher
// Wires all 9 engagement modules into a single pipeline
// Called after every transaction + on scheduled jobs
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import type { LoggerHandle } from '../core/types.js';
import { StreakEngine } from './streaks.js';
import { CashbackEngine, type TransactionEvent } from './cashback.js';
import { ReferralEngine } from './referrals.js';
import { SavingsEngine } from './savings.js';
import { AchievementEngine } from './achievements.js';
import { LoyaltyEngine } from './loyalty.js';
import { InsightsEngine } from './insights.js';
import { RemindersEngine } from './reminders.js';

export class HookEngine {
  readonly streaks: StreakEngine;
  readonly cashback: CashbackEngine;
  readonly referrals: ReferralEngine;
  readonly savings: SavingsEngine;
  readonly achievements: AchievementEngine;
  readonly loyalty: LoyaltyEngine;
  readonly insights: InsightsEngine;
  readonly reminders: RemindersEngine;

  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;

    this.streaks = new StreakEngine(db, logger);
    this.cashback = new CashbackEngine(db, logger);
    this.referrals = new ReferralEngine(db, logger);
    this.savings = new SavingsEngine(db, logger);
    this.achievements = new AchievementEngine(db, logger);
    this.loyalty = new LoyaltyEngine(db, logger);
    this.insights = new InsightsEngine(db, logger);
    this.reminders = new RemindersEngine(db, logger);

    this.logger.info('[HookEngine] All 9 engagement modules initialized');
  }

  /**
   * Called after every successful transaction.
   * Runs the full engagement pipeline:
   *   streak → cashback → savings → loyalty → achievements
   */
  onTransactionCompleted(userId: string, tx: TransactionEvent): {
    streakMultiplier: number;
    cashbackEarned: number;
    amountSaved: number;
    loyaltyPoints: number;
    newAchievements: Array<{ name: string; pointsReward: number }>;
  } {
    // 1. Record activity for streak
    this.streaks.recordActivity(userId);
    const streakMultiplier = this.streaks.getMultiplier(userId);

    // 2. Process cashback (uses streak multiplier)
    const cashbackEarned = this.cashback.processTransaction(userId, tx);

    // 3. Auto-save rules
    const amountSaved = this.savings.processTransaction(userId, tx);

    // 4. Award loyalty points (uses streak multiplier)
    const loyaltyPoints = this.loyalty.awardPoints(userId, tx.amount, tx.type, streakMultiplier);

    // 5. Check milestones — award points for any new achievements
    const newAchievements = this.achievements.checkMilestones(userId);
    for (const achievement of newAchievements) {
      if (achievement.pointsReward > 0) {
        this.loyalty.awardBonus(userId, achievement.pointsReward, `Achievement: ${achievement.name}`, achievement.id);
      }
    }

    this.logger.info(
      `[HookEngine] ${userId} tx pipeline: streak=${streakMultiplier}x, cashback=$${cashbackEarned}, ` +
      `saved=$${amountSaved}, loyalty=+${loyaltyPoints}pts, achievements=${newAchievements.length}`
    );

    return {
      streakMultiplier,
      cashbackEarned,
      amountSaved,
      loyaltyPoints,
      newAchievements: newAchievements.map(a => ({ name: a.name, pointsReward: a.pointsReward })),
    };
  }

  /** Daily scheduled jobs — run once per day */
  runDailyJobs(): {
    expiredStreaks: number;
    cashbackCredited: number;
    remindersCreated: number;
    loyaltyExpired: number;
  } {
    this.logger.info('[HookEngine] Running daily jobs...');

    // 1. Expire stale streaks
    const expiredStreaks = this.streaks.expireStaleStreaks();

    // 2. Credit pending cashback to wallets
    const cashbackCredited = this.cashback.creditPending();

    // 3. Generate bill reminders
    const remindersCreated = this.reminders.generateReminders();

    // 4. Process loyalty point expirations
    const loyaltyExpired = this.loyalty.processExpirations();

    this.logger.info(
      `[HookEngine] Daily jobs done: ${expiredStreaks} streaks expired, ` +
      `${cashbackCredited} cashback credited, ${remindersCreated} reminders, ` +
      `${loyaltyExpired} loyalty batches expired`
    );

    return { expiredStreaks, cashbackCredited, remindersCreated, loyaltyExpired };
  }

  /** Weekly scheduled jobs — run once per week */
  runWeeklyJobs(userIds: string[]): { insightsGenerated: number } {
    this.logger.info(`[HookEngine] Running weekly jobs for ${userIds.length} users...`);

    let insightsGenerated = 0;
    for (const userId of userIds) {
      try {
        this.insights.generateWeeklyInsight(userId);
        insightsGenerated++;
      } catch (err) {
        this.logger.error(`[HookEngine] Insight generation failed for ${userId}: ${err}`);
      }
    }

    this.logger.info(`[HookEngine] Weekly jobs done: ${insightsGenerated} insights generated`);
    return { insightsGenerated };
  }

  /** Get aggregated stats across all hook modules */
  getStats(): Record<string, unknown> {
    return {
      streaks: this.streaks.getStats(),
      cashback: this.cashback.getStats(),
      referrals: this.referrals.getStats(),
      savings: this.savings.getStats(),
      achievements: this.achievements.getStats(),
      loyalty: this.loyalty.getStats(),
      insights: this.insights.getStats(),
      reminders: this.reminders.getStats(),
    };
  }
}
