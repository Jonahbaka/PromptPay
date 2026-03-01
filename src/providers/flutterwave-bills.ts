// ═══════════════════════════════════════════════════════════════
// Flutterwave Bills API — Electricity, Cable TV, Betting Top-ups
// Wraps /v3/bill-payments for Nigerian billers
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from '../core/config.js';

const FLW_BASE = 'https://api.flutterwave.com/v3';

interface BillerInfo {
  code: string;
  name: string;
  itemCode: string;
  shortName: string;
}

export interface BillerCategory {
  category: string;
  billers: BillerInfo[];
}

// Hardcoded Nigerian biller catalog for fast response (no API call needed)
const NIGERIAN_BILLERS: Record<string, BillerInfo[]> = {
  electricity: [
    { code: 'BIL099', name: 'Ikeja Electric (IKEDC)', itemCode: 'AT099', shortName: 'IKEDC' },
    { code: 'BIL100', name: 'Eko Electric (EKEDC)', itemCode: 'AT100', shortName: 'EKEDC' },
    { code: 'BIL101', name: 'Abuja Electric (AEDC)', itemCode: 'AT101', shortName: 'AEDC' },
    { code: 'BIL102', name: 'Port Harcourt Electric (PHEDC)', itemCode: 'AT102', shortName: 'PHEDC' },
    { code: 'BIL103', name: 'Ibadan Electric (IBEDC)', itemCode: 'AT103', shortName: 'IBEDC' },
    { code: 'BIL104', name: 'Kano Electric (KEDCO)', itemCode: 'AT104', shortName: 'KEDCO' },
    { code: 'BIL105', name: 'Benin Electric (BEDC)', itemCode: 'AT105', shortName: 'BEDC' },
  ],
  cable: [
    { code: 'BIL121', name: 'DSTV', itemCode: 'AT121', shortName: 'DSTV' },
    { code: 'BIL122', name: 'GOtv', itemCode: 'AT122', shortName: 'GOTV' },
    { code: 'BIL123', name: 'StarTimes', itemCode: 'AT123', shortName: 'StarTimes' },
  ],
  betting: [
    { code: 'BIL130', name: 'Bet9ja', itemCode: 'AT130', shortName: 'Bet9ja' },
    { code: 'BIL131', name: 'SportyBet', itemCode: 'AT131', shortName: 'SportyBet' },
    { code: 'BIL132', name: '1xBet', itemCode: 'AT132', shortName: '1xBet' },
    { code: 'BIL133', name: 'BetKing', itemCode: 'AT133', shortName: 'BetKing' },
  ],
};

/** Return available billers for a category (or all categories) */
export function getBillCategories(category?: string): BillerCategory[] {
  if (category && NIGERIAN_BILLERS[category]) {
    return [{ category, billers: NIGERIAN_BILLERS[category] }];
  }
  return Object.entries(NIGERIAN_BILLERS).map(([cat, billers]) => ({
    category: cat,
    billers,
  }));
}

/** Find a biller by code from our catalog */
export function findBiller(billerCode: string): (BillerInfo & { category: string }) | null {
  for (const [category, billers] of Object.entries(NIGERIAN_BILLERS)) {
    const biller = billers.find(b => b.code === billerCode);
    if (biller) return { ...biller, category };
  }
  return null;
}

/** Validate a bill customer (meter number, smartcard, account ID) */
export async function validateBillCustomer(
  itemCode: string,
  billerCode: string,
  customerId: string,
): Promise<{ valid: boolean; customerName?: string; error?: string }> {
  if (!CONFIG.flutterwave.secretKey) {
    return { valid: false, error: 'Flutterwave not configured' };
  }

  try {
    const resp = await fetch(`${FLW_BASE}/bill-payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.flutterwave.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'NG',
        customer: customerId,
        amount: 0,
        type: itemCode,
        reference: `VAL-${Date.now().toString(36)}`,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await resp.json() as Record<string, unknown>;

    if (data.status === 'success' && data.data) {
      const d = data.data as Record<string, unknown>;
      return {
        valid: true,
        customerName: (d.name as string) || (d.customer_name as string) || customerId,
      };
    }

    return { valid: false, error: (data.message as string) || 'Validation failed' };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Validation request failed' };
  }
}

/** Pay a bill via Flutterwave */
export async function payBill(
  itemCode: string,
  billerCode: string,
  customerId: string,
  amount: number,
  reference: string,
): Promise<{ success: boolean; flwRef?: string; txRef?: string; error?: string }> {
  if (!CONFIG.flutterwave.secretKey) {
    return { success: false, error: 'Flutterwave not configured' };
  }

  try {
    const resp = await fetch(`${FLW_BASE}/bill-payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CONFIG.flutterwave.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        country: 'NG',
        customer: customerId,
        amount,
        type: itemCode,
        reference,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await resp.json() as Record<string, unknown>;

    if (data.status === 'success') {
      const d = data.data as Record<string, unknown> | undefined;
      return {
        success: true,
        flwRef: (d?.flw_ref as string) || (d?.reference as string) || '',
        txRef: (d?.tx_ref as string) || reference,
      };
    }

    return { success: false, error: (data.message as string) || 'Bill payment failed' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Bill payment request failed' };
  }
}
