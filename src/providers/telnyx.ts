// ═══════════════════════════════════════════════════════════════
// PromptPay :: Telnyx Provider
// Full Platform: Voice, Virtual Numbers, SIMs, SMS, AI Inference
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from '../core/config.js';

// ── Core Request Helper ──

async function telnyxRequest(
  endpoint: string,
  body?: Record<string, unknown>,
  method = 'POST'
): Promise<Record<string, unknown>> {
  const url = `${CONFIG.telnyx.baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.telnyx.apiKey}`,
    },
    ...(body && method !== 'GET' ? { body: JSON.stringify(body) } : {}),
  });
  return await res.json() as Record<string, unknown>;
}

function extractData(result: Record<string, unknown>): Record<string, unknown> {
  return (result.data || result) as Record<string, unknown>;
}

function extractErrors(result: Record<string, unknown>): string | undefined {
  const errors = result.errors as Array<Record<string, unknown>> | undefined;
  return errors?.[0]?.detail as string | undefined;
}

// ═══════════════════════════════════════════════════════════════
// 1. PROGRAMMABLE VOICE — /v2/calls
// ═══════════════════════════════════════════════════════════════

/** Initiate an outbound call via Call Control */
export async function initiateCall(params: {
  to: string;
  from?: string;
  connectionId?: string;
  clientState?: string;
}): Promise<{ success: boolean; callControlId?: string; callLegId?: string; error?: string }> {
  const result = await telnyxRequest('/calls', {
    connection_id: params.connectionId || CONFIG.telnyx.sipConnectionId,
    to: params.to,
    from: params.from || CONFIG.telnyx.callerIdNumber,
    client_state: params.clientState ? Buffer.from(params.clientState).toString('base64') : undefined,
  });

  const data = extractData(result);
  if (data.call_control_id) {
    return {
      success: true,
      callControlId: data.call_control_id as string,
      callLegId: data.call_leg_id as string,
    };
  }
  return { success: false, error: extractErrors(result) || 'Call initiation failed' };
}

/** Hang up a call */
export async function hangupCall(callControlId: string): Promise<{ success: boolean }> {
  const result = await telnyxRequest(`/calls/${callControlId}/actions/hangup`, {});
  return { success: !result.errors };
}

/** Generate a credential token for WebRTC (browser-based calling) */
export async function createWebRtcToken(params: {
  connectionId?: string;
}): Promise<{ token?: string; error?: string }> {
  const result = await telnyxRequest('/telephony_credentials', {
    connection_id: params.connectionId || CONFIG.telnyx.sipConnectionId,
    name: `webrtc-${Date.now()}`,
    tag: 'promptpay-webrtc',
  });

  const data = extractData(result);
  if (data.id) {
    const tokenResult = await telnyxRequest(
      `/telephony_credentials/${data.id}/token`, {}, 'POST'
    );
    return { token: (tokenResult as unknown as string) || JSON.stringify(tokenResult) };
  }
  return { error: 'Failed to create WebRTC credential' };
}

/** Rate lookup for a destination */
export async function getCallRate(destination: string): Promise<{ rate?: string; currency?: string; country?: string }> {
  const rates: Record<string, { rate: string; country: string }> = {
    '+234': { rate: '0.10', country: 'Nigeria' },
    '+233': { rate: '0.12', country: 'Ghana' },
    '+254': { rate: '0.11', country: 'Kenya' },
    '+27':  { rate: '0.08', country: 'South Africa' },
    '+255': { rate: '0.13', country: 'Tanzania' },
    '+256': { rate: '0.12', country: 'Uganda' },
    '+237': { rate: '0.15', country: 'Cameroon' },
    '+221': { rate: '0.14', country: 'Senegal' },
    '+251': { rate: '0.13', country: 'Ethiopia' },
    '+1':   { rate: '0.01', country: 'US/Canada' },
    '+44':  { rate: '0.02', country: 'United Kingdom' },
    '+91':  { rate: '0.03', country: 'India' },
    '+86':  { rate: '0.02', country: 'China' },
    '+49':  { rate: '0.02', country: 'Germany' },
    '+33':  { rate: '0.02', country: 'France' },
    '+55':  { rate: '0.06', country: 'Brazil' },
    '+52':  { rate: '0.04', country: 'Mexico' },
    '+81':  { rate: '0.05', country: 'Japan' },
    '+61':  { rate: '0.03', country: 'Australia' },
    '+971': { rate: '0.08', country: 'UAE' },
    '+966': { rate: '0.10', country: 'Saudi Arabia' },
    '+20':  { rate: '0.07', country: 'Egypt' },
    '+212': { rate: '0.12', country: 'Morocco' },
    '+225': { rate: '0.14', country: 'Ivory Coast' },
    '+228': { rate: '0.15', country: 'Togo' },
    '+229': { rate: '0.15', country: 'Benin' },
  };

  for (const [prefix, info] of Object.entries(rates)) {
    if (destination.startsWith(prefix)) {
      return { rate: info.rate, currency: 'USD', country: info.country };
    }
  }
  return { rate: '0.15', currency: 'USD', country: 'International' };
}

// ═══════════════════════════════════════════════════════════════
// 2. VIRTUAL NUMBERS — /v2/number_orders
// ═══════════════════════════════════════════════════════════════

/** Search available phone numbers for purchase */
export async function searchNumbers(params: {
  countryCode: string;
  numberType?: 'local' | 'toll_free' | 'national';
  city?: string;
  limit?: number;
}): Promise<{ numbers: Array<Record<string, unknown>>; error?: string }> {
  let qs = `?filter[country_code]=${params.countryCode}&filter[limit]=${params.limit || 10}`;
  if (params.numberType) qs += `&filter[number_type]=${params.numberType}`;
  if (params.city) qs += `&filter[city]=${encodeURIComponent(params.city)}`;

  const result = await telnyxRequest(`/available_phone_numbers${qs}`, undefined, 'GET');
  if (result.errors) return { numbers: [], error: extractErrors(result) };
  return { numbers: (result.data || []) as Array<Record<string, unknown>> };
}

/** Order (purchase) a phone number */
export async function orderNumber(params: {
  phoneNumber: string;
  connectionId?: string;
}): Promise<{ success: boolean; orderId?: string; number?: string; error?: string }> {
  const result = await telnyxRequest('/number_orders', {
    phone_numbers: [{ phone_number: params.phoneNumber }],
    connection_id: params.connectionId || CONFIG.telnyx.sipConnectionId || undefined,
  });

  const data = extractData(result);
  if (data.id) {
    return {
      success: true,
      orderId: data.id as string,
      number: params.phoneNumber,
    };
  }
  return { success: false, error: extractErrors(result) || 'Number order failed' };
}

/** List owned phone numbers */
export async function listOwnedNumbers(params?: {
  pageSize?: number;
}): Promise<{ numbers: Array<Record<string, unknown>> }> {
  const result = await telnyxRequest(
    `/phone_numbers?page[size]=${params?.pageSize || 25}`, undefined, 'GET'
  );
  return { numbers: (result.data || []) as Array<Record<string, unknown>> };
}

/** Release (delete) a phone number */
export async function releaseNumber(numberId: string): Promise<{ success: boolean }> {
  const result = await telnyxRequest(`/phone_numbers/${numberId}`, undefined, 'DELETE');
  return { success: !result.errors };
}

// ═══════════════════════════════════════════════════════════════
// 3. SIM CARDS / eSIMs — /v2/sim_card_orders
// ═══════════════════════════════════════════════════════════════

/** Order SIM cards (physical or eSIM) */
export async function orderSimCards(params: {
  quantity: number;
  simType?: 'physical' | 'esim';
  addressId?: string;
}): Promise<{ success: boolean; orderId?: string; error?: string }> {
  const body: Record<string, unknown> = {
    sim_card_count: params.quantity,
    sim_card_type: params.simType || 'esim',
  };
  if (params.addressId) body.address_id = params.addressId;

  const result = await telnyxRequest('/sim_card_orders', body);
  const data = extractData(result);
  if (data.id) {
    return { success: true, orderId: data.id as string };
  }
  return { success: false, error: extractErrors(result) || 'SIM order failed' };
}

/** List SIM cards on the account */
export async function listSimCards(params?: {
  status?: 'active' | 'inactive' | 'standby';
  pageSize?: number;
}): Promise<{ sims: Array<Record<string, unknown>> }> {
  let qs = `?page[size]=${params?.pageSize || 25}`;
  if (params?.status) qs += `&filter[status]=${params.status}`;

  const result = await telnyxRequest(`/sim_cards${qs}`, undefined, 'GET');
  return { sims: (result.data || []) as Array<Record<string, unknown>> };
}

/** Activate a SIM card */
export async function activateSimCard(simId: string): Promise<{ success: boolean; error?: string }> {
  const result = await telnyxRequest(`/sim_cards/${simId}/actions/enable`, {});
  if (result.errors) return { success: false, error: extractErrors(result) };
  return { success: true };
}

/** Deactivate a SIM card */
export async function deactivateSimCard(simId: string): Promise<{ success: boolean }> {
  const result = await telnyxRequest(`/sim_cards/${simId}/actions/disable`, {});
  return { success: !result.errors };
}

/** Get SIM card details */
export async function getSimCard(simId: string): Promise<Record<string, unknown>> {
  const result = await telnyxRequest(`/sim_cards/${simId}`, undefined, 'GET');
  return extractData(result);
}

// ═══════════════════════════════════════════════════════════════
// 4. MESSAGING — /v2/messages
// ═══════════════════════════════════════════════════════════════

/** Send an SMS or MMS */
export async function sendSms(params: {
  to: string;
  from: string;
  text: string;
  mediaUrls?: string[];
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const body: Record<string, unknown> = {
    to: params.to,
    from: params.from,
    text: params.text,
    type: params.mediaUrls?.length ? 'MMS' : 'SMS',
  };
  if (params.mediaUrls?.length) body.media_urls = params.mediaUrls;

  const result = await telnyxRequest('/messages', body);
  const data = extractData(result);
  if (data.id) {
    return { success: true, messageId: data.id as string };
  }
  return { success: false, error: extractErrors(result) || 'Message send failed' };
}

/** Get message details */
export async function getMessage(messageId: string): Promise<Record<string, unknown>> {
  const result = await telnyxRequest(`/messages/${messageId}`, undefined, 'GET');
  return extractData(result);
}

// ═══════════════════════════════════════════════════════════════
// 5. CONVERSATIONAL AI — /v2/ai/chat/completions (OpenAI-compatible)
// ═══════════════════════════════════════════════════════════════

/** Run AI inference (LLM chat completion via Telnyx) */
export async function aiInference(params: {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
}): Promise<{ reply?: string; usage?: Record<string, unknown>; error?: string }> {
  const result = await telnyxRequest('/ai/chat/completions', {
    model: params.model || 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    messages: params.messages,
    max_tokens: params.maxTokens || 512,
    temperature: params.temperature ?? 0.7,
  });

  // Telnyx AI returns OpenAI-compatible format
  const choices = (result.choices || []) as Array<Record<string, unknown>>;
  if (choices.length > 0) {
    const msg = choices[0].message as Record<string, unknown> | undefined;
    return {
      reply: (msg?.content as string) || '',
      usage: result.usage as Record<string, unknown>,
    };
  }
  return { error: extractErrors(result) || (result.detail ? String(result.detail) : 'AI inference failed') };
}

/** Summarize text using Telnyx AI */
export async function aiSummarize(text: string): Promise<{ summary?: string; error?: string }> {
  const result = await aiInference({
    messages: [
      { role: 'system', content: 'You are a helpful assistant. Summarize the following text concisely.' },
      { role: 'user', content: text },
    ],
    maxTokens: 256,
    temperature: 0.3,
  });
  return { summary: result.reply, error: result.error };
}

/** Translate text using Telnyx AI */
export async function aiTranslate(params: {
  text: string;
  targetLanguage: string;
  sourceLanguage?: string;
}): Promise<{ translation?: string; error?: string }> {
  const result = await aiInference({
    messages: [
      {
        role: 'system',
        content: `Translate the following text to ${params.targetLanguage}. ${params.sourceLanguage ? `Source language: ${params.sourceLanguage}.` : ''} Return only the translation, nothing else.`,
      },
      { role: 'user', content: params.text },
    ],
    maxTokens: 512,
    temperature: 0.2,
  });
  return { translation: result.reply, error: result.error };
}

// ═══════════════════════════════════════════════════════════════
// 6. ACCOUNT — Balance & Info
// ═══════════════════════════════════════════════════════════════

/** Get account balance */
export async function getTelnyxBalance(): Promise<{ balance: string; currency: string }> {
  const result = await telnyxRequest('/balance', undefined, 'GET');
  const data = extractData(result);
  return {
    balance: (data.balance as string) || '0',
    currency: (data.currency as string) || 'USD',
  };
}
