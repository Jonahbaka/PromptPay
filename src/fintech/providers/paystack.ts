import type {
  IProviderPlugin, ProviderCapability, ProviderHealthCheck,
  TransactionIntent, ProviderTransactionResult, WebhookPayload, WebhookResult
} from './types.js';
import { createHmac } from 'node:crypto';

export class PaystackPlugin implements IProviderPlugin {
  readonly slug = 'paystack';
  readonly displayName = 'Paystack';
  readonly providerType = 'digital_rails' as const;

  private secretKey: string;
  private baseUrl = 'https://api.paystack.co';

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  getCapabilities(): ProviderCapability[] {
    return ['collections', 'transfers', 'webhook_events', 'balance_query'];
  }

  async checkHealth(): Promise<ProviderHealthCheck> {
    const start = Date.now();
    try {
      const res = await fetch(`${this.baseUrl}/balance`, {
        headers: { Authorization: `Bearer ${this.secretKey}` }
      });
      return {
        status: res.ok ? 'healthy' : 'degraded',
        latencyMs: Date.now() - start,
        message: res.ok ? undefined : `HTTP ${res.status}`
      };
    } catch (err) {
      return { status: 'down', latencyMs: Date.now() - start, message: String(err) };
    }
  }

  async createCollection(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    try {
      const res = await fetch(`${this.baseUrl}/transaction/initialize`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          amount: intent.amount_minor,
          currency: intent.currency,
          email: intent.metadata?.email || 'customer@upromptpay.com',
          reference: intent.metadata?.reference,
          metadata: intent.metadata
        })
      });
      const data = await res.json() as any;
      return {
        success: data.status === true,
        externalId: data.data?.reference,
        status: data.status ? 'pending_provider' : 'failed',
        metadata: { authorization_url: data.data?.authorization_url, access_code: data.data?.access_code }
      };
    } catch (err) {
      return { success: false, status: 'failed', error: String(err) };
    }
  }

  async createTransfer(intent: TransactionIntent): Promise<ProviderTransactionResult> {
    try {
      const res = await fetch(`${this.baseUrl}/transfer`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          source: 'balance',
          amount: intent.amount_minor,
          currency: intent.currency,
          recipient: intent.recipient,
          reason: intent.metadata?.reason || 'PromptPay transfer',
          reference: intent.metadata?.reference
        })
      });
      const data = await res.json() as any;
      return {
        success: data.status === true,
        externalId: data.data?.transfer_code,
        status: this.mapExternalStatusToInternal(data.data?.status || 'failed'),
        metadata: data.data
      };
    } catch (err) {
      return { success: false, status: 'failed', error: String(err) };
    }
  }

  async fetchTransactionById(externalId: string): Promise<ProviderTransactionResult | null> {
    try {
      const res = await fetch(`${this.baseUrl}/transaction/verify/${encodeURIComponent(externalId)}`, {
        headers: { Authorization: `Bearer ${this.secretKey}` }
      });
      const data = await res.json() as any;
      if (!data.data) return null;
      return {
        success: data.data.status === 'success',
        externalId: data.data.reference,
        status: this.mapExternalStatusToInternal(data.data.status),
        providerStatus: data.data.status,
        amount_minor: data.data.amount,
        fee_minor: data.data.fees,
        metadata: data.data
      };
    } catch {
      return null;
    }
  }

  async fetchBalance(): Promise<{ available_minor: number; currency: string }> {
    const res = await fetch(`${this.baseUrl}/balance`, {
      headers: { Authorization: `Bearer ${this.secretKey}` }
    });
    const data = await res.json() as any;
    const ngn = data.data?.find((b: any) => b.currency === 'NGN');
    return { available_minor: ngn?.balance ?? 0, currency: 'NGN' };
  }

  verifyWebhookSignature(payload: WebhookPayload): boolean {
    const signature = payload.headers['x-paystack-signature'];
    if (!signature || !payload.rawBody) return false;
    const hash = createHmac('sha512', this.secretKey).update(payload.rawBody).digest('hex');
    return hash === signature;
  }

  async handleWebhookEvent(payload: WebhookPayload): Promise<WebhookResult> {
    const body = payload.body as any;
    const event = body.event || '';
    const data = body.data || {};
    return {
      valid: this.verifyWebhookSignature(payload),
      eventType: event,
      externalId: data.reference || data.transfer_code,
      internalStatus: this.mapExternalStatusToInternal(data.status),
      amount_minor: data.amount,
      metadata: data
    };
  }

  mapExternalStatusToInternal(externalStatus: string): string {
    const map: Record<string, string> = {
      'success': 'provider_confirmed',
      'failed': 'failed',
      'abandoned': 'failed',
      'pending': 'pending_provider',
      'reversed': 'reversed',
      'queued': 'processing',
      'ongoing': 'processing',
      'otp': 'processing',
    };
    return map[externalStatus] || 'pending_provider';
  }
}
