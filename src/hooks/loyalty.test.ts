import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

vi.mock('../core/config.js', () => ({
  CONFIG: {
    hooks: {
      cashbackMaxDailyUsd: 50,
      loyaltyPointsPerDollar: 10,
      reminderLeadTimeHours: 24,
    },
  },
}));

const { LoyaltyEngine } = await import('./loyalty.js');

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS loyalty_accounts (
      user_id TEXT PRIMARY KEY,
      balance INTEGER DEFAULT 0,
      lifetime_earned INTEGER DEFAULT 0,
      lifetime_redeemed INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'bronze',
      tier_updated_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      points INTEGER NOT NULL,
      description TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('LoyaltyEngine', () => {
  let db: InstanceType<typeof Database>;
  let engine: InstanceType<typeof LoyaltyEngine>;

  beforeEach(() => {
    db = createDb();
    engine = new LoyaltyEngine(db, mockLogger);
  });

  describe('awardPoints', () => {
    it('creates account and awards points', () => {
      const points = engine.awardPoints('user-1', 50, 'purchase');

      // 50 * 10 points per dollar = 500 points
      expect(points).toBe(500);

      // Verify account was created
      const account = db.prepare('SELECT * FROM loyalty_accounts WHERE user_id = ?').get('user-1') as {
        balance: number; lifetime_earned: number; tier: string;
      };
      expect(account.balance).toBe(500);
      expect(account.lifetime_earned).toBe(500);
      expect(account.tier).toBe('bronze');

      // Verify transaction logged
      const tx = db.prepare('SELECT * FROM loyalty_transactions WHERE user_id = ?').get('user-1') as {
        type: string; points: number;
      };
      expect(tx.type).toBe('earn');
      expect(tx.points).toBe(500);
    });
  });

  describe('tier calculation', () => {
    it('upgrades from bronze to silver at 1000 lifetime points', () => {
      // Award 100 * 10 = 1000 points (exactly the silver threshold)
      engine.awardPoints('user-tier', 100, 'purchase');

      const account = db.prepare('SELECT tier, lifetime_earned FROM loyalty_accounts WHERE user_id = ?').get('user-tier') as {
        tier: string; lifetime_earned: number;
      };
      expect(account.lifetime_earned).toBe(1000);
      expect(account.tier).toBe('silver');
    });
  });

  describe('redeemPoints', () => {
    it('deducts from balance', () => {
      // First award some points
      engine.awardPoints('user-redeem', 100, 'purchase'); // 1000 points

      const result = engine.redeemPoints('user-redeem', 300, 'fee discount');

      expect(result.success).toBe(true);

      const account = db.prepare('SELECT balance, lifetime_redeemed FROM loyalty_accounts WHERE user_id = ?').get('user-redeem') as {
        balance: number; lifetime_redeemed: number;
      };
      expect(account.balance).toBe(700); // 1000 - 300
      expect(account.lifetime_redeemed).toBe(300);
    });

    it('fails with insufficient balance', () => {
      // Award 500 points
      engine.awardPoints('user-poor', 50, 'purchase'); // 50 * 10 = 500

      const result = engine.redeemPoints('user-poor', 1000, 'big redemption');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient points');

      // Balance unchanged
      const account = db.prepare('SELECT balance FROM loyalty_accounts WHERE user_id = ?').get('user-poor') as { balance: number };
      expect(account.balance).toBe(500);
    });
  });
});
