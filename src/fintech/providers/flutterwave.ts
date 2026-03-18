import type {
  IProviderPlugin, ProviderCapability, ProviderHealthCheck,
  TransactionIntent, ProviderTransactionResult, WebhookPayload, WebhookResult
} from './types.js';
import { createHmac } from 'node:crypto';

export class FlutterwavePlugin implements IProviderPlugin {
  readonly slug = 'flutterwave';
  readonly displayName = 'Flutterwave';
  readonly providerType = 'digital_rails' as const;

  private secretKey: string;
  private baseUrl = 'https://api.flutterwave.com/v3';

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  getCapabilities(): ProviderCapability[] {
    return ['collections', 'transfers', 'airtime', 'data', 'bill_pay', 'webhook_events', 'balance_query'];
  }

  async checkHealth(): Promise<ProviderHealthCheck> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/balances/NGN`, {
        headers: { Authorization: `Bearer ${this.secretKey}` }
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
    try {
      const res = await fetch(`${this.baseUrl}/payments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tx_ref: intent.metadata?.reference || `pp_${Date.now()}`,
          amount: intent.amount_minor / 100,
          currency: intent.currency,
          redirect_url: intent.metadata?.redirect_url,
          customer: intent.metadata?.customer || { email: 'customer@upromptpay.com' },
          meta: intent.metadata
        })
      });
      const data = await res.json() as any;
      return {
        success: data.status === 'success',
        externalId: data.data?.tx_ref,
        status: data.status === 'success' ? 'pending_provider' : 'failed',
        metadata: data.data
      };
    } catch (err) {
      return { success: false, status: 'failed', error: String(err) };
    }
  }

  async createTransfer(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    try {
      const res = await fetch(`${this.baseUrl}/transfers`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          account_bank: intent.metadata?.bank_code,
          account_number: intent.recipient,
          amount: intent.amount_minor / 100,
          currency: intent.currency,
          reference: intent.metadata?.reference,
          narration: intent.metadata?.reason || 'PromptPay transfer'
        })
      });
      const data = await res.json() as any;
      return {
        success: data.status === 'success',
        externalId: data.data?.id?.toString(),
        status: this.mapExternalStatusToInternal(data.data?.status || 'FAILED'),
        metadata: data.data
      };
    } catch (err) {
      return { success: false, status: 'failed', error: String(err) };
    }
  }

  async executeAirtimePurchase(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    try {
      const res = await fetch(`${this.baseUrl}/bills`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          country: 'NG',
          customer: intent.recipient,
          amount: intent.amount_minor / 100,
          type: 'AIRTIME',
          reference: intent.metadata?.reference || `air_${Date.now()}`
        })
      });
      const data = await res.json() as any;
      return {
        success: data.status === 'success',
        externalId: data.data?.tx_ref,
        status: data.status === 'success' ? 'provider_confirmed' : 'failed',
        metadata: data.data
      };
    } catch (err) {
      return { success: false, status: 'failed', error: String(err) };
    }
  }

  async executeDataPurchase(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    try {
      const res = await fetch(`${this.baseUrl}/bills`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          country: 'NG',
          customer: intent.recipient,
          amount: intent.amount_minor / 100,
          type: 'INTERNET',
          biller_name: intent.metadata?.biller_name,
          reference: intent.metadata?.reference || `data_${Date.now()}`
        })
      });
      const data = await res.json() as any;
      return {
        success: data.status === 'success',
        externalId: data.data?.tx_ref,
        status: data.status === 'success' ? 'provider_confirmed' : 'failed',
        metadata: data.data
      };
    } catch (err) {
      return { success: false, status: 'failed', error: String(err) };
    }
  }

  verifyWebhookSignature(payload: WebhookPayload): boolean {
    const secretHash = payload.headers['verif-hash'];
    return secretHash === this.secretKey;
  }

  async handleWebhookEvent(payload: WebhookPayload): Promise<WebhookResult> {
    const body = payload.body as any;
    return {
      valid: this.verifyWebhookSignature(payload),
      eventType: body.event || '',
      externalId: body.data?.tx_ref || body.data?.id?.toString(),
      internalStatus: this.mapExternalStatusToInternal(body.data?.status || ''),
      amount_minor: Math.round((body.data?.amount || 0) * 100),
      metadata: body.data
    };
  }

  async fetchBalance(): Promise<{ available_minor: number; currency: string }> {
    const res = await fetch(`${this.baseUrl}/balances/NGN`, {
      headers: { Authorization: `Bearer ${this.secretKey}` }
    });
    const data = await res.json() as any;
    return {
      available_minor: Math.round((data.data?.available_balance || 0) * 100),
      currency: 'NGN'
    };
  }

  mapExternalStatusToInternal(externalStatus: string): string {
    const map: Record<string, string> = {
      'successful': 'provider_confirmed',
      'failed': 'failed',
      'pending': 'pending_provider',
      'reversed': 'reversed',
      'NEW': 'pending_provider',
      'PENDING': 'processing',
      'FAILED': 'failed',
      'SUCCESSFUL': 'provider_confirmed',
    };
    return map[externalStatus] || 'pending_provider';
  }
}
