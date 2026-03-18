import type Database from "better-sqlite3";

// ═══ Transaction Status State Machine ═══
// Each status defines which transitions are legal.

const VALID_TRANSITIONS: Record<string, string[]> = {
  initiated:          ["queued_offline", "pending_provider", "processing", "failed"],
  queued_offline:     ["pending_provider", "processing", "failed"],
  pending_provider:   ["processing", "provider_confirmed", "failed"],
  processing:         ["provider_confirmed", "failed", "reversed"],
  provider_confirmed: ["reconciled", "adjusted", "reversed", "failed"],
  failed:             ["initiated", "reversed", "adjusted"],       // retry or reverse
  reversed:           ["adjusted"],
  adjusted:           ["reconciled"],
  reconciled:         ["settled"],
  settled:            ["paid_out"],
  paid_out:           [],                                           // terminal
};

export type TransactionStatus = keyof typeof VALID_TRANSITIONS;

export interface CreateTransactionInput {
  tenantId?: string;
  userId?: string;
  agentId?: string;
  providerId?: string;
  transactionType: string;
  productType?: string;
  amountMinor: number;
  currency?: string;
  customerFeeMinor?: number;
  providerFeeMinor?: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface TransactionRecord {
  id: string;
  external_id: string | null;
  tenant_id: string | null;
  user_id: string | null;
  agent_id: string | null;
  provider_id: string | null;
  transaction_type: string;
  product_type: string | null;
  amount_minor: number;
  currency: string;
  customer_fee_minor: number;
  provider_fee_minor: number;
  status: string;
  idempotency_key: string | null;
  metadata: string;
  initiated_at: string;
  completed_at: string | null;
}

export class TransactionLifecycle {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new transaction in 'initiated' status.
   * Enforces idempotency — returns existing tx if key matches.
   */
  create(input: CreateTransactionInput): TransactionRecord {
    // Idempotency check
    if (input.idempotencyKey) {
      const existing = this.db.prepare(
        "SELECT * FROM transactions WHERE idempotency_key = ?"
      ).get(input.idempotencyKey) as TransactionRecord | undefined;
      if (existing) return existing;
    }

    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO transactions (
        id, tenant_id, user_id, agent_id, provider_id,
        transaction_type, product_type, amount_minor, currency,
        customer_fee_minor, provider_fee_minor, status,
        idempotency_key, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiated', ?, ?)
    `).run(
      id,
      input.tenantId || null,
      input.userId || null,
      input.agentId || null,
      input.providerId || null,
      input.transactionType,
      input.productType || null,
      input.amountMinor,
      input.currency || "NGN",
      input.customerFeeMinor || 0,
      input.providerFeeMinor || 0,
      input.idempotencyKey || null,
      JSON.stringify(input.metadata || {})
    );

    // Log initial state
    this.logTransition(id, null, "initiated", "system", "transaction_create", "Transaction created");

    return this.getById(id)!;
  }

  /**
   * Transition a transaction to a new status.
   * Enforces the state machine — throws on illegal transitions.
   */
  transition(
    transactionId: string,
    toStatus: string,
    actor: string = "system",
    source: string = "internal",
    reason?: string,
    metadata?: Record<string, unknown>
  ): TransactionRecord {
    const tx = this.getById(transactionId);
    if (!tx) throw new Error(`Transaction ${transactionId} not found`);

    const currentStatus = tx.status;
    const allowed = VALID_TRANSITIONS[currentStatus];

    if (!allowed) {
      throw new Error(`Transaction ${transactionId} is in terminal status "${currentStatus}"`);
    }

    if (!allowed.includes(toStatus)) {
      throw new Error(
        `Invalid transition: "${currentStatus}" → "${toStatus}" for transaction ${transactionId}. ` +
        `Allowed: [${allowed.join(", ")}]`
      );
    }

    // Update status
    const isTerminal = toStatus === "paid_out" || toStatus === "failed" || toStatus === "reversed";
    this.db.prepare(`
      UPDATE transactions
      SET status = ?, updated_at = datetime('now')${isTerminal ? ", completed_at = datetime('now')" : ""}
      WHERE id = ?
    `).run(toStatus, transactionId);

    // Log transition
    this.logTransition(transactionId, currentStatus, toStatus, actor, source, reason, metadata);

    return this.getById(transactionId)!;
  }

  /**
   * Set the external (provider) ID on a transaction.
   */
  setExternalId(transactionId: string, externalId: string): void {
    this.db.prepare("UPDATE transactions SET external_id = ?, updated_at = datetime('now') WHERE id = ?")
      .run(externalId, transactionId);
  }

  /**
   * Get a transaction by ID.
   */
  getById(id: string): TransactionRecord | null {
    return (this.db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as TransactionRecord) || null;
  }

  /**
   * Get a transaction by idempotency key.
   */
  getByIdempotencyKey(key: string): TransactionRecord | null {
    return (this.db.prepare("SELECT * FROM transactions WHERE idempotency_key = ?").get(key) as TransactionRecord) || null;
  }

  /**
   * Get full state history for a transaction.
   */
  getHistory(transactionId: string): any[] {
    return this.db.prepare(
      "SELECT * FROM transaction_state_history WHERE transaction_id = ? ORDER BY created_at ASC"
    ).all(transactionId);
  }

  /**
   * Query transactions with filters.
   */
  query(filters: {
    status?: string;
    transactionType?: string;
    userId?: string;
    agentId?: string;
    tenantId?: string;
    limit?: number;
    offset?: number;
  }): TransactionRecord[] {
    const conditions: string[] = ["1=1"];
    const params: any[] = [];

    if (filters.status) { conditions.push("status = ?"); params.push(filters.status); }
    if (filters.transactionType) { conditions.push("transaction_type = ?"); params.push(filters.transactionType); }
    if (filters.userId) { conditions.push("user_id = ?"); params.push(filters.userId); }
    if (filters.agentId) { conditions.push("agent_id = ?"); params.push(filters.agentId); }
    if (filters.tenantId) { conditions.push("tenant_id = ?"); params.push(filters.tenantId); }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;

    return this.db.prepare(
      `SELECT * FROM transactions WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as TransactionRecord[];
  }

  private logTransition(
    transactionId: string,
    fromStatus: string | null,
    toStatus: string,
    actor: string,
    source: string,
    reason?: string,
    metadata?: Record<string, unknown>
  ): void {
    this.db.prepare(`
      INSERT INTO transaction_state_history (id, transaction_id, from_status, to_status, actor, source, reason, metadata)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
    `).run(transactionId, fromStatus, toStatus, actor, source, reason || null, JSON.stringify(metadata || {}));
  }

  private generateId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
}
