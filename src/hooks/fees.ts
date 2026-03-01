// ═══════════════════════════════════════════════════════════════
// PromptPay :: Fee Engine
// Calculates transaction fees with loyalty tier discounts
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';

export interface FeeResult {
  fee: number;
  feePercent: number;
  loyaltyDiscount: number;
  netFee: number;
  total: number;
  breakdown: string;
}

export type TransactionFeeType =
  | 'p2p_transfer'
  | 'wallet_topup'
  | 'wallet_withdrawal'
  | 'bill_payment'
  | 'merchant_payment'
  | 'cross_border';

const LOYALTY_DISCOUNTS: Record<string, number> = {
  bronze: 0,
  silver: 0.05,
  gold: 0.10,
  platinum: 0.20,
};

export class FeeEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
    this.logger.info('[FeeEngine] Initialized');
  }

  calculateFee(
    type: TransactionFeeType,
    amount: number,
    currency: string,
    userId: string,
    tenantId?: string,
  ): FeeResult {
    // Get base fee config (check tenant overrides first)
    let feePercent = this.getBaseFeePercent(type, amount, tenantId);
    let flatFee = 0;

    // Withdrawal has a flat fee component
    if (type === 'wallet_withdrawal') {
      flatFee = CONFIG.fees.withdrawFlatUsd;
    }

    // Calculate raw fee
    let rawFee = (amount * feePercent / 100) + flatFee;

    // Apply loyalty discount
    let loyaltyDiscount = 0;
    const loyaltyDiscountEnabled = false; // Disabled until loyalty system is fully tested
    if (loyaltyDiscountEnabled) {
      const tier = this.getUserLoyaltyTier(userId);
      const discountRate = LOYALTY_DISCOUNTS[tier] || 0;
      if (discountRate > 0) {
        loyaltyDiscount = rawFee * discountRate;
        loyaltyDiscount = Math.round(loyaltyDiscount * 100) / 100;
      }
    }

    const netFee = Math.round((rawFee - loyaltyDiscount) * 100) / 100;
    const total = Math.round((amount + netFee) * 100) / 100;

    // Build human-readable breakdown
    const parts: string[] = [];
    if (feePercent > 0) parts.push(`${feePercent}% fee`);
    if (flatFee > 0) parts.push(`+$${flatFee.toFixed(2)} flat`);
    if (loyaltyDiscount > 0) parts.push(`-$${loyaltyDiscount.toFixed(2)} loyalty discount`);
    const breakdown = parts.length > 0 ? parts.join(', ') : 'No fee';

    return { fee: rawFee, feePercent, loyaltyDiscount, netFee, total, breakdown };
  }

  recordFee(
    userId: string,
    transactionId: string,
    transactionType: TransactionFeeType,
    amount: number,
    feeResult: FeeResult,
    currency: string = 'usd',
    tenantId?: string,
  ): void {
    const id = uuid();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO fee_ledger (id, user_id, tenant_id, transaction_id, transaction_type, amount, fee_amount, fee_percent, loyalty_discount, net_fee, currency, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, tenantId || null, transactionId, transactionType, amount, feeResult.fee, feeResult.feePercent, feeResult.loyaltyDiscount, feeResult.netFee, currency, now);

    this.logger.info(`[FeeEngine] Recorded fee: $${feeResult.netFee} on $${amount} ${transactionType} for ${userId}`);
  }

  getRevenueSummary(period: 'today' | 'week' | 'month' = 'today'): Record<string, unknown> {
    let dateFilter: string;
    const now = new Date();
    if (period === 'today') {
      dateFilter = now.toISOString().slice(0, 10);
    } else if (period === 'week') {
      const weekAgo = new Date(now.getTime() - 7 * 86400000);
      dateFilter = weekAgo.toISOString().slice(0, 10);
    } else {
      const monthAgo = new Date(now.getTime() - 30 * 86400000);
      dateFilter = monthAgo.toISOString().slice(0, 10);
    }

    const totals = this.db.prepare(`
      SELECT
        COUNT(*) as transaction_count,
        COALESCE(SUM(amount), 0) as total_volume,
        COALESCE(SUM(fee_amount), 0) as total_fees_gross,
        COALESCE(SUM(loyalty_discount), 0) as total_discounts,
        COALESCE(SUM(net_fee), 0) as total_fees_net
      FROM fee_ledger WHERE created_at >= ?
    `).get(dateFilter) as Record<string, number>;

    const byType = this.db.prepare(`
      SELECT
        transaction_type,
        COUNT(*) as count,
        COALESCE(SUM(amount), 0) as volume,
        COALESCE(SUM(net_fee), 0) as fees
      FROM fee_ledger WHERE created_at >= ?
      GROUP BY transaction_type ORDER BY fees DESC
    `).all(dateFilter) as Array<Record<string, unknown>>;

    return { period, ...totals, byType };
  }

  private getBaseFeePercent(type: TransactionFeeType, amount: number, tenantId?: string): number {
    // Check tenant overrides
    if (tenantId) {
      const tenant = this.db.prepare('SELECT config FROM tenants WHERE id = ?').get(tenantId) as { config: string } | undefined;
      if (tenant) {
        try {
          const config = JSON.parse(tenant.config);
          if (config.feeOverrides) {
            const override = config.feeOverrides[type + 'Percent'];
            if (typeof override === 'number') return override;
          }
        } catch { /* use defaults */ }
      }
    }

    switch (type) {
      case 'p2p_transfer':
        return amount <= CONFIG.fees.p2pFreeThresholdUsd ? 0 : CONFIG.fees.p2pPercent;
      case 'wallet_topup':
        return CONFIG.fees.topupPercent;
      case 'wallet_withdrawal':
        return CONFIG.fees.withdrawPercent;
      case 'bill_payment':
        return CONFIG.fees.billPayPercent;
      case 'merchant_payment':
        return CONFIG.fees.paymentPercent;
      case 'cross_border':
        return CONFIG.fees.crossBorderPercent;
      default:
        return 0;
    }
  }

  private getUserLoyaltyTier(userId: string): string {
    const row = this.db.prepare('SELECT tier FROM loyalty_accounts WHERE user_id = ?').get(userId) as { tier: string } | undefined;
    return row?.tier || 'bronze';
  }
}
