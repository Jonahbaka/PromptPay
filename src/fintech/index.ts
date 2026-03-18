/**
 * PromptPay Fintech Core
 *
 * Production-grade financial infrastructure layer:
 * - Provider plugin abstraction (Paystack, Flutterwave, Moniepoint)
 * - Transaction lifecycle state machine
 * - Configurable commission & revenue engine
 * - Non-custodial double-entry internal ledger
 * - Smart routing engine with fallback support
 * - Reconciliation & settlement workflows
 * - Device management for POS networks
 *
 * PromptPay operates as a LEGAL TECHNOLOGY LAYER on top of
 * licensed financial partners. This module does NOT hold
 * customer funds — it mirrors financial positions for
 * commissions, settlements, and operational visibility.
 */

export { TransactionLifecycle } from "./transactions/index.js";
export type { CreateTransactionInput, TransactionRecord, TransactionStatus } from "./transactions/index.js";

export { LedgerEngine } from "./ledger/index.js";
export type { EntryType, OwnerType, ReferenceType, JournalEntry, PostJournalInput } from "./ledger/index.js";

export { ProviderRegistry, PaystackPlugin, FlutterwavePlugin, MoniepointPlugin } from "./providers/index.js";
export type { IProviderPlugin, ProviderCapability, TransactionIntent, ProviderTransactionResult } from "./providers/index.js";

export { RoutingEngine } from "./routing/index.js";
export type { RoutingRequest, RoutingDecision } from "./routing/index.js";

export { CommissionEngine, seedDefaultCommissionRules } from "./commission/index.js";
export type { CommissionInput, CommissionBreakdown } from "./commission/index.js";

export { ReconciliationEngine } from "./reconciliation/index.js";
export type { ReconciliationRunResult, ProviderReportItem } from "./reconciliation/index.js";

export { DeviceManager } from "./devices/index.js";
export type { DeviceModelInput, DeviceInput, AssignmentInput } from "./devices/index.js";
