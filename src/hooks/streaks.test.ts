import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { StreakEngine } from './streaks.js';

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id TEXT PRIMARY KEY,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_activity_date TEXT NOT NULL,
      multiplier REAL DEFAULT 1.0,
      streak_start_date TEXT,
      total_streak_days INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('StreakEngine', () => {
  let db: InstanceType<typeof Database>;
  let engine: StreakEngine;

  beforeEach(() => {
    db = createDb();
    engine = new StreakEngine(db, mockLogger);
  });

  describe('recordActivity', () => {
    it('creates a new streak with streak=1 and multiplier=1.05', () => {
      const result = engine.recordActivity('user-1');

      expect(result.isNew).toBe(true);
      expect(result.currentStreak).toBe(1);
      expect(result.multiplier).toBe(1.05);

      // Verify DB row
      const row = db.prepare('SELECT * FROM user_streaks WHERE user_id = ?').get('user-1') as {
        current_streak: number; multiplier: number; longest_streak: number;
      };
      expect(row.current_streak).toBe(1);
      expect(row.multiplier).toBe(1.05);
      expect(row.longest_streak).toBe(1);
    });

    it('increments streak on consecutive day activity', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Seed a streak from yesterday
      db.prepare(`
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date, multiplier, streak_start_date, total_streak_days, created_at, updated_at)
        VALUES (?, 3, 3, ?, 1.15, ?, 3, ?, ?)
      `).run('user-2', yesterday, yesterday, now, now);

      const result = engine.recordActivity('user-2');

      expect(result.isNew).toBe(false);
      expect(result.currentStreak).toBe(4);
      expect(result.multiplier).toBe(1.20); // 1.0 + 4 * 0.05
    });

    it('resets streak after a gap day', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Seed a streak from 2 days ago (missed yesterday)
      db.prepare(`
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date, multiplier, streak_start_date, total_streak_days, created_at, updated_at)
        VALUES (?, 5, 5, ?, 1.25, ?, 5, ?, ?)
      `).run('user-3', twoDaysAgo, twoDaysAgo, now, now);

      const result = engine.recordActivity('user-3');

      expect(result.isNew).toBe(false);
      expect(result.currentStreak).toBe(1);
      expect(result.multiplier).toBe(1.05); // Reset to 1 day streak

      // longest_streak should be preserved
      const row = db.prepare('SELECT longest_streak FROM user_streaks WHERE user_id = ?').get('user-3') as { longest_streak: number };
      expect(row.longest_streak).toBe(5);
    });
  });

  describe('getMultiplier', () => {
    it('returns 1.0 for an unknown user', () => {
      expect(engine.getMultiplier('nonexistent-user')).toBe(1.0);
    });
  });

  describe('expireStaleStreaks', () => {
    it('expires streaks that are 2+ days old', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().split('T')[0];
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date, multiplier, streak_start_date, total_streak_days, created_at, updated_at)
        VALUES (?, 10, 10, ?, 1.50, ?, 10, ?, ?)
      `).run('stale-user', threeDaysAgo, threeDaysAgo, now, now);

      const expired = engine.expireStaleStreaks();

      expect(expired).toBe(1);

      const row = db.prepare('SELECT current_streak, multiplier, streak_start_date FROM user_streaks WHERE user_id = ?').get('stale-user') as {
        current_streak: number; multiplier: number; streak_start_date: string | null;
      };
      expect(row.current_streak).toBe(0);
      expect(row.multiplier).toBe(1.0);
      expect(row.streak_start_date).toBeNull();
    });
  });

  describe('multiplier cap', () => {
    it('caps the multiplier at 3.0', () => {
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const now = new Date().toISOString();

      // Seed a streak of 50 days (way beyond the cap)
      db.prepare(`
        INSERT INTO user_streaks (user_id, current_streak, longest_streak, last_activity_date, multiplier, streak_start_date, total_streak_days, created_at, updated_at)
        VALUES (?, 50, 50, ?, 3.0, ?, 50, ?, ?)
      `).run('power-user', yesterday, yesterday, now, now);

      const result = engine.recordActivity('power-user');

      // 1.0 + 51 * 0.05 = 3.55, but capped at 3.0
      expect(result.multiplier).toBe(3.0);
      expect(result.currentStreak).toBe(51);
    });
  });
});
