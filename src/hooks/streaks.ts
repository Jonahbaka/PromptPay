// ═══════════════════════════════════════════════════════════════
// PromptPay :: Streak Engine
// Track consecutive days of activity with multiplier rewards
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import type { LoggerHandle } from '../core/types.js';

export class StreakEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Record user activity for today. Returns updated streak info. */
  recordActivity(userId: string): { currentStreak: number; multiplier: number; isNew: boolean } {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const now = new Date().toISOString();

    const existing = this.db.prepare(
      'SELECT * FROM user_streaks WHERE user_id = ?'
    ).get(userId) as { current_streak: number; longest_streak: number; last_activity_date: string; total_streak_days: number; streak_start_date: string | null } | undefined;

    if (!existing) {
      // First ever activity
      this.db.prepare(`
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date, multiplier, streak_start_date, total_streak_days, created_at, updated_at)
        VALUES (?, 1, 1, ?, 1.05, ?, 1, ?, ?)
      `).run(userId, today, today, now, now);

      return { currentStreak: 1, multiplier: 1.05, isNew: true };
    }

    if (existing.last_activity_date === today) {
      // Already recorded today
      const multiplier = Math.min(1.0 + existing.current_streak * 0.05, 3.0);
      return { currentStreak: existing.current_streak, multiplier, isNew: false };
    }

    let newStreak: number;
    let streakStart: string | null;

    if (existing.last_activity_date === yesterday) {
      // Consecutive day — increment
      newStreak = existing.current_streak + 1;
      streakStart = existing.streak_start_date;
    } else {
      // Streak broken — restart
      newStreak = 1;
      streakStart = today;
    }

    const longestStreak = Math.max(existing.longest_streak, newStreak);
    const multiplier = Math.min(1.0 + newStreak * 0.05, 3.0);
    const totalDays = existing.total_streak_days + 1;

    this.db.prepare(`
      UPDATE user_streaks SET current_streak = ?, longest_streak = ?, last_activity_date = ?,
        multiplier = ?, streak_start_date = ?, total_streak_days = ?, updated_at = ?
      WHERE user_id = ?
    `).run(newStreak, longestStreak, today, multiplier, streakStart, totalDays, now, userId);

    if (newStreak > 1) {
      this.logger.info(`[Streak] ${userId}: ${newStreak} days (${multiplier}x multiplier)`);
    }

    return { currentStreak: newStreak, multiplier, isNew: false };
  }

  /** Get the streak multiplier for a user. Returns 1.0 if no streak. */
  getMultiplier(userId: string): number {
    const row = this.db.prepare('SELECT multiplier FROM user_streaks WHERE user_id = ?').get(userId) as { multiplier: number } | undefined;
    return row?.multiplier ?? 1.0;
  }

  /** Get user's current streak. Returns null if no record. */
  getStreak(userId: string): { currentStreak: number; longestStreak: number; multiplier: number; totalDays: number } | null {
    const row = this.db.prepare('SELECT * FROM user_streaks WHERE user_id = ?').get(userId) as {
      current_streak: number; longest_streak: number; multiplier: number; total_streak_days: number;
    } | undefined;

    if (!row) return null;
    return { currentStreak: row.current_streak, longestStreak: row.longest_streak, multiplier: row.multiplier, totalDays: row.total_streak_days };
  }

  /** Expire streaks that are 2+ days stale. Run daily. */
  expireStaleStreaks(): number {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];

    const result = this.db.prepare(`
      UPDATE user_streaks SET current_streak = 0, multiplier = 1.0, streak_start_date = NULL, updated_at = ?
      WHERE last_activity_date < ? AND current_streak > 0
    `).run(new Date().toISOString(), twoDaysAgo);

    if (result.changes > 0) {
      this.logger.info(`[Streak] Expired ${result.changes} stale streaks`);
    }
    return result.changes;
  }

  /** Get streak leaderboard */
  getLeaderboard(limit = 20): Array<{ userId: string; currentStreak: number; longestStreak: number; multiplier: number }> {
    return this.db.prepare(
      'SELECT user_id, current_streak, longest_streak, multiplier FROM user_streaks WHERE current_streak > 0 ORDER BY current_streak DESC LIMIT ?'
    ).all(limit) as Array<{ user_id: string; current_streak: number; longest_streak: number; multiplier: number }> as unknown as Array<{ userId: string; currentStreak: number; longestStreak: number; multiplier: number }>;
  }

  /** Get aggregate stats */
  getStats(): { totalUsers: number; activeStreaks: number; avgStreak: number; maxStreak: number } {
    const row = this.db.prepare(`
      SELECT COUNT(*) as total, COUNT(CASE WHEN current_streak > 0 THEN 1 END) as active,
        AVG(CASE WHEN current_streak > 0 THEN current_streak END) as avg_streak,
        MAX(current_streak) as max_streak
      FROM user_streaks
    `).get() as { total: number; active: number; avg_streak: number | null; max_streak: number | null };

    return { totalUsers: row.total, activeStreaks: row.active, avgStreak: row.avg_streak || 0, maxStreak: row.max_streak || 0 };
  }
}
