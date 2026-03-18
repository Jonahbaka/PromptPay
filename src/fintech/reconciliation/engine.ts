import type Database from "better-sqlite3";

/**
 * Reconciliation Engine
 *
 * Compares internal transaction records against provider-reported data.
 * Flags mismatches, generates adjustment entries, and tracks resolution.
 */

export interface ReconciliationRunResult {
  runId: string;
  providerId: string;
  matched: number;
  mismatched: number;
  missingInternal: number;
  missingProvider: number;
  totalInternal: number;
  totalProvider: number;
}

export interface ProviderReportItem {
  externalId: string;
  amountMinor: number;
  status: string;
  metadata?: Record<string, unknown>;
}

export class ReconciliationEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Start a reconciliation run for a provider over a time period.
   * Compares internal transactions against provider-reported items.
   */
  runReconciliation(
    providerId: string,
    periodStart: string,
    periodEnd: string,
    providerItems: ProviderReportItem[]
  ): ReconciliationRunResult {
    const runId = this.generateId();

    // Create run record
    this.db.prepare(`
      INSERT INTO reconciliation_runs (id, provider_id, period_start, period_end, status, started_at)
      VALUES (?, ?, ?, ?, 'in_progress', datetime('now'))
    `).run(runId, providerId, periodStart, periodEnd);

    // Get internal transactions for this provider and period
    const internalTxs = this.db.prepare(`
      SELECT id, external_id, amount_minor, status
      FROM transactions
      WHERE provider_id = ?
        AND initiated_at >= ? AND initiated_at <= ?
        AND external_id IS NOT NULL
    `).all(providerId, periodStart, periodEnd) as any[];

    // Build lookup maps
    const internalByExtId = new Map<string, any>();
    for (const tx of internalTxs) {
      if (tx.external_id) internalByExtId.set(tx.external_id, tx);
    }

    const providerByExtId = new Map<string, ProviderReportItem>();
    for (const item of providerItems) {
      providerByExtId.set(item.externalId, item);
    }

    let matched = 0;
    let mismatched = 0;
    let missingInternal = 0;
    let missingProvider = 0;

    const insertItem = this.db.prepare(`
      INSERT INTO reconciliation_items (id, run_id, transaction_id, external_reference, match_status, internal_amount_minor, provider_amount_minor, difference_minor)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?)
    `);

    const reconcile = this.db.transaction(() => {
      // Check each provider item against internal records
      for (const [extId, providerItem] of providerByExtId) {
        const internal = internalByExtId.get(extId);

        if (!internal) {
          // Provider has it but we don't
          insertItem.run(runId, null, extId, "missing_internal", null, providerItem.amountMinor, null);
          missingInternal++;
          continue;
        }

        if (internal.amount_minor !== providerItem.amountMinor) {
          // Amount mismatch
          const diff = internal.amount_minor - providerItem.amountMinor;
          insertItem.run(runId, internal.id, extId, "amount_mismatch", internal.amount_minor, providerItem.amountMinor, diff);
          mismatched++;
        } else {
          // Match
          insertItem.run(runId, internal.id, extId, "matched", internal.amount_minor, providerItem.amountMinor, 0);
          matched++;

          // If internal status is behind, update it
          if (internal.status === "pending_provider" && providerItem.status === "provider_confirmed") {
            this.db.prepare("UPDATE transactions SET status = 'reconciled', updated_at = datetime('now') WHERE id = ?")
              .run(internal.id);
          }
        }

        // Remove from internal map (processed)
        internalByExtId.delete(extId);
      }

      // Remaining internal items not in provider report
      for (const [extId, internal] of internalByExtId) {
        insertItem.run(runId, internal.id, extId, "missing_provider", internal.amount_minor, null, null);
        missingProvider++;
      }

      // Complete the run
      this.db.prepare(`
        UPDATE reconciliation_runs
        SET status = 'completed', matched = ?, mismatched = ?, missing_internal = ?, missing_provider = ?,
            total_internal = ?, total_provider = ?, completed_at = datetime('now')
        WHERE id = ?
      `).run(matched, mismatched, missingInternal, missingProvider, internalTxs.length, providerItems.length, runId);
    });

    reconcile();

    return {
      runId,
      providerId,
      matched,
      mismatched,
      missingInternal,
      missingProvider,
      totalInternal: internalTxs.length,
      totalProvider: providerItems.length
    };
  }

  /**
   * Get reconciliation run details with items.
   */
  getRunDetails(runId: string): { run: any; items: any[] } | null {
    const run = this.db.prepare("SELECT * FROM reconciliation_runs WHERE id = ?").get(runId) as any;
    if (!run) return null;
    const items = this.db.prepare("SELECT * FROM reconciliation_items WHERE run_id = ? ORDER BY created_at").all(runId);
    return { run, items };
  }

  /**
   * List reconciliation runs.
   */
  listRuns(providerId?: string, limit = 20): any[] {
    if (providerId) {
      return this.db.prepare("SELECT * FROM reconciliation_runs WHERE provider_id = ? ORDER BY created_at DESC LIMIT ?")
        .all(providerId, limit);
    }
    return this.db.prepare("SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT ?").all(limit);
  }

  /**
   * Create a settlement batch from reconciled transactions.
   */
  createSettlementBatch(
    providerId: string,
    tenantId: string | null,
    periodStart: string,
    periodEnd: string
  ): string {
    // Sum reconciled transactions for this period
    const result = this.db.prepare(`
      SELECT COUNT(*) as tx_count, COALESCE(SUM(amount_minor), 0) as total_amount
      FROM transactions
      WHERE provider_id = ?
        AND (tenant_id = ? OR ? IS NULL)
        AND status IN ('reconciled', 'provider_confirmed')
        AND initiated_at >= ? AND initiated_at <= ?
    `).get(providerId, tenantId, tenantId, periodStart, periodEnd) as any;

    const batchId = this.generateId();
    this.db.prepare(`
      INSERT INTO settlement_batches (id, provider_id, tenant_id, period_start, period_end, total_amount_minor, transaction_count, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'NGN', 'pending')
    `).run(batchId, providerId, tenantId, periodStart, periodEnd, result.total_amount, result.tx_count);

    return batchId;
  }

  /**
   * List settlement batches.
   */
  listSettlements(filters: { providerId?: string; tenantId?: string; status?: string; limit?: number }): any[] {
    const conditions: string[] = ["1=1"];
    const params: any[] = [];
    if (filters.providerId) { conditions.push("provider_id = ?"); params.push(filters.providerId); }
    if (filters.tenantId) { conditions.push("tenant_id = ?"); params.push(filters.tenantId); }
    if (filters.status) { conditions.push("status = ?"); params.push(filters.status); }
    params.push(filters.limit || 20);
    return this.db.prepare(`SELECT * FROM settlement_batches WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params);
  }

  /**
   * Create a payout record for an agent/supervisor/tenant.
   */
  createPayoutRecord(
    payeeType: "agent" | "supervisor" | "tenant" | "platform",
    payeeId: string,
    amountMinor: number,
    currency = "NGN",
    payoutMethod?: string
  ): string {
    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO payout_records (id, payee_type, payee_id, amount_minor, currency, status, payout_method)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, payeeType, payeeId, amountMinor, currency, payoutMethod || null);
    return id;
  }

  /**
   * List payout records with filters.
   */
  listPayouts(filters: { payeeType?: string; payeeId?: string; status?: string; limit?: number }): any[] {
    const conditions: string[] = ["1=1"];
    const params: any[] = [];
    if (filters.payeeType) { conditions.push("payee_type = ?"); params.push(filters.payeeType); }
    if (filters.payeeId) { conditions.push("payee_id = ?"); params.push(filters.payeeId); }
    if (filters.status) { conditions.push("status = ?"); params.push(filters.status); }
    params.push(filters.limit || 50);
    return this.db.prepare(`SELECT * FROM payout_records WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...params);
  }

  private generateId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
}
