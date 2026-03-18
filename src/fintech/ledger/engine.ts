import type Database from "better-sqlite3";

/**
 * Non-Custodial Double-Entry Internal Ledger
 *
 * This is a financial MIRROR — not custody of funds.
 * It tracks logical balances for commissions, reserves,
 * settlements, and liabilities using proper double-entry
 * accounting. No destructive edits — corrections are
 * done via reversal journal entries.
 */

export type EntryType = "debit" | "credit";
export type NormalBalance = "debit" | "credit";
export type AccountCategory = "asset" | "liability" | "equity" | "revenue" | "expense";
export type OwnerType = "platform" | "tenant" | "agent" | "supervisor" | "provider" | "reserve" | "suspense";
export type ReferenceType = "transaction" | "settlement" | "payout" | "adjustment" | "reversal" | "opening_balance";

export interface JournalEntry {
  accountId: string;
  entryType: EntryType;
  amountMinor: number;
  currency?: string;
}

export interface PostJournalInput {
  referenceType: ReferenceType;
  referenceId: string;
  description: string;
  postedBy?: string;
  entries: JournalEntry[];
}

export class LedgerEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Seed the standard account types if they don't exist.
   */
  seedAccountTypes(): void {
    const existing = this.db.prepare("SELECT COUNT(*) as c FROM ledger_account_types").get() as any;
    if (existing.c > 0) return;

    const insert = this.db.prepare(`
      INSERT INTO ledger_account_types (id, code, name, normal_balance, category, description)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)
    `);

    const seed = this.db.transaction(() => {
      // Assets
      insert.run("AGENT_RECEIVABLE",   "Agent Commission Receivable",   "debit",  "asset",     "Commissions owed to agents");
      insert.run("SUPERVISOR_RECV",    "Supervisor Override Receivable", "debit",  "asset",     "Overrides owed to supervisors");
      insert.run("TENANT_RECEIVABLE",  "Tenant Share Receivable",       "debit",  "asset",     "Shares owed to tenants");
      insert.run("PLATFORM_CASH",      "Platform Operating Account",    "debit",  "asset",     "Platform revenue recognized");
      insert.run("PROVIDER_RECEIVABLE","Provider Receivable",           "debit",  "asset",     "Amounts pending from provider settlement");
      // Liabilities
      insert.run("AGENT_PAYABLE",      "Agent Commission Payable",      "credit", "liability", "Commissions to be paid out");
      insert.run("SUPERVISOR_PAYABLE", "Supervisor Override Payable",   "credit", "liability", "Overrides to be paid out");
      insert.run("TENANT_PAYABLE",     "Tenant Share Payable",          "credit", "liability", "Tenant shares to be paid out");
      insert.run("RESERVE_HOLD",       "Reserve Holdback",              "credit", "liability", "Funds held in reserve");
      insert.run("SUSPENSE",           "Suspense Account",              "credit", "liability", "Unreconciled/unclassified amounts");
      // Revenue
      insert.run("PLATFORM_REVENUE",   "Platform Revenue",              "credit", "revenue",   "PromptPay platform fee revenue");
      insert.run("COMMISSION_REVENUE", "Commission Revenue Pool",       "credit", "revenue",   "Total commission pool from transactions");
      // Expense
      insert.run("PROVIDER_FEE_EXP",   "Provider Fee Expense",          "debit",  "expense",   "Fees paid to providers");
      insert.run("PAYOUT_EXPENSE",      "Payout Expense",               "debit",  "expense",   "Payouts disbursed to network");
    });
    seed();
  }

  /**
   * Create or get a ledger account for a specific owner.
   */
  ensureAccount(accountTypeCode: string, ownerType: OwnerType, ownerId: string | null, name: string, currency = "NGN"): string {
    // Check if exists
    const existing = this.db.prepare(`
      SELECT la.id FROM ledger_accounts la
      JOIN ledger_account_types lat ON la.account_type_id = lat.id
      WHERE lat.code = ? AND la.owner_type = ? AND (la.owner_id = ? OR (la.owner_id IS NULL AND ? IS NULL)) AND la.currency = ?
    `).get(accountTypeCode, ownerType, ownerId, ownerId, currency) as any;

    if (existing) return existing.id;

    // Get account type
    const accountType = this.db.prepare("SELECT id FROM ledger_account_types WHERE code = ?").get(accountTypeCode) as any;
    if (!accountType) throw new Error(`Account type "${accountTypeCode}" not found. Run seedAccountTypes() first.`);

    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO ledger_accounts (id, account_type_id, owner_type, owner_id, name, currency)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, accountType.id, ownerType, ownerId, name, currency);

    return id;
  }

  /**
   * Post a balanced journal entry (debits must equal credits).
   * Returns the journal ID. Throws if unbalanced.
   */
  postJournal(input: PostJournalInput): string {
    if (input.entries.length < 2) {
      throw new Error("Journal must have at least 2 entries (double-entry)");
    }

    let totalDebits = 0;
    let totalCredits = 0;
    for (const entry of input.entries) {
      if (entry.amountMinor <= 0) throw new Error("Entry amounts must be positive");
      if (entry.entryType === "debit") totalDebits += entry.amountMinor;
      else totalCredits += entry.amountMinor;
    }

    if (totalDebits !== totalCredits) {
      throw new Error(
        `Unbalanced journal: debits=${totalDebits}, credits=${totalCredits}. ` +
        `Difference: ${Math.abs(totalDebits - totalCredits)}`
      );
    }

    const journalId = this.generateId();

    const post = this.db.transaction(() => {
      // Create journal
      this.db.prepare(`
        INSERT INTO ledger_journals (id, reference_type, reference_id, description, posted_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(journalId, input.referenceType, input.referenceId, input.description, input.postedBy || "system");

      // Create entries and update balances
      const insertEntry = this.db.prepare(`
        INSERT INTO ledger_entries (id, journal_id, account_id, entry_type, amount_minor, currency, running_balance_minor)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const updateBalance = this.db.prepare(`
        UPDATE ledger_accounts SET balance_minor = balance_minor + ?, updated_at = datetime('now') WHERE id = ?
      `);

      const getBalance = this.db.prepare("SELECT balance_minor FROM ledger_accounts WHERE id = ?");
      const getAccountInfo = this.db.prepare(`
        SELECT lat.normal_balance FROM ledger_accounts la
        JOIN ledger_account_types lat ON la.account_type_id = lat.id
        WHERE la.id = ?
      `);

      for (const entry of input.entries) {
        // Determine balance delta based on normal balance of account
        const acctInfo = getAccountInfo.get(entry.accountId) as any;
        if (!acctInfo) throw new Error(`Ledger account ${entry.accountId} not found`);

        // If entry type matches normal balance → increase; else → decrease
        const delta = entry.entryType === acctInfo.normal_balance
          ? entry.amountMinor
          : -entry.amountMinor;

        updateBalance.run(delta, entry.accountId);
        const newBalance = (getBalance.get(entry.accountId) as any).balance_minor;

        insertEntry.run(
          this.generateId(),
          journalId,
          entry.accountId,
          entry.entryType,
          entry.amountMinor,
          entry.currency || "NGN",
          newBalance
        );
      }
    });

    post();
    return journalId;
  }

  /**
   * Reverse a journal entry (creates a new journal with opposite entries).
   */
  reverseJournal(journalId: string, reason: string, postedBy = "system"): string {
    const journal = this.db.prepare("SELECT * FROM ledger_journals WHERE id = ?").get(journalId) as any;
    if (!journal) throw new Error(`Journal ${journalId} not found`);
    if (journal.is_reversed) throw new Error(`Journal ${journalId} already reversed`);

    const entries = this.db.prepare("SELECT * FROM ledger_entries WHERE journal_id = ?").all(journalId) as any[];

    // Create reversal entries (swap debit/credit)
    const reversalEntries: JournalEntry[] = entries.map((e: any) => ({
      accountId: e.account_id,
      entryType: (e.entry_type === "debit" ? "credit" : "debit") as EntryType,
      amountMinor: e.amount_minor,
      currency: e.currency
    }));

    const reversalId = this.postJournal({
      referenceType: "reversal",
      referenceId: journalId,
      description: `Reversal of ${journalId}: ${reason}`,
      postedBy,
      entries: reversalEntries
    });

    // Mark original as reversed
    this.db.prepare("UPDATE ledger_journals SET is_reversed = 1 WHERE id = ?").run(journalId);

    // Link reversal
    this.db.prepare("UPDATE ledger_journals SET reversal_of = ? WHERE id = ?").run(journalId, reversalId);

    return reversalId;
  }

  /**
   * Get account balance.
   */
  getBalance(accountId: string): { balanceMinor: number; currency: string } {
    const acct = this.db.prepare("SELECT balance_minor, currency FROM ledger_accounts WHERE id = ?").get(accountId) as any;
    if (!acct) throw new Error(`Account ${accountId} not found`);
    return { balanceMinor: acct.balance_minor, currency: acct.currency };
  }

  /**
   * Get all accounts for an owner.
   */
  getAccountsForOwner(ownerType: OwnerType, ownerId: string): any[] {
    return this.db.prepare(`
      SELECT la.*, lat.code as type_code, lat.name as type_name, lat.category
      FROM ledger_accounts la
      JOIN ledger_account_types lat ON la.account_type_id = lat.id
      WHERE la.owner_type = ? AND la.owner_id = ?
    `).all(ownerType, ownerId);
  }

  /**
   * Get journal entries for a reference (e.g., transaction).
   */
  getEntriesForReference(referenceType: ReferenceType, referenceId: string): any[] {
    return this.db.prepare(`
      SELECT le.*, lj.description as journal_description, lj.posted_at, la.name as account_name
      FROM ledger_entries le
      JOIN ledger_journals lj ON le.journal_id = lj.id
      JOIN ledger_accounts la ON le.account_id = la.id
      WHERE lj.reference_type = ? AND lj.reference_id = ?
      ORDER BY le.created_at ASC
    `).all(referenceType, referenceId);
  }

  private generateId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
}
