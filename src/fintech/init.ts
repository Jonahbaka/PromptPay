// ═══════════════════════════════════════════════════════════════
// PromptPay :: Fintech Core Initialization
// Creates all fintech services and seeds data
// ═══════════════════════════════════════════════════════════════

import type Database from "better-sqlite3";
import { ProviderRegistry, PaystackPlugin, FlutterwavePlugin, MoniepointPlugin } from "./providers/index.js";
import { RoutingEngine } from "./routing/index.js";
import { CommissionEngine, seedDefaultCommissionRules } from "./commission/index.js";
import { TransactionLifecycle } from "./transactions/index.js";
import { LedgerEngine } from "./ledger/index.js";

export interface FintechCore {
  providers: ProviderRegistry;
  routing: RoutingEngine;
  commission: CommissionEngine;
  transactions: TransactionLifecycle;
  ledger: LedgerEngine;
}

export function initFintechCore(db: Database.Database, config: Record<string, any>): FintechCore {
  // Provider registry
  const providers = new ProviderRegistry();

  // Register available providers based on config/env
  if (config.PAYSTACK_SECRET_KEY) {
    providers.register(new PaystackPlugin(config.PAYSTACK_SECRET_KEY));
  }
  if (config.FLUTTERWAVE_SECRET_KEY) {
    providers.register(new FlutterwavePlugin(config.FLUTTERWAVE_SECRET_KEY));
  }
  if (config.MONIEPOINT_API_KEY) {
    providers.register(new MoniepointPlugin(config.MONIEPOINT_API_KEY, config.MONIEPOINT_BASE_URL));
  }

  // Core engines
  const routing = new RoutingEngine(db);
  const commission = new CommissionEngine(db);
  const transactions = new TransactionLifecycle(db);
  const ledger = new LedgerEngine(db);

  // Seed defaults
  seedDefaultCommissionRules(db);
  ledger.seedAccountTypes();

  return { providers, routing, commission, transactions, ledger };
}
