// ═══════════════════════════════════════════════════════════════
// PromptPay :: Shared Stripe Provider
// Deduplicated Stripe API helpers used by Nexus (wallet) + Janus (us-payment)
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from '../core/config.js';

const STRIPE_BASE = 'https://api.stripe.com/v1';

/** Make an authenticated Stripe API request */
export async function stripeRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
  body?: Record<string, string | number | boolean | undefined>,
): Promise<Record<string, unknown>> {
  const url = `${STRIPE_BASE}${endpoint}`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${CONFIG.stripe.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  let bodyString: string | undefined;
  if (body) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) {
        params.append(key, String(value));
      }
    }
    bodyString = params.toString();
  }

  const response = await fetch(url, {
    method,
    headers,
    body: bodyString,
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    throw new Error(`Stripe ${method} ${endpoint}: ${err?.message || response.statusText}`);
  }

  return data;
}

/** Ensure a Stripe customer exists for a userId. Creates one if needed. */
export async function ensureStripeCustomer(
  userId: string,
  email?: string,
  name?: string,
): Promise<string> {
  // Search for existing customer by metadata
  const search = await stripeRequest(`/customers/search?query=metadata['userId']:'${userId}'`, 'GET');
  const results = (search.data as Array<{ id: string }>) || [];

  if (results.length > 0) {
    return results[0].id;
  }

  // Create new customer
  const customer = await stripeRequest('/customers', 'POST', {
    email: email || `${userId}@promptpay.app`,
    name: name || userId,
    'metadata[userId]': userId,
    'metadata[platform]': 'PromptPay',
  });

  return customer.id as string;
}

/** List a customer's payment methods */
export async function listPaymentMethods(
  customerId: string,
  type = 'card',
): Promise<Array<Record<string, unknown>>> {
  const result = await stripeRequest(
    `/payment_methods?customer=${customerId}&type=${type}`, 'GET'
  );
  return (result.data as Array<Record<string, unknown>>) || [];
}
