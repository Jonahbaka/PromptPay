import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { TransactionEvent } from './cashback.js';

vi.mock('../core/config.js', () => ({
  CONFIG: {
    hooks: {
      cashbackMaxDailyUsd: 50,
      loyaltyPointsPerDollar: 10,
      reminderLeadTimeHours: 24,
    },
  },
}));

// Must import after vi.mock
const { CashbackEngine } = await import('./cashback.js');

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cashback_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      match_pattern TEXT NOT NULL,
      cashback_percent REAL NOT NULL,
      max_cashback_usd REAL,
      min_transaction_usd REAL DEFAULT 0,
      valid_from TEXT,
      valid_until TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cashback_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      original_amount REAL NOT NULL,
      cashback_amount REAL NOT NULL,
      currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'pending',
      credited_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('CashbackEngine', () => {
  let db: InstanceType<typeof Database>;
  let engine: InstanceType<typeof CashbackEngine>;

  beforeEach(() => {
    db = createDb();
    engine = new CashbackEngine(db, mockLogger);
  });

  describe('processTransaction', () => {
    it('matches a global rule and records cashback', () => {
      const now = new Date().toISOString();

      // Insert a global cashback rule: 2% cashback
      db.prepare(`
        INSERT INTO cashback_rules (id, name, rule_type, match_pattern, cashback_percent, max_cashback_usd, min_transaction_usd, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run('rule-1', 'Global 2%', 'global', '*', 0.02, 10, 0, now);

      const tx: TransactionEvent = {
        id: 'tx-1',
        userId: 'user-1',
        amount: 100,
        currency: 'usd',
        type: 'purchase',
      };

      const cashback = engine.processTransaction('user-1', tx);

      expect(cashback).toBe(2.0); // 100 * 0.02

      // Verify ledger entry
      const ledger = db.prepare('SELECT * FROM cashback_ledger WHERE user_id = ?').get('user-1') as {
        cashback_amount: number; status: string; rule_id: string; original_amount: number;
      };
      expect(ledger.cashback_amount).toBe(2.0);
      expect(ledger.status).toBe('pending');
      expect(ledger.rule_id).toBe('rule-1');
      expect(ledger.original_amount).toBe(100);
    });

    it('returns 0 when no matching rules exist', () => {
      const tx: TransactionEvent = {
        id: 'tx-2',
        userId: 'user-2',
        amount: 50,
        currency: 'usd',
        type: 'purchase',
      };

      const cashback = engine.processTransaction('user-2', tx);

      expect(cashback).toBe(0);

      // No ledger entries
      const count = (db.prepare('SELECT COUNT(*) as c FROM cashback_ledger').get() as { c: number }).c;
      expect(count).toBe(0);
    });
  });

  describe('creditPending', () => {
    it('changes status from pending to credited', () => {
      const now = new Date().toISOString();

      // Insert a pending ledger entry directly
      db.prepare(`
        INSERT INTO cashback_ledger (id, user_id, transaction_id, rule_id, original_amount, cashback_amount, currency, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run('ledger-1', 'user-1', 'tx-1', 'rule-1', 100, 2.0, 'usd', now);

      const credited = engine.creditPending();

      expect(credited).toBe(1);

      const entry = db.prepare('SELECT status, credited_at FROM cashback_ledger WHERE id = ?').get('ledger-1') as {
        status: string; credited_at: string | null;
      };
      expect(entry.status).toBe('credited');
      expect(entry.credited_at).not.toBeNull();
    });
  });

  describe('getStats', () => {
    it('returns correct totals', () => {
      const now = new Date().toISOString();

      // Insert rules
      db.prepare(`
        INSERT INTO cashback_rules (id, name, rule_type, match_pattern, cashback_percent, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `).run('rule-1', 'Global 2%', 'global', '*', 0.02, now);

      db.prepare(`
        INSERT INTO cashback_rules (id, name, rule_type, match_pattern, cashback_percent, enabled, created_at)
        VALUES (?, ?, ?, ?, ?, 0, ?)
      `).run('rule-2', 'Disabled Rule', 'global', '*', 0.05, now);

      // Insert ledger entries
      db.prepare(`
        INSERT INTO cashback_ledger (id, user_id, transaction_id, rule_id, original_amount, cashback_amount, currency, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).run('l-1', 'user-1', 'tx-1', 'rule-1', 100, 2.0, 'usd', now);

      db.prepare(`
        INSERT INTO cashback_ledger (id, user_id, transaction_id, rule_id, original_amount, cashback_amount, currency, status, credited_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'credited', ?, ?)
      `).run('l-2', 'user-1', 'tx-2', 'rule-1', 200, 4.0, 'usd', now, now);

      const stats = engine.getStats();

      expect(stats.totalRules).toBe(2);
      expect(stats.activeRules).toBe(1);
      expect(stats.pendingCredits).toBe(2.0);
      expect(stats.totalCredited).toBe(4.0);
    });
  });
});
