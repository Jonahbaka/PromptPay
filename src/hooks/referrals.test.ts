import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../core/config.js', () => ({
  CONFIG: {
    hooks: {
      referralBonusUsd: 10,
      referralTiers: 2,
      cashbackMaxDailyUsd: 50,
      loyaltyPointsPerDollar: 10,
      reminderLeadTimeHours: 24,
    },
  },
}));

const { ReferralEngine } = await import('./referrals.js');

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS referral_codes (
      code TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      uses_count INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 0,
      bonus_usd REAL NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS referral_events (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      referrer_user_id TEXT NOT NULL,
      referred_user_id TEXT NOT NULL,
      tier INTEGER DEFAULT 1,
      bonus_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      credited_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('ReferralEngine', () => {
  let db: InstanceType<typeof Database>;
  let engine: InstanceType<typeof ReferralEngine>;

  beforeEach(() => {
    db = createDb();
    engine = new ReferralEngine(db, mockLogger);
  });

  describe('generateCode', () => {
    it('creates a valid PP-XXXXXX code', () => {
      const code = engine.generateCode('user-1');

      expect(code).toMatch(/^PP-[0-9A-F]{6}$/);

      // Verify it was stored in the DB
      const row = db.prepare('SELECT * FROM referral_codes WHERE code = ?').get(code) as {
        owner_user_id: string; bonus_usd: number; enabled: number; uses_count: number;
      };
      expect(row.owner_user_id).toBe('user-1');
      expect(row.bonus_usd).toBe(10);
      expect(row.enabled).toBe(1);
      expect(row.uses_count).toBe(0);
    });
  });

  describe('redeemCode', () => {
    it('credits referrer and records event', () => {
      const now = new Date().toISOString();

      // Insert a referral code directly
      db.prepare(`
        INSERT INTO referral_codes (code, owner_user_id, uses_count, max_uses, bonus_usd, enabled, created_at)
        VALUES (?, ?, 0, 0, 10, 1, ?)
      `).run('PP-ABC123', 'referrer-1', now);

      const result = engine.redeemCode('PP-ABC123', 'new-user-1');

      expect(result.success).toBe(true);
      expect(result.referrerBonus).toBe(10);
      expect(result.newUserBonus).toBe(10);

      // Verify event was recorded
      const event = db.prepare('SELECT * FROM referral_events WHERE referred_user_id = ?').get('new-user-1') as {
        referrer_user_id: string; bonus_amount: number; tier: number; status: string;
      };
      expect(event.referrer_user_id).toBe('referrer-1');
      expect(event.bonus_amount).toBe(10);
      expect(event.tier).toBe(1);
      expect(event.status).toBe('pending');

      // Verify uses_count incremented
      const code = db.prepare('SELECT uses_count FROM referral_codes WHERE code = ?').get('PP-ABC123') as { uses_count: number };
      expect(code.uses_count).toBe(1);
    });

    it('fails for an invalid code', () => {
      const result = engine.redeemCode('PP-INVALID', 'new-user-2');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid or disabled referral code');
    });
  });

  describe('getStats', () => {
    it('returns correct stats', () => {
      const now = new Date().toISOString();

      // Insert a code
      db.prepare(`
        INSERT INTO referral_codes (code, owner_user_id, uses_count, max_uses, bonus_usd, enabled, created_at)
        VALUES (?, ?, 1, 0, 10, 1, ?)
      `).run('PP-STAT01', 'referrer-1', now);

      // Insert a credited event
      db.prepare(`
        INSERT INTO referral_events (id, code, referrer_user_id, referred_user_id, tier, bonus_amount, status, credited_at, created_at)
        VALUES (?, ?, ?, ?, 1, 10, 'credited', ?, ?)
      `).run('evt-1', 'PP-STAT01', 'referrer-1', 'referred-1', now, now);

      const stats = engine.getStats();

      expect(stats.totalCodes).toBe(1);
      expect(stats.totalRedemptions).toBe(1);
      expect(stats.totalBonusPaid).toBe(10);
      expect(stats.topReferrers).toHaveLength(1);
      expect(stats.topReferrers[0].userId).toBe('referrer-1');
      expect(stats.topReferrers[0].count).toBe(1);
    });
  });
});
