// ═══════════════════════════════════════════════════════════════
// PromptPay :: Memory Store
// SQLite-backed persistence for memories, execution log, and hooks
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import { EventEmitter } from 'eventemitter3';
import type { LoggerHandle, MemoryEntry, MemoryHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';

export class MemoryStore extends EventEmitter {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(logger: LoggerHandle) {
    super();
    this.logger = logger;

    const dbDir = path.dirname(CONFIG.database.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(CONFIG.database.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.logger.info('MemoryStore initialized', { dbPath: CONFIG.database.path });
  }

  private initSchema(): void {
    this.db.exec(`
      -- ═══ CORE MEMORIES ═══
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT CHECK(type IN ('episodic', 'semantic', 'procedural', 'working')),
        namespace TEXT NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        metadata TEXT DEFAULT '{}',
        importance REAL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        accessed_at TEXT NOT NULL,
        access_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_mem_agent ON memories(agent_id);
      CREATE INDEX IF NOT EXISTS idx_mem_ns ON memories(namespace);
      CREATE INDEX IF NOT EXISTS idx_mem_hash ON memories(content_hash);

      -- ═══ EXECUTION LOG ═══
      CREATE TABLE IF NOT EXISTS execution_log (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        task_id TEXT,
        action TEXT NOT NULL,
        input TEXT,
        output TEXT,
        tokens_used INTEGER DEFAULT 0,
        duration_ms INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1,
        timestamp TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_exec_agent ON execution_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_exec_ts ON execution_log(timestamp);

      -- ═══ SELF EVALUATIONS ═══
      CREATE TABLE IF NOT EXISTS self_evaluations (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        metrics TEXT NOT NULL,
        analysis TEXT NOT NULL,
        recommendations TEXT DEFAULT '[]',
        routing_changes TEXT DEFAULT '[]',
        applied INTEGER DEFAULT 0
      );

      -- ═══════════════════════════════════════════════════
      -- ENGAGEMENT HOOKS TABLES
      -- ═══════════════════════════════════════════════════

      -- ═══ STREAKS ═══
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

      -- ═══ CASHBACK ═══
      CREATE TABLE IF NOT EXISTS cashback_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        rule_type TEXT NOT NULL CHECK(rule_type IN ('merchant', 'category', 'amount_tier', 'global')),
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
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'credited', 'expired')),
        credited_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cashback_user ON cashback_ledger(user_id);
      CREATE INDEX IF NOT EXISTS idx_cashback_status ON cashback_ledger(status);

      -- ═══ REFERRALS ═══
      CREATE TABLE IF NOT EXISTS referral_codes (
        code TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL,
        uses_count INTEGER DEFAULT 0,
        max_uses INTEGER DEFAULT 0,
        bonus_usd REAL NOT NULL,
        enabled INTEGER DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_referral_owner ON referral_codes(owner_user_id);

      CREATE TABLE IF NOT EXISTS referral_events (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        referrer_user_id TEXT NOT NULL,
        referred_user_id TEXT NOT NULL,
        tier INTEGER DEFAULT 1,
        bonus_amount REAL NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'credited', 'expired')),
        credited_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_referral_referrer ON referral_events(referrer_user_id);

      -- ═══ SMART SAVINGS ═══
      CREATE TABLE IF NOT EXISTS savings_goals (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        target_amount REAL NOT NULL,
        current_amount REAL DEFAULT 0,
        currency TEXT DEFAULT 'usd',
        deadline TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'completed', 'cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_savings_user ON savings_goals(user_id);

      CREATE TABLE IF NOT EXISTS savings_rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        goal_id TEXT,
        rule_type TEXT NOT NULL CHECK(rule_type IN ('round_up', 'percent_of_deposit', 'fixed_recurring', 'threshold_skim')),
        config TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        executions INTEGER DEFAULT 0,
        total_saved REAL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_savings_rules_user ON savings_rules(user_id);

      CREATE TABLE IF NOT EXISTS savings_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        goal_id TEXT,
        rule_id TEXT,
        amount REAL NOT NULL,
        source_transaction_id TEXT,
        created_at TEXT NOT NULL
      );

      -- ═══ ACHIEVEMENTS ═══
      CREATE TABLE IF NOT EXISTS achievement_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('payment', 'savings', 'social', 'streak', 'milestone')),
        icon TEXT,
        condition_type TEXT NOT NULL,
        condition_threshold REAL NOT NULL,
        points_reward INTEGER DEFAULT 0,
        cashback_reward REAL DEFAULT 0,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS user_achievements (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        achievement_id TEXT NOT NULL,
        unlocked_at TEXT NOT NULL,
        notified INTEGER DEFAULT 0,
        UNIQUE(user_id, achievement_id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_achievements ON user_achievements(user_id);

      -- ═══ LOYALTY POINTS ═══
      CREATE TABLE IF NOT EXISTS loyalty_accounts (
        user_id TEXT PRIMARY KEY,
        balance INTEGER DEFAULT 0,
        lifetime_earned INTEGER DEFAULT 0,
        lifetime_redeemed INTEGER DEFAULT 0,
        tier TEXT DEFAULT 'bronze' CHECK(tier IN ('bronze', 'silver', 'gold', 'platinum')),
        tier_updated_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('earn', 'redeem', 'bonus', 'expire')),
        points INTEGER NOT NULL,
        description TEXT NOT NULL,
        reference_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_loyalty_tx_user ON loyalty_transactions(user_id);

      -- ═══ SPENDING INSIGHTS ═══
      CREATE TABLE IF NOT EXISTS spending_insights (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        period_type TEXT NOT NULL CHECK(period_type IN ('daily', 'weekly', 'monthly')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_spent REAL DEFAULT 0,
        total_earned REAL DEFAULT 0,
        category_breakdown TEXT DEFAULT '{}',
        top_merchants TEXT DEFAULT '[]',
        savings_rate REAL DEFAULT 0,
        compared_to_previous REAL DEFAULT 0,
        notification_sent INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_insights_user ON spending_insights(user_id);

      -- ═══ PAYMENT REMINDERS ═══
      CREATE TABLE IF NOT EXISTS payment_reminders (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'bill_due',
        reference_id TEXT,
        message TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'preferred',
        scheduled_for TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed', 'acknowledged')),
        error TEXT,
        sent_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reminders_due ON payment_reminders(scheduled_for, status);

      -- ═══════════════════════════════════════════════════
      -- MULTI-TENANCY & AUTH
      -- ═══════════════════════════════════════════════════

      -- ═══ TENANTS (Bank Partners) ═══
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        logo_url TEXT,
        primary_color TEXT DEFAULT '#6366f1',
        contact_email TEXT NOT NULL,
        contact_phone TEXT,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'suspended', 'deactivated')),
        tier TEXT DEFAULT 'standard' CHECK(tier IN ('standard', 'premium', 'enterprise')),
        config TEXT DEFAULT '{}',
        created_at TEXT NOT NULL,
        activated_at TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_slug ON tenants(slug);
      CREATE INDEX IF NOT EXISTS idx_tenant_status ON tenants(status);

      -- ═══ USERS ═══
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('owner', 'partner_admin', 'user')),
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'deactivated')),
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (tenant_id) REFERENCES tenants(id)
      );
      CREATE INDEX IF NOT EXISTS idx_user_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_user_tenant ON users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_user_role ON users(role);

      -- ═══ USER SETTINGS ═══
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id TEXT PRIMARY KEY,
        ai_model_api_key TEXT,
        ai_model_provider TEXT DEFAULT 'anthropic',
        ai_model_name TEXT,
        preferred_channels TEXT DEFAULT '',
        notification_enabled INTEGER DEFAULT 1,
        language TEXT DEFAULT 'en',
        timezone TEXT DEFAULT 'UTC',
        metadata TEXT DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );

      -- ═══ AUTH TOKENS ═══
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_auth_token_hash ON auth_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_auth_token_user ON auth_tokens(user_id);

      -- ═══ DEVELOPER API KEYS ═══
      CREATE TABLE IF NOT EXISTS developer_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        api_key_hash TEXT NOT NULL UNIQUE,
        api_key_prefix TEXT NOT NULL,
        ai_provider TEXT DEFAULT 'anthropic',
        ai_api_key TEXT,
        rate_limit INTEGER DEFAULT 100,
        requests_today INTEGER DEFAULT 0,
        last_request_at TEXT,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_devkey_hash ON developer_keys(api_key_hash);
      CREATE INDEX IF NOT EXISTS idx_devkey_user ON developer_keys(user_id);

      -- ═══ CHANNEL SESSIONS ═══
      CREATE TABLE IF NOT EXISTS channel_sessions (
        channel_type TEXT NOT NULL,
        channel_user_id TEXT NOT NULL,
        user_id TEXT,
        conversation TEXT DEFAULT '[]',
        last_message_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (channel_type, channel_user_id)
      );
    `);
  }

  getDb(): Database.Database {
    return this.db;
  }

  createMemoryHandle(agentId: string): MemoryHandle {
    return {
      store: async (entry) => {
        const id = uuid();
        const now = new Date().toISOString();
        const contentHash = Buffer.from(entry.content).toString('base64').slice(0, 32);

        this.db.prepare(`
          INSERT OR REPLACE INTO memories (id, agent_id, type, namespace, content, content_hash, metadata, importance, created_at, accessed_at, access_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        `).run(id, entry.agentId, entry.type, entry.namespace, entry.content, contentHash, JSON.stringify(entry.metadata), entry.importance, now, now);

        return id;
      },

      recall: async (query, namespace, limit = 10) => {
        let sql = 'SELECT * FROM memories WHERE 1=1';
        const params: unknown[] = [];

        if (namespace) {
          sql += ' AND namespace = ?';
          params.push(namespace);
        }

        sql += ' ORDER BY importance DESC, accessed_at DESC LIMIT ?';
        params.push(limit);

        const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
        return rows.map(r => ({
          id: r.id as string,
          agentId: r.agent_id as string,
          type: r.type as MemoryEntry['type'],
          namespace: r.namespace as string,
          content: r.content as string,
          metadata: JSON.parse(r.metadata as string),
          importance: r.importance as number,
          createdAt: new Date(r.created_at as string),
          accessedAt: new Date(r.accessed_at as string),
          accessCount: r.access_count as number,
        }));
      },

      forget: async (id) => {
        this.db.prepare('DELETE FROM memories WHERE id = ?').run(id);
      },

      consolidate: async () => {
        const result = this.db.prepare(
          "DELETE FROM memories WHERE importance < 0.2 AND access_count < 2 AND accessed_at < datetime('now', '-7 days')"
        ).run();
        return result.changes;
      },
    };
  }

  getStats(): Record<string, number> {
    const memCount = (this.db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;
    const execCount = (this.db.prepare('SELECT COUNT(*) as c FROM execution_log').get() as { c: number }).c;
    return { memories: memCount, executionLogs: execCount };
  }

  logExecution(entry: { agentId: string; taskId?: string; action: string; input?: string; output?: string; tokensUsed?: number; durationMs?: number; success?: boolean }): void {
    this.db.prepare(`
      INSERT INTO execution_log (id, agent_id, task_id, action, input, output, tokens_used, duration_ms, success, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), entry.agentId, entry.taskId || null, entry.action, entry.input || null, entry.output || null, entry.tokensUsed || 0, entry.durationMs || 0, entry.success !== false ? 1 : 0, new Date().toISOString());
  }

  seedAchievements(): void {
    const achievements = [
      { id: 'first_payment', name: 'First Payment', desc: 'Complete your first payment', cat: 'payment', type: 'payment_count', threshold: 1, pts: 100, cb: 0 },
      { id: 'payment_10', name: 'Payment Pro', desc: 'Complete 10 payments', cat: 'payment', type: 'payment_count', threshold: 10, pts: 500, cb: 0 },
      { id: 'payment_100', name: 'Payment Master', desc: 'Complete 100 payments', cat: 'payment', type: 'payment_count', threshold: 100, pts: 5000, cb: 0 },
      { id: 'savings_100', name: 'Saver Starter', desc: 'Save $100', cat: 'savings', type: 'total_saved', threshold: 100, pts: 200, cb: 0 },
      { id: 'savings_1000', name: 'Super Saver', desc: 'Save $1,000', cat: 'savings', type: 'total_saved', threshold: 1000, pts: 2000, cb: 0 },
      { id: 'streak_7', name: 'Week Warrior', desc: '7-day activity streak', cat: 'streak', type: 'streak_days', threshold: 7, pts: 250, cb: 0 },
      { id: 'streak_30', name: 'Monthly Champion', desc: '30-day activity streak', cat: 'streak', type: 'streak_days', threshold: 30, pts: 1500, cb: 0 },
      { id: 'referral_1', name: 'First Referral', desc: 'Refer your first friend', cat: 'social', type: 'referral_count', threshold: 1, pts: 500, cb: 5 },
      { id: 'referral_10', name: 'Ambassador', desc: 'Refer 10 friends', cat: 'social', type: 'referral_count', threshold: 10, pts: 5000, cb: 25 },
      { id: 'volume_1000', name: 'Volume Trader', desc: '$1,000 total transaction volume', cat: 'milestone', type: 'total_volume', threshold: 1000, pts: 1000, cb: 0 },
      { id: 'volume_10000', name: 'High Roller', desc: '$10,000 total transaction volume', cat: 'milestone', type: 'total_volume', threshold: 10000, pts: 10000, cb: 0 },
      { id: 'first_autopay', name: 'Set & Forget', desc: 'Set up your first autopay bill', cat: 'payment', type: 'autopay_count', threshold: 1, pts: 150, cb: 0 },
      { id: 'first_goal_done', name: 'Goal Crusher', desc: 'Complete your first savings goal', cat: 'savings', type: 'goals_completed', threshold: 1, pts: 500, cb: 0 },
      { id: 'loyalty_silver', name: 'Silver Status', desc: 'Reach Silver loyalty tier', cat: 'milestone', type: 'loyalty_tier', threshold: 1000, pts: 300, cb: 0 },
      { id: 'loyalty_gold', name: 'Gold Status', desc: 'Reach Gold loyalty tier', cat: 'milestone', type: 'loyalty_tier', threshold: 5000, pts: 1000, cb: 0 },
    ];

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO achievement_definitions (id, name, description, category, condition_type, condition_threshold, points_reward, cashback_reward, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    `);

    for (const a of achievements) {
      stmt.run(a.id, a.name, a.desc, a.cat, a.type, a.threshold, a.pts, a.cb);
    }

    this.logger.info(`Seeded ${achievements.length} achievement definitions`);
  }

  seedDefaultCashbackRules(): void {
    const rules = [
      { id: 'global_1pct', name: '1% Global Cashback', type: 'global', pattern: '*', pct: 0.01, max: 10, min: 1 },
      { id: 'first_tx_5pct', name: '5% First Transaction Bonus', type: 'amount_tier', pattern: '{"minAmount":0,"maxAmount":999999}', pct: 0.05, max: 25, min: 0 },
    ];

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO cashback_rules (id, name, rule_type, match_pattern, cashback_percent, max_cashback_usd, min_transaction_usd, enabled, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);

    const now = new Date().toISOString();
    for (const r of rules) {
      stmt.run(r.id, r.name, r.type, r.pattern, r.pct, r.max, r.min, now);
    }

    this.logger.info(`Seeded ${rules.length} default cashback rules`);
  }

  seedOwnerAccount(hashFn: (pw: string) => string): void {
    const existing = this.db.prepare("SELECT id FROM users WHERE role = 'owner'").get();
    if (existing) return;

    const email = CONFIG.auth.ownerEmail;
    const password = CONFIG.auth.ownerPassword;
    const displayName = CONFIG.auth.ownerDisplayName;

    const now = new Date().toISOString();
    const id = uuid();
    this.db.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, NULL, ?, ?, ?, 'owner', 'active', ?, ?)
    `).run(id, email, hashFn(password), displayName, now, now);

    // Create default settings for owner
    this.db.prepare(`
      INSERT INTO user_settings (user_id, ai_model_provider, preferred_channels, updated_at)
      VALUES (?, 'anthropic', 'email', ?)
    `).run(id, now);

    this.logger.info(`Seeded owner account: ${email}`);
  }

  close(): void {
    this.db.close();
  }
}
