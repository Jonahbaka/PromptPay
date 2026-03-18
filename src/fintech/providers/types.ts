// Provider capability flags
export type ProviderCapability =
  | 'collections'
  | 'transfers'
  | 'airtime'
  | 'data'
  | 'bill_pay'
  | 'pos_cash_in'
  | 'pos_cash_out'
  | 'kyc_verification'
  | 'settlement_reporting'
  | 'webhook_events'
  | 'balance_query'
  | 'device_management';

export type ProviderType = 'digital_rails' | 'super_agent' | 'airtime_data' | 'bill_pay' | 'kyc' | 'settlement';

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderConfig {
  slug: string;
  displayName: string;
  providerType: ProviderType;
  baseUrl?: string;
  capabilities: ProviderCapability[];
  config: Record<string, unknown>;
}

export interface TransactionIntent {
  type: string;
  amount_minor: number;
  currency: string;
  recipient?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderTransactionResult {
  success: boolean;
  externalId?: string;
  status: string;
  providerStatus?: string;
  amount_minor?: number;
  fee_minor?: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface WebhookPayload {
  headers: Record<string, string>;
  body: unknown;
  rawBody?: string;
}

export interface WebhookResult {
  valid: boolean;
  eventType: string;
  externalId?: string;
  internalStatus: string;
  amount_minor?: number;
  metadata?: Record<string, unknown>;
}

export interface ProviderHealthCheck {
  status: ProviderHealthStatus;
  latencyMs: number;
  message?: string;
}

/**
 * Standard provider plugin interface.
 * Not every provider implements every method.
 * Use getCapabilities() to check what's available.
 */
export interface IProviderPlugin {
  readonly slug: string;
  readonly displayName: string;
  readonly providerType: ProviderType;

  getCapabilities(): ProviderCapability[];
  checkHealth(): Promise<ProviderHealthCheck>;

  // Optional methods — providers implement what they support
  createCollection?(intent: TransactionIntent): Promise<ProviderTransactionResult>;
  createTransfer?(intent: TransactionIntent): Promise<ProviderTransactionResult>;
  executeAirtimePurchase?(intent: TransactionIntent): Promise<ProviderTransactionResult>;
  executeDataPurchase?(intent: TransactionIntent): Promise<ProviderTransactionResult>;
  executeBillPayment?(intent: TransactionIntent): Promise<ProviderTransactionResult>;

  fetchTransactionById?(externalId: string): Promise<ProviderTransactionResult | null>;
  handleWebhookEvent?(payload: WebhookPayload): Promise<WebhookResult>;
  verifyWebhookSignature?(payload: WebhookPayload): boolean;

  fetchBalance?(): Promise<{ available_minor: number; currency: string }>;
  mapExternalStatusToInternal(externalStatus: string): string;
}
