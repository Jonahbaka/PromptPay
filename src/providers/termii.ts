// ═══════════════════════════════════════════════════════════════
// PromptPay :: Termii Provider
// Virtual numbers, SMS/OTP — Nigerian-first messaging API
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from '../core/config.js';

async function termiiRequest(
  endpoint: string,
  body?: Record<string, unknown>,
  method = 'POST'
): Promise<Record<string, unknown>> {
  const url = `${CONFIG.termii.baseUrl}${endpoint}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body && method !== 'GET' ? { body: JSON.stringify({ ...body, api_key: CONFIG.termii.apiKey }) } : {}),
  });
  return await res.json() as Record<string, unknown>;
}

/** Send SMS to a phone number */
export async function sendSms(params: {
  to: string;
  message: string;
  channel?: 'generic' | 'dnd' | 'whatsapp';
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const result = await termiiRequest('/sms/send', {
    to: params.to,
    from: CONFIG.termii.senderId,
    sms: params.message,
    type: 'plain',
    channel: params.channel || 'generic',
  });

  if (result.message_id) {
    return { success: true, messageId: result.message_id as string };
  }
  return { success: false, error: (result.message as string) || 'SMS send failed' };
}

/** Send OTP verification token */
export async function sendOtp(params: {
  to: string;
  pinLength?: number;
  pinTimeToLive?: number; // minutes
  channel?: 'generic' | 'dnd' | 'whatsapp';
}): Promise<{ success: boolean; pinId?: string; error?: string }> {
  const result = await termiiRequest('/sms/otp/send', {
    to: params.to,
    from: CONFIG.termii.senderId,
    message_type: 'NUMERIC',
    pin_type: 'NUMERIC',
    pin_attempts: 3,
    pin_time_to_live: params.pinTimeToLive || 10,
    pin_length: params.pinLength || 6,
    pin_placeholder: '< 1234 >',
    message_text: 'Your PromptPay verification code is < 1234 >. Valid for ' + (params.pinTimeToLive || 10) + ' minutes.',
    channel: params.channel || 'generic',
  });

  if (result.pinId) {
    return { success: true, pinId: result.pinId as string };
  }
  return { success: false, error: (result.message as string) || 'OTP send failed' };
}

/** Verify OTP token */
export async function verifyOtp(pinId: string, pin: string): Promise<{ verified: boolean; error?: string }> {
  const result = await termiiRequest('/sms/otp/verify', {
    pin_id: pinId,
    pin,
  });

  if (result.verified === true || result.verified === 'True') {
    return { verified: true };
  }
  return { verified: false, error: (result.message as string) || 'Invalid OTP' };
}

/** Get sender ID status */
export async function getSenderIds(): Promise<Array<Record<string, unknown>>> {
  const result = await termiiRequest(
    `/sender-id?api_key=${CONFIG.termii.apiKey}`, undefined, 'GET'
  );
  if (result.data && Array.isArray(result.data)) return result.data as Array<Record<string, unknown>>;
  return [];
}

/** Check number status (DND, active, etc.) */
export async function checkNumberStatus(phoneNumber: string, countryCode: string): Promise<Record<string, unknown>> {
  return termiiRequest('/insight/number/query', {
    phone_number: phoneNumber,
    country_code: countryCode,
  });
}

/** Get wallet balance (Termii account balance) */
export async function getTermiiBalance(): Promise<{ balance: number; currency: string }> {
  const result = await termiiRequest(
    `/get-balance?api_key=${CONFIG.termii.apiKey}`, undefined, 'GET'
  );
  return {
    balance: (result.balance as number) || 0,
    currency: (result.currency as string) || 'NGN',
  };
}
