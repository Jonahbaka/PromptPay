// ═══════════════════════════════════════════════════════════════
// PromptPay :: Shared Reloadly Provider
// Airtime + Data top-up API — used by Payment Agent + POS routes
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from '../core/config.js';

let reloadlyToken: string | null = null;
let reloadlyTokenExpiry = 0;

export async function reloadlyGetToken(): Promise<string> {
  if (reloadlyToken && Date.now() < reloadlyTokenExpiry) return reloadlyToken;
  const res = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CONFIG.reloadly.clientId,
      client_secret: CONFIG.reloadly.clientSecret,
      grant_type: 'client_credentials',
      audience: CONFIG.reloadly.environment === 'production'
        ? 'https://topups.reloadly.com' : 'https://topups-sandbox.reloadly.com',
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  reloadlyToken = data.access_token as string;
  reloadlyTokenExpiry = Date.now() + ((data.expires_in as number) * 1000) - 60000;
  return reloadlyToken;
}

export async function reloadlyRequest(path: string, body?: Record<string, unknown>, method = 'POST'): Promise<Record<string, unknown>> {
  const token = await reloadlyGetToken();
  const baseUrl = CONFIG.reloadly.environment === 'production'
    ? 'https://topups.reloadly.com' : 'https://topups-sandbox.reloadly.com';
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/com.reloadly.topups-v1+json',
    },
    ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  return await res.json() as Record<string, unknown>;
}

/** Auto-detect carrier from phone number */
export async function detectOperator(phone: string, countryCode: string): Promise<{ operatorId: number; name: string }> {
  const data = await reloadlyRequest(
    `/operators/auto-detect/phone/${phone}/countries/${countryCode}`,
    undefined, 'GET'
  );
  return {
    operatorId: data.operatorId as number,
    name: (data.name as string) || 'Unknown',
  };
}

/** Send airtime top-up */
export async function sendTopup(params: {
  operatorId: number;
  amount: number;
  phoneNumber: string;
  countryCode: string;
}): Promise<{ success: boolean; transactionId?: number; error?: string; discount?: number }> {
  const result = await reloadlyRequest('/topups', {
    operatorId: params.operatorId,
    amount: params.amount,
    useLocalAmount: true,
    recipientPhone: { countryCode: params.countryCode, number: params.phoneNumber },
    senderPhone: { countryCode: 'US', number: '0000000000' },
  });

  if (result.transactionId) {
    return {
      success: true,
      transactionId: result.transactionId as number,
      discount: (result.discount as number) || 0,
    };
  }
  return {
    success: false,
    error: (result.message as string) || (result.errorCode as string) || 'Top-up failed',
  };
}

/** Get operator discount info for pricing */
export async function getOperatorById(operatorId: number): Promise<Record<string, unknown>> {
  return reloadlyRequest(`/operators/${operatorId}`, undefined, 'GET');
}

// ═══════════════════════════════════════════════════════════════
// DATA BUNDLES (separate Reloadly endpoint, same auth)
// ═══════════════════════════════════════════════════════════════

/** List available data bundles for an operator */
export async function getDataBundles(operatorId: number): Promise<Array<Record<string, unknown>>> {
  const result = await reloadlyRequest(
    `/operators/${operatorId}/data-bundles`, undefined, 'GET'
  );
  // Reloadly returns the array directly or wraps it
  if (Array.isArray(result)) return result;
  if (result.content && Array.isArray(result.content)) return result.content as Array<Record<string, unknown>>;
  return [];
}

/** Send a data bundle top-up */
export async function sendDataTopup(params: {
  operatorId: number;
  dataBundleId: number;
  amount: number;
  phoneNumber: string;
  countryCode: string;
}): Promise<{ success: boolean; transactionId?: number; error?: string }> {
  const result = await reloadlyRequest('/topups', {
    operatorId: params.operatorId,
    amount: params.amount,
    useLocalAmount: true,
    recipientPhone: { countryCode: params.countryCode, number: params.phoneNumber },
    senderPhone: { countryCode: 'US', number: '0000000000' },
  });

  if (result.transactionId) {
    return { success: true, transactionId: result.transactionId as number };
  }
  return {
    success: false,
    error: (result.message as string) || (result.errorCode as string) || 'Data top-up failed',
  };
}
