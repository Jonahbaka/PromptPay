import type {
  IProviderPlugin, ProviderCapability, ProviderHealthCheck,
  TransactionIntent, ProviderTransactionResult
} from './types.js';

export class MoniepointPlugin implements IProviderPlugin {
  readonly slug = 'moniepoint';
  readonly displayName = 'Moniepoint';
  readonly providerType = 'super_agent' as const;

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.moniepoint.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  getCapabilities(): ProviderCapability[] {
    return ['pos_cash_in', 'pos_cash_out', 'collections', 'transfers', 'device_management', 'settlement_reporting', 'webhook_events'];
  }

  async checkHealth(): Promise<ProviderHealthCheck> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` }
      });
      return {
        status: res.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start
      };
    } catch (err) {
      return { status: 'down', latencyMs: Date.now() - start, message: String(err) };
    }
  }

  async createCollection(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    // Moniepoint POS collection — will be implemented when API credentials are available
    return { success: false, status: 'failed', error: 'Moniepoint collection not yet configured' };
  }

  async createTransfer(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    return { success: false, status: 'failed', error: 'Moniepoint transfer not yet configured' };
  }

  mapExternalStatusToInternal(externalStatus: string): string {
    const map: Record<string, string> = {
      'SUCCESSFUL': 'provider_confirmed',
      'FAILED': 'failed',
      'PENDING': 'pending_provider',
      'REVERSED': 'reversed',
      'PROCESSING': 'processing',
    };
    return map[externalStatus] || 'pending_provider';
  }
}
