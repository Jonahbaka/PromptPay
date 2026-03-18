import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { CommissionEngine } from "./commission/engine.js";
import { TransactionLifecycle } from "./transactions/lifecycle.js";
import { LedgerEngine } from "./ledger/engine.js";
import { RoutingEngine } from "./routing/engine.js";
import { ProviderRegistry } from "./providers/registry.js";
import type { IProviderPlugin, ProviderCapability, ProviderHealthCheck } from "./providers/types.js";

// ═══ Helper: create in-memory DB with all fintech tables ═══

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    -- Provider registry
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      slug TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      provider_type TEXT NOT NULL CHECK(provider_type IN ('digital_rails','super_agent','airtime_data','bill_pay','kyc','settlement')),
      base_url TEXT,
      capabilities TEXT NOT NULL DEFAULT '[]',
      health_status TEXT NOT NULL DEFAULT 'unknown' CHECK(health_status IN ('healthy','degraded','down','unknown')),
      config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Routing rules
    CREATE TABLE IF NOT EXISTS routing_rules (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      transaction_type TEXT,
      product_type TEXT,
      tenant_id TEXT,
      region TEXT,
      provider_id TEXT NOT NULL REFERENCES providers(id),
      fallback_provider_id TEXT REFERENCES providers(id),
      weight INTEGER NOT NULL DEFAULT 100,
      conditions TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      effective_from TEXT NOT NULL DEFAULT (datetime('now')),
      effective_to TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS routing_decisions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      transaction_id TEXT,
      rule_id TEXT REFERENCES routing_rules(id),
      provider_id TEXT NOT NULL,
      fallback_used INTEGER NOT NULL DEFAULT 0,
      decision_reason TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Transactions
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      external_id TEXT,
      tenant_id TEXT,
      user_id TEXT,
      agent_id TEXT,
      provider_id TEXT,
      transaction_type TEXT NOT NULL CHECK(transaction_type IN ('cash_in','cash_out','transfer','airtime','data','bill_pay','collection','payout','reversal','adjustment')),
      product_type TEXT,
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      customer_fee_minor INTEGER NOT NULL DEFAULT 0,
      provider_fee_minor INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'initiated' CHECK(status IN ('initiated','queued_offline','pending_provider','processing','provider_confirmed','failed','reversed','adjusted','reconciled','settled','paid_out')),
      idempotency_key TEXT UNIQUE,
      metadata TEXT NOT NULL DEFAULT '{}',
      initiated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
    CREATE INDEX IF NOT EXISTS idx_transactions_idempotency ON transactions(idempotency_key);

    CREATE TABLE IF NOT EXISTS transaction_state_history (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      transaction_id TEXT NOT NULL REFERENCES transactions(id),
      from_status TEXT,
      to_status TEXT NOT NULL,
      actor TEXT,
      source TEXT,
      reason TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tx_state_history_tx ON transaction_state_history(transaction_id);

    CREATE TABLE IF NOT EXISTS transaction_line_items (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      transaction_id TEXT NOT NULL REFERENCES transactions(id),
      line_type TEXT NOT NULL CHECK(line_type IN ('gross_amount','customer_fee','provider_fee','platform_share','agent_share','supervisor_share','tenant_share','regional_share','reserve_holdback','adjustment')),
      amount_minor INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tx_line_items_tx ON transaction_line_items(transaction_id);

    -- Commission rules
    CREATE TABLE IF NOT EXISTS commission_rules (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      name TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 100,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('system','provider','product','tenant','region','supervisor','agent')),
      scope_id TEXT,
      transaction_type TEXT,
      product_type TEXT,
      provider_id TEXT,
      platform_share_bps INTEGER NOT NULL DEFAULT 2000,
      agent_share_bps INTEGER NOT NULL DEFAULT 6000,
      supervisor_share_bps INTEGER NOT NULL DEFAULT 1000,
      tenant_share_bps INTEGER NOT NULL DEFAULT 1000,
      regional_share_bps INTEGER NOT NULL DEFAULT 0,
      reserve_holdback_bps INTEGER NOT NULL DEFAULT 0,
      min_net_revenue_minor INTEGER DEFAULT 0,
      cap_amount_minor INTEGER,
      floor_amount_minor INTEGER,
      flat_fee_minor INTEGER DEFAULT 0,
      payout_delay_hours INTEGER DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      effective_from TEXT NOT NULL DEFAULT (datetime('now')),
      effective_to TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_commission_rules_scope ON commission_rules(scope_type, scope_id);
    CREATE INDEX IF NOT EXISTS idx_commission_rules_priority ON commission_rules(priority);

    CREATE TABLE IF NOT EXISTS commission_results (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      transaction_id TEXT NOT NULL REFERENCES transactions(id),
      rule_id TEXT REFERENCES commission_rules(id),
      rule_version INTEGER,
      gross_amount_minor INTEGER NOT NULL,
      provider_fee_minor INTEGER NOT NULL DEFAULT 0,
      distributable_pool_minor INTEGER NOT NULL,
      platform_share_minor INTEGER NOT NULL DEFAULT 0,
      agent_share_minor INTEGER NOT NULL DEFAULT 0,
      supervisor_share_minor INTEGER NOT NULL DEFAULT 0,
      tenant_share_minor INTEGER NOT NULL DEFAULT 0,
      regional_share_minor INTEGER NOT NULL DEFAULT 0,
      reserve_holdback_minor INTEGER NOT NULL DEFAULT 0,
      adjustment_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'NGN',
      certainty TEXT NOT NULL DEFAULT 'estimated' CHECK(certainty IN ('estimated','provider_reported','reconciled','adjusted','approved_for_payout','paid_out')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Ledger
    CREATE TABLE IF NOT EXISTS ledger_account_types (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
      category TEXT NOT NULL CHECK(category IN ('asset','liability','equity','revenue','expense')),
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS ledger_accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      account_type_id TEXT NOT NULL REFERENCES ledger_account_types(id),
      owner_type TEXT NOT NULL CHECK(owner_type IN ('platform','tenant','agent','supervisor','provider','reserve','suspense')),
      owner_id TEXT,
      name TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'NGN',
      balance_minor INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_accounts_owner ON ledger_accounts(owner_type, owner_id);

    CREATE TABLE IF NOT EXISTS ledger_journals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      reference_type TEXT NOT NULL CHECK(reference_type IN ('transaction','settlement','payout','adjustment','reversal','opening_balance')),
      reference_id TEXT NOT NULL,
      description TEXT,
      posted_at TEXT NOT NULL DEFAULT (datetime('now')),
      posted_by TEXT,
      is_reversed INTEGER NOT NULL DEFAULT 0,
      reversal_of TEXT REFERENCES ledger_journals(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_journals_ref ON ledger_journals(reference_type, reference_id);

    CREATE TABLE IF NOT EXISTS ledger_entries (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      journal_id TEXT NOT NULL REFERENCES ledger_journals(id),
      account_id TEXT NOT NULL REFERENCES ledger_accounts(id),
      entry_type TEXT NOT NULL CHECK(entry_type IN ('debit','credit')),
      amount_minor INTEGER NOT NULL CHECK(amount_minor > 0),
      currency TEXT NOT NULL DEFAULT 'NGN',
      running_balance_minor INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_ledger_entries_journal ON ledger_entries(journal_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_entries_account ON ledger_entries(account_id);
  `);

  return db;
}

/** Insert a commission rule directly for testing */
function insertCommissionRule(db: Database.Database, overrides: Record<string, unknown> = {}): string {
  const defaults: Record<string, unknown> = {
    name: "Test Rule",
    priority: 100,
    scope_type: "system",
    scope_id: null,
    transaction_type: null,
    product_type: null,
    provider_id: null,
    platform_share_bps: 2000,
    agent_share_bps: 6000,
    supervisor_share_bps: 1000,
    tenant_share_bps: 1000,
    regional_share_bps: 0,
    reserve_holdback_bps: 0,
    min_net_revenue_minor: 0,
    cap_amount_minor: null,
    floor_amount_minor: null,
    flat_fee_minor: 0,
    is_active: 1,
    version: 1,
  };
  const vals = { ...defaults, ...overrides };
  const id = overrides.id as string || crypto.randomUUID().replace(/-/g, "");

  db.prepare(`
    INSERT INTO commission_rules (
      id, name, priority, scope_type, scope_id, transaction_type, product_type, provider_id,
      platform_share_bps, agent_share_bps, supervisor_share_bps, tenant_share_bps,
      regional_share_bps, reserve_holdback_bps, min_net_revenue_minor,
      cap_amount_minor, floor_amount_minor, flat_fee_minor, is_active, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, vals.name, vals.priority, vals.scope_type, vals.scope_id,
    vals.transaction_type, vals.product_type, vals.provider_id,
    vals.platform_share_bps, vals.agent_share_bps, vals.supervisor_share_bps,
    vals.tenant_share_bps, vals.regional_share_bps, vals.reserve_holdback_bps,
    vals.min_net_revenue_minor, vals.cap_amount_minor, vals.floor_amount_minor,
    vals.flat_fee_minor, vals.is_active, vals.version,
  );
  return id;
}

/** Create a mock provider plugin for registry tests */
function createMockProvider(overrides: Partial<IProviderPlugin> = {}): IProviderPlugin {
  return {
    slug: overrides.slug || "mock-provider",
    displayName: overrides.displayName || "Mock Provider",
    providerType: overrides.providerType || "digital_rails",
    getCapabilities: overrides.getCapabilities || (() => ["collections", "transfers"] as ProviderCapability[]),
    checkHealth: overrides.checkHealth || (async () => ({ status: "healthy", latencyMs: 50 }) as ProviderHealthCheck),
    mapExternalStatusToInternal: overrides.mapExternalStatusToInternal || ((s: string) => s),
  };
}

// ═══════════════════════════════════════════════════════════
// TEST SUITE 1: Commission Engine
// ═══════════════════════════════════════════════════════════

describe("Commission Engine", () => {
  let db: Database.Database;
  let engine: CommissionEngine;

  beforeAll(() => {
    db = createTestDb();
    engine = new CommissionEngine(db);
  });

  beforeEach(() => {
    db.exec("DELETE FROM commission_results");
    db.exec("DELETE FROM transaction_line_items");
    db.exec("DELETE FROM commission_rules");
  });

  it("returns empty breakdown when no rules exist", () => {
    const result = engine.calculate({
      transactionId: "tx-001",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    expect(result.platformShareMinor).toBe(0);
    expect(result.agentShareMinor).toBe(0);
    expect(result.ruleId).toBeNull();
  });

  it("applies default system rule when no specific rule exists", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 6000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
    });

    const result = engine.calculate({
      transactionId: "tx-002",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    expect(result.distributablePoolMinor).toBe(100000);
    expect(result.platformShareMinor).toBe(20000);
    expect(result.agentShareMinor).toBe(60000);
    expect(result.supervisorShareMinor).toBe(10000);
    expect(result.tenantShareMinor).toBe(10000);
  });

  it("agent-specific rule overrides system default", () => {
    insertCommissionRule(db, {
      name: "System Default",
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 6000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
    });
    insertCommissionRule(db, {
      name: "Agent Override",
      scope_type: "agent",
      scope_id: "agent-007",
      transaction_type: "collection",
      platform_share_bps: 1000,
      agent_share_bps: 8000,
      supervisor_share_bps: 500,
      tenant_share_bps: 500,
    });

    const result = engine.calculate({
      transactionId: "tx-003",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
      agentId: "agent-007",
    });

    // Agent rule should win: 80% to agent
    expect(result.agentShareMinor).toBe(80000);
    expect(result.platformShareMinor).toBe(10000);
  });

  it("supervisor rule overrides system but not agent rule", () => {
    insertCommissionRule(db, {
      name: "System Default",
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 6000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
    });
    insertCommissionRule(db, {
      name: "Supervisor Override",
      scope_type: "supervisor",
      scope_id: "sup-001",
      transaction_type: "collection",
      platform_share_bps: 1500,
      agent_share_bps: 6500,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
    });

    // Without agent, supervisor rule should apply
    const result = engine.calculate({
      transactionId: "tx-004",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
      supervisorId: "sup-001",
    });

    expect(result.agentShareMinor).toBe(65000);
    expect(result.platformShareMinor).toBe(15000);
  });

  it("basis point calculations are accurate (2000 bps = 20%)", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 6000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
    });

    const result = engine.calculate({
      transactionId: "tx-005",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 500000, // N5,000.00
      providerFeeMinor: 0,
      currency: "NGN",
    });

    expect(result.platformShareMinor).toBe(100000);  // 20% of 500000
    expect(result.agentShareMinor).toBe(300000);      // 60% of 500000
    expect(result.supervisorShareMinor).toBe(50000);  // 10% of 500000
    expect(result.tenantShareMinor).toBe(50000);      // 10% of 500000
  });

  it("caps limit agent share — excess goes to platform", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 6000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
      cap_amount_minor: 30000, // cap agent at N300
    });

    const result = engine.calculate({
      transactionId: "tx-006",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    // Agent would get 60000 but capped at 30000; excess 30000 goes to platform
    expect(result.agentShareMinor).toBe(30000);
    expect(result.platformShareMinor).toBe(50000); // 20000 base + 30000 excess
  });

  it("floors enforce minimum agent share", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 500, // only 5%
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
      floor_amount_minor: 10000, // minimum N100 for agent
    });

    const result = engine.calculate({
      transactionId: "tx-007",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    // 5% of 100000 = 5000, but floor is 10000
    expect(result.agentShareMinor).toBe(10000);
  });

  it("flat fee is added to platform share", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 6000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
      flat_fee_minor: 5000, // N50 flat fee
    });

    const result = engine.calculate({
      transactionId: "tx-008",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    // Platform gets 20000 (20%) + 5000 flat fee = 25000
    expect(result.platformShareMinor).toBe(25000);
  });

  it("reserve holdback is calculated correctly", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 2000,
      agent_share_bps: 5000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
      reserve_holdback_bps: 1000, // 10% reserve
    });

    const result = engine.calculate({
      transactionId: "tx-009",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    expect(result.reserveHoldbackMinor).toBe(10000);
  });

  it("returns empty breakdown when distributable pool is zero", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
    });

    const result = engine.calculate({
      transactionId: "tx-010",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 10000,
      providerFeeMinor: 10000, // fee eats entire gross
      currency: "NGN",
    });

    expect(result.distributablePoolMinor).toBe(0);
    expect(result.platformShareMinor).toBe(0);
    expect(result.agentShareMinor).toBe(0);
  });

  it("rounding adjustment accounts for basis-point rounding errors", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "collection",
      platform_share_bps: 3333,
      agent_share_bps: 3333,
      supervisor_share_bps: 3334,
      tenant_share_bps: 0,
    });

    const result = engine.calculate({
      transactionId: "tx-011",
      transactionType: "collection",
      providerId: "paystack",
      grossAmountMinor: 100000,
      providerFeeMinor: 0,
      currency: "NGN",
    });

    // 3333 bps of 100000 = 33330 (floor), 3334 bps = 33340
    // Total distributed = 33330 + 33330 + 33340 + 0 + 0 + 0 = 100000
    // Adjustment = 100000 - 100000 = 0
    const totalDistributed =
      result.platformShareMinor + result.agentShareMinor +
      result.supervisorShareMinor + result.tenantShareMinor +
      result.regionalShareMinor + result.reserveHoldbackMinor;

    expect(result.adjustmentMinor).toBe(result.distributablePoolMinor - totalDistributed);
  });

  it("POS model: distributable pool subtracts provider fee", () => {
    insertCommissionRule(db, {
      scope_type: "system",
      transaction_type: "cash_in",
      platform_share_bps: 1000,
      agent_share_bps: 7000,
      supervisor_share_bps: 1000,
      tenant_share_bps: 1000,
    });

    const result = engine.calculate({
      transactionId: "tx-012",
      transactionType: "cash_in",
      providerId: "moniepoint",
      grossAmountMinor: 30000,
      providerFeeMinor: 12000,
      currency: "NGN",
    });

    // Distributable pool = 30000 - 12000 = 18000
    expect(result.distributablePoolMinor).toBe(18000);
    expect(result.platformShareMinor).toBe(1800);   // 10% of 18000
    expect(result.agentShareMinor).toBe(12600);      // 70% of 18000
    expect(result.supervisorShareMinor).toBe(1800);  // 10% of 18000
    expect(result.tenantShareMinor).toBe(1800);      // 10% of 18000
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 2: Transaction Lifecycle
// ═══════════════════════════════════════════════════════════

describe("Transaction Lifecycle", () => {
  let db: Database.Database;
  let lifecycle: TransactionLifecycle;

  beforeAll(() => {
    db = createTestDb();
    lifecycle = new TransactionLifecycle(db);
  });

  beforeEach(() => {
    db.exec("DELETE FROM transaction_state_history");
    db.exec("DELETE FROM transaction_line_items");
    db.exec("DELETE FROM commission_results");
    db.exec("DELETE FROM transactions");
  });

  it("create returns correct initial state", () => {
    const tx = lifecycle.create({
      transactionType: "collection",
      amountMinor: 50000,
      currency: "NGN",
    });

    expect(tx.status).toBe("initiated");
    expect(tx.amount_minor).toBe(50000);
    expect(tx.currency).toBe("NGN");
    expect(tx.id).toBeTruthy();
  });

  it("valid transition initiated -> pending_provider succeeds", () => {
    const tx = lifecycle.create({ transactionType: "collection", amountMinor: 10000 });
    const updated = lifecycle.transition(tx.id, "pending_provider");

    expect(updated.status).toBe("pending_provider");
  });

  it("invalid transition initiated -> settled throws error", () => {
    const tx = lifecycle.create({ transactionType: "collection", amountMinor: 10000 });

    expect(() => lifecycle.transition(tx.id, "settled")).toThrow("Invalid transition");
  });

  it("terminal state (paid_out) cannot transition", () => {
    const tx = lifecycle.create({ transactionType: "collection", amountMinor: 10000 });

    // Walk to paid_out
    lifecycle.transition(tx.id, "pending_provider");
    lifecycle.transition(tx.id, "provider_confirmed");
    lifecycle.transition(tx.id, "reconciled");
    lifecycle.transition(tx.id, "settled");
    lifecycle.transition(tx.id, "paid_out");

    expect(() => lifecycle.transition(tx.id, "initiated")).toThrow("Invalid transition");
  });

  it("idempotency key returns existing transaction", () => {
    const tx1 = lifecycle.create({
      transactionType: "collection",
      amountMinor: 25000,
      idempotencyKey: "idem-key-001",
    });

    const tx2 = lifecycle.create({
      transactionType: "collection",
      amountMinor: 99999, // different amount
      idempotencyKey: "idem-key-001",
    });

    expect(tx2.id).toBe(tx1.id);
    expect(tx2.amount_minor).toBe(25000); // original amount preserved
  });

  it("state history is recorded for each transition", () => {
    const tx = lifecycle.create({ transactionType: "collection", amountMinor: 10000 });
    lifecycle.transition(tx.id, "pending_provider");
    lifecycle.transition(tx.id, "processing");

    const history = lifecycle.getHistory(tx.id);

    // 1 for creation (null -> initiated) + 2 transitions = 3
    expect(history.length).toBe(3);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe("initiated");
    expect(history[1].to_status).toBe("pending_provider");
    expect(history[2].to_status).toBe("processing");
  });

  it("full lifecycle: initiated -> pending -> confirmed -> reconciled -> settled -> paid_out", () => {
    const tx = lifecycle.create({ transactionType: "collection", amountMinor: 100000 });

    lifecycle.transition(tx.id, "pending_provider");
    lifecycle.transition(tx.id, "provider_confirmed");
    lifecycle.transition(tx.id, "reconciled");
    lifecycle.transition(tx.id, "settled");
    const final = lifecycle.transition(tx.id, "paid_out");

    expect(final.status).toBe("paid_out");
    expect(final.completed_at).toBeTruthy();

    const history = lifecycle.getHistory(tx.id);
    expect(history.length).toBe(6); // creation + 5 transitions
  });

  it("failed transaction can retry (failed -> initiated)", () => {
    const tx = lifecycle.create({ transactionType: "transfer", amountMinor: 10000 });
    lifecycle.transition(tx.id, "failed");

    const retried = lifecycle.transition(tx.id, "initiated");
    expect(retried.status).toBe("initiated");
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 3: Ledger Engine
// ═══════════════════════════════════════════════════════════

describe("Ledger Engine", () => {
  let db: Database.Database;
  let ledger: LedgerEngine;

  beforeAll(() => {
    db = createTestDb();
    ledger = new LedgerEngine(db);
  });

  beforeEach(() => {
    db.exec("DELETE FROM ledger_entries");
    db.exec("DELETE FROM ledger_journals");
    db.exec("DELETE FROM ledger_accounts");
    db.exec("DELETE FROM ledger_account_types");
  });

  it("seedAccountTypes creates all account types", () => {
    ledger.seedAccountTypes();

    const count = (db.prepare("SELECT COUNT(*) as c FROM ledger_account_types").get() as any).c;
    expect(count).toBe(14); // 5 assets + 5 liabilities + 2 revenue + 2 expense
  });

  it("seedAccountTypes is idempotent — does not duplicate on second call", () => {
    ledger.seedAccountTypes();
    ledger.seedAccountTypes();

    const count = (db.prepare("SELECT COUNT(*) as c FROM ledger_account_types").get() as any).c;
    expect(count).toBe(14);
  });

  it("ensureAccount creates account and returns ID", () => {
    ledger.seedAccountTypes();

    const id = ledger.ensureAccount("PLATFORM_REVENUE", "platform", null, "Platform Revenue Account");
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
  });

  it("ensureAccount returns same ID on repeat call", () => {
    ledger.seedAccountTypes();

    const id1 = ledger.ensureAccount("PLATFORM_REVENUE", "platform", null, "Platform Revenue Account");
    const id2 = ledger.ensureAccount("PLATFORM_REVENUE", "platform", null, "Platform Revenue Account");

    expect(id1).toBe(id2);
  });

  it("postJournal with balanced entries succeeds", () => {
    ledger.seedAccountTypes();

    const commRevId = ledger.ensureAccount("COMMISSION_REVENUE", "platform", null, "Commission Revenue");
    const agentPayId = ledger.ensureAccount("AGENT_PAYABLE", "agent", "agent-001", "Agent Payable");
    const platRevId = ledger.ensureAccount("PLATFORM_REVENUE", "platform", null, "Platform Revenue");

    const journalId = ledger.postJournal({
      referenceType: "transaction",
      referenceId: "tx-100",
      description: "Commission split for tx-100",
      entries: [
        { accountId: commRevId, entryType: "debit", amountMinor: 10000 },
        { accountId: agentPayId, entryType: "credit", amountMinor: 7000 },
        { accountId: platRevId, entryType: "credit", amountMinor: 3000 },
      ],
    });

    expect(journalId).toBeTruthy();
  });

  it("postJournal with unbalanced entries throws", () => {
    ledger.seedAccountTypes();

    const commRevId = ledger.ensureAccount("COMMISSION_REVENUE", "platform", null, "Commission Revenue");
    const agentPayId = ledger.ensureAccount("AGENT_PAYABLE", "agent", "agent-001", "Agent Payable");

    expect(() =>
      ledger.postJournal({
        referenceType: "transaction",
        referenceId: "tx-101",
        description: "Unbalanced",
        entries: [
          { accountId: commRevId, entryType: "debit", amountMinor: 10000 },
          { accountId: agentPayId, entryType: "credit", amountMinor: 5000 },
        ],
      })
    ).toThrow("Unbalanced journal");
  });

  it("postJournal updates running balances correctly", () => {
    ledger.seedAccountTypes();

    const commRevId = ledger.ensureAccount("COMMISSION_REVENUE", "platform", null, "Commission Revenue");
    const agentPayId = ledger.ensureAccount("AGENT_PAYABLE", "agent", "agent-001", "Agent Payable");
    const platRevId = ledger.ensureAccount("PLATFORM_REVENUE", "platform", null, "Platform Revenue");

    ledger.postJournal({
      referenceType: "transaction",
      referenceId: "tx-102",
      description: "Commission split",
      entries: [
        { accountId: commRevId, entryType: "debit", amountMinor: 10000 },
        { accountId: agentPayId, entryType: "credit", amountMinor: 7000 },
        { accountId: platRevId, entryType: "credit", amountMinor: 3000 },
      ],
    });

    // COMMISSION_REVENUE is credit-normal; debit decreases it -> -10000
    expect(ledger.getBalance(commRevId).balanceMinor).toBe(-10000);
    // AGENT_PAYABLE is credit-normal; credit increases it -> 7000
    expect(ledger.getBalance(agentPayId).balanceMinor).toBe(7000);
    // PLATFORM_REVENUE is credit-normal; credit increases it -> 3000
    expect(ledger.getBalance(platRevId).balanceMinor).toBe(3000);
  });

  it("debit to debit-normal account increases balance", () => {
    ledger.seedAccountTypes();

    const cashId = ledger.ensureAccount("PLATFORM_CASH", "platform", null, "Platform Cash");
    const suspenseId = ledger.ensureAccount("SUSPENSE", "suspense", null, "Suspense");

    ledger.postJournal({
      referenceType: "adjustment",
      referenceId: "adj-001",
      description: "Fund platform cash",
      entries: [
        { accountId: cashId, entryType: "debit", amountMinor: 50000 },
        { accountId: suspenseId, entryType: "credit", amountMinor: 50000 },
      ],
    });

    // PLATFORM_CASH is debit-normal; debit increases -> +50000
    expect(ledger.getBalance(cashId).balanceMinor).toBe(50000);
  });

  it("credit to debit-normal account decreases balance", () => {
    ledger.seedAccountTypes();

    const cashId = ledger.ensureAccount("PLATFORM_CASH", "platform", null, "Platform Cash");
    const suspenseId = ledger.ensureAccount("SUSPENSE", "suspense", null, "Suspense");

    // First fund it
    ledger.postJournal({
      referenceType: "adjustment",
      referenceId: "adj-002",
      description: "Fund",
      entries: [
        { accountId: cashId, entryType: "debit", amountMinor: 50000 },
        { accountId: suspenseId, entryType: "credit", amountMinor: 50000 },
      ],
    });

    // Then credit it (decrease)
    ledger.postJournal({
      referenceType: "payout",
      referenceId: "pay-001",
      description: "Disburse",
      entries: [
        { accountId: suspenseId, entryType: "debit", amountMinor: 20000 },
        { accountId: cashId, entryType: "credit", amountMinor: 20000 },
      ],
    });

    // 50000 - 20000 = 30000
    expect(ledger.getBalance(cashId).balanceMinor).toBe(30000);
  });

  it("reverseJournal creates opposite entries and zeroes out balances", () => {
    ledger.seedAccountTypes();

    const commRevId = ledger.ensureAccount("COMMISSION_REVENUE", "platform", null, "Commission Revenue");
    const agentPayId = ledger.ensureAccount("AGENT_PAYABLE", "agent", "agent-001", "Agent Payable");

    const journalId = ledger.postJournal({
      referenceType: "transaction",
      referenceId: "tx-200",
      description: "Commission",
      entries: [
        { accountId: commRevId, entryType: "debit", amountMinor: 10000 },
        { accountId: agentPayId, entryType: "credit", amountMinor: 10000 },
      ],
    });

    // Reverse it
    ledger.reverseJournal(journalId, "Disputed transaction");

    // Balances should be back to zero
    expect(ledger.getBalance(commRevId).balanceMinor).toBe(0);
    expect(ledger.getBalance(agentPayId).balanceMinor).toBe(0);
  });

  it("double reversal throws error", () => {
    ledger.seedAccountTypes();

    const commRevId = ledger.ensureAccount("COMMISSION_REVENUE", "platform", null, "Commission Revenue");
    const agentPayId = ledger.ensureAccount("AGENT_PAYABLE", "agent", "agent-001", "Agent Payable");

    const journalId = ledger.postJournal({
      referenceType: "transaction",
      referenceId: "tx-201",
      description: "Commission",
      entries: [
        { accountId: commRevId, entryType: "debit", amountMinor: 5000 },
        { accountId: agentPayId, entryType: "credit", amountMinor: 5000 },
      ],
    });

    ledger.reverseJournal(journalId, "First reversal");

    expect(() => ledger.reverseJournal(journalId, "Second reversal")).toThrow("already reversed");
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 4: Routing Engine
// ═══════════════════════════════════════════════════════════

describe("Routing Engine", () => {
  let db: Database.Database;
  let routing: RoutingEngine;
  let paystackProviderId: string;
  let flutterwaveProviderId: string;

  beforeAll(() => {
    db = createTestDb();
    routing = new RoutingEngine(db);

    // Insert test providers
    paystackProviderId = crypto.randomUUID().replace(/-/g, "");
    flutterwaveProviderId = crypto.randomUUID().replace(/-/g, "");

    db.prepare(`
      INSERT INTO providers (id, slug, display_name, provider_type, capabilities)
      VALUES (?, 'paystack', 'Paystack', 'digital_rails', '["collections","transfers"]')
    `).run(paystackProviderId);

    db.prepare(`
      INSERT INTO providers (id, slug, display_name, provider_type, capabilities)
      VALUES (?, 'flutterwave', 'Flutterwave', 'digital_rails', '["collections","transfers"]')
    `).run(flutterwaveProviderId);
  });

  beforeEach(() => {
    db.exec("DELETE FROM routing_decisions");
    db.exec("DELETE FROM routing_rules");
  });

  it("returns system default when no rules exist", () => {
    const decision = routing.resolve({ transactionType: "collection" });

    expect(decision.providerId).toBe("paystack");
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.ruleId).toBeNull();
  });

  it("higher priority rule (lower number) wins", () => {
    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, is_active)
      VALUES (lower(hex(randomblob(16))), 'Low Priority', 200, 'collection', ?, 1)
    `).run(flutterwaveProviderId);

    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, is_active)
      VALUES (lower(hex(randomblob(16))), 'High Priority', 50, 'collection', ?, 1)
    `).run(paystackProviderId);

    const decision = routing.resolve({ transactionType: "collection" });

    expect(decision.providerId).toBe(paystackProviderId);
    expect(decision.fallbackUsed).toBe(false);
  });

  it("matching by transaction_type works", () => {
    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, is_active)
      VALUES (lower(hex(randomblob(16))), 'Airtime Route', 100, 'airtime', ?, 1)
    `).run(flutterwaveProviderId);

    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, is_active)
      VALUES (lower(hex(randomblob(16))), 'Collection Route', 100, 'collection', ?, 1)
    `).run(paystackProviderId);

    const airtimeDecision = routing.resolve({ transactionType: "airtime" });
    expect(airtimeDecision.providerId).toBe(flutterwaveProviderId);

    const collectionDecision = routing.resolve({ transactionType: "collection" });
    expect(collectionDecision.providerId).toBe(paystackProviderId);
  });

  it("fallback provider is returned when requested", () => {
    const ruleId = crypto.randomUUID().replace(/-/g, "");
    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, fallback_provider_id, is_active)
      VALUES (?, 'Primary Route', 100, 'collection', ?, ?, 1)
    `).run(ruleId, paystackProviderId, flutterwaveProviderId);

    const primary = routing.resolve({ transactionType: "collection" });
    expect(primary.providerId).toBe(paystackProviderId);

    const fallback = routing.resolveFallback(primary);
    expect(fallback).not.toBeNull();
    expect(fallback!.providerId).toBe(flutterwaveProviderId);
    expect(fallback!.fallbackUsed).toBe(true);
  });

  it("weighted selection distributes across rules (run 100 times)", () => {
    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, weight, is_active)
      VALUES (lower(hex(randomblob(16))), 'Route A', 100, 'collection', ?, 50, 1)
    `).run(paystackProviderId);

    db.prepare(`
      INSERT INTO routing_rules (id, name, priority, transaction_type, provider_id, weight, is_active)
      VALUES (lower(hex(randomblob(16))), 'Route B', 100, 'collection', ?, 50, 1)
    `).run(flutterwaveProviderId);

    const counts: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      const decision = routing.resolve({ transactionType: "collection" });
      counts[decision.providerId] = (counts[decision.providerId] || 0) + 1;
    }

    // Both providers should appear at least once in 100 runs with 50/50 weight
    expect(Object.keys(counts).length).toBe(2);
    expect(counts[paystackProviderId]).toBeGreaterThan(0);
    expect(counts[flutterwaveProviderId]).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════
// TEST SUITE 5: Provider Registry
// ═══════════════════════════════════════════════════════════

describe("Provider Registry", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("register and retrieve provider", () => {
    const mock = createMockProvider({ slug: "paystack" });
    registry.register(mock);

    const retrieved = registry.get("paystack");
    expect(retrieved).toBeDefined();
    expect(retrieved!.slug).toBe("paystack");
    expect(retrieved!.displayName).toBe("Mock Provider");
  });

  it("duplicate registration throws", () => {
    const mock = createMockProvider({ slug: "paystack" });
    registry.register(mock);

    expect(() => registry.register(mock)).toThrow('already registered');
  });

  it("findByCapability returns correct providers", () => {
    registry.register(createMockProvider({
      slug: "paystack",
      getCapabilities: () => ["collections", "transfers"] as ProviderCapability[],
    }));
    registry.register(createMockProvider({
      slug: "mtn-vtu",
      providerType: "airtime_data",
      getCapabilities: () => ["airtime", "data"] as ProviderCapability[],
    }));

    const collectionProviders = registry.findByCapability("collections");
    expect(collectionProviders.length).toBe(1);
    expect(collectionProviders[0].slug).toBe("paystack");

    const airtimeProviders = registry.findByCapability("airtime");
    expect(airtimeProviders.length).toBe(1);
    expect(airtimeProviders[0].slug).toBe("mtn-vtu");
  });

  it("findByType returns correct providers", () => {
    registry.register(createMockProvider({
      slug: "paystack",
      providerType: "digital_rails",
    }));
    registry.register(createMockProvider({
      slug: "moniepoint",
      providerType: "super_agent",
    }));
    registry.register(createMockProvider({
      slug: "flutterwave",
      providerType: "digital_rails",
    }));

    const digitalProviders = registry.findByType("digital_rails");
    expect(digitalProviders.length).toBe(2);

    const superAgentProviders = registry.findByType("super_agent");
    expect(superAgentProviders.length).toBe(1);
    expect(superAgentProviders[0].slug).toBe("moniepoint");
  });

  it("getOrThrow throws for unknown provider", () => {
    expect(() => registry.getOrThrow("nonexistent")).toThrow('not found in registry');
  });

  it("listAll returns all registered providers", () => {
    registry.register(createMockProvider({ slug: "p1" }));
    registry.register(createMockProvider({ slug: "p2" }));
    registry.register(createMockProvider({ slug: "p3" }));

    expect(registry.listAll().length).toBe(3);
    expect(registry.size).toBe(3);
  });
});
