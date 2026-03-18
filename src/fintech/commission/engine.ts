import type Database from 'better-sqlite3';

export interface CommissionInput {
  transactionId: string;
  transactionType: string;
  productType?: string;
  providerId: string;
  grossAmountMinor: number;
  providerFeeMinor: number;
  currency: string;
  tenantId?: string;
  region?: string;
  supervisorId?: string;
  agentId?: string;
}

export interface CommissionBreakdown {
  ruleId: string | null;
  ruleVersion: number;
  grossAmountMinor: number;
  providerFeeMinor: number;
  distributablePoolMinor: number;
  platformShareMinor: number;
  agentShareMinor: number;
  supervisorShareMinor: number;
  tenantShareMinor: number;
  regionalShareMinor: number;
  reserveHoldbackMinor: number;
  adjustmentMinor: number;
  currency: string;
}

export class CommissionEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Calculate commission breakdown for a transaction.
   * Uses rule priority: agent > supervisor > tenant > provider+product > system default
   */
  calculate(input: CommissionInput): CommissionBreakdown {
    const rule = this.findApplicableRule(input);

    const distributablePool = input.grossAmountMinor - input.providerFeeMinor;

    if (!rule || distributablePool <= 0) {
      return this.emptyBreakdown(input, null);
    }

    // Check minimum net revenue threshold
    if (rule.min_net_revenue_minor && distributablePool < rule.min_net_revenue_minor) {
      return this.emptyBreakdown(input, rule.id);
    }

    // Calculate shares from basis points (1 bps = 0.01%)
    let platformShare = Math.floor(distributablePool * rule.platform_share_bps / 10000);
    let agentShare = Math.floor(distributablePool * rule.agent_share_bps / 10000);
    let supervisorShare = Math.floor(distributablePool * rule.supervisor_share_bps / 10000);
    let tenantShare = Math.floor(distributablePool * rule.tenant_share_bps / 10000);
    let regionalShare = Math.floor(distributablePool * rule.regional_share_bps / 10000);
    let reserveHoldback = Math.floor(distributablePool * rule.reserve_holdback_bps / 10000);

    // Add flat fees if configured
    if (rule.flat_fee_minor) {
      platformShare += rule.flat_fee_minor;
    }

    // Apply caps and floors
    if (rule.cap_amount_minor && agentShare > rule.cap_amount_minor) {
      const excess = agentShare - rule.cap_amount_minor;
      agentShare = rule.cap_amount_minor;
      platformShare += excess; // excess goes to platform
    }

    if (rule.floor_amount_minor && agentShare < rule.floor_amount_minor) {
      agentShare = Math.min(rule.floor_amount_minor, distributablePool);
    }

    // Adjustment: ensure total doesn't exceed pool (rounding protection)
    const totalDistributed = platformShare + agentShare + supervisorShare + tenantShare + regionalShare + reserveHoldback;
    const adjustment = distributablePool - totalDistributed;

    const breakdown: CommissionBreakdown = {
      ruleId: rule.id,
      ruleVersion: rule.version || 1,
      grossAmountMinor: input.grossAmountMinor,
      providerFeeMinor: input.providerFeeMinor,
      distributablePoolMinor: distributablePool,
      platformShareMinor: platformShare,
      agentShareMinor: agentShare,
      supervisorShareMinor: supervisorShare,
      tenantShareMinor: tenantShare,
      regionalShareMinor: regionalShare,
      reserveHoldbackMinor: reserveHoldback,
      adjustmentMinor: adjustment,
      currency: input.currency
    };

    return breakdown;
  }

  /**
   * Calculate AND persist the commission result + line items to the database.
   */
  calculateAndStore(input: CommissionInput): CommissionBreakdown {
    const breakdown = this.calculate(input);

    // Store commission result
    this.db.prepare(`
      INSERT INTO commission_results (
        id, transaction_id, rule_id, rule_version,
        gross_amount_minor, provider_fee_minor, distributable_pool_minor,
        platform_share_minor, agent_share_minor, supervisor_share_minor,
        tenant_share_minor, regional_share_minor, reserve_holdback_minor,
        adjustment_minor, currency, certainty
      ) VALUES (
        lower(hex(randomblob(16))), ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, 'estimated'
      )
    `).run(
      input.transactionId, breakdown.ruleId, breakdown.ruleVersion,
      breakdown.grossAmountMinor, breakdown.providerFeeMinor, breakdown.distributablePoolMinor,
      breakdown.platformShareMinor, breakdown.agentShareMinor, breakdown.supervisorShareMinor,
      breakdown.tenantShareMinor, breakdown.regionalShareMinor, breakdown.reserveHoldbackMinor,
      breakdown.adjustmentMinor, breakdown.currency
    );

    // Store line items for audit trail
    const insertLine = this.db.prepare(`
      INSERT INTO transaction_line_items (id, transaction_id, line_type, amount_minor, currency, description)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?)
    `);

    const lines: [string, number, string][] = [
      ['gross_amount', breakdown.grossAmountMinor, 'Gross transaction amount'],
      ['provider_fee', breakdown.providerFeeMinor, 'Provider fee deducted'],
      ['platform_share', breakdown.platformShareMinor, 'Platform revenue share'],
      ['agent_share', breakdown.agentShareMinor, 'Agent commission'],
      ['supervisor_share', breakdown.supervisorShareMinor, 'Supervisor override'],
      ['tenant_share', breakdown.tenantShareMinor, 'Tenant/organization share'],
      ['regional_share', breakdown.regionalShareMinor, 'Regional share'],
      ['reserve_holdback', breakdown.reserveHoldbackMinor, 'Reserve holdback'],
    ];

    const storeLines = this.db.transaction(() => {
      for (const [lineType, amount, desc] of lines) {
        if (amount > 0) {
          insertLine.run(input.transactionId, lineType, amount, input.currency, desc);
        }
      }
      if (breakdown.adjustmentMinor !== 0) {
        insertLine.run(input.transactionId, 'adjustment', breakdown.adjustmentMinor, input.currency, 'Rounding adjustment');
      }
    });
    storeLines();

    return breakdown;
  }

  /**
   * Find the highest-priority applicable commission rule.
   * Priority: agent-specific > supervisor > tenant > provider+product > system default
   */
  private findApplicableRule(input: CommissionInput): any | null {
    // Try agent-specific rule first
    if (input.agentId) {
      const rule = this.findRule('agent', input.agentId, input);
      if (rule) return rule;
    }

    // Try supervisor-specific
    if (input.supervisorId) {
      const rule = this.findRule('supervisor', input.supervisorId, input);
      if (rule) return rule;
    }

    // Try tenant-specific
    if (input.tenantId) {
      const rule = this.findRule('tenant', input.tenantId, input);
      if (rule) return rule;
    }

    // Try provider + product combination
    const providerRule = this.db.prepare(`
      SELECT * FROM commission_rules
      WHERE is_active = 1
        AND scope_type = 'provider'
        AND scope_id = ?
        AND (transaction_type IS NULL OR transaction_type = ?)
        AND (product_type IS NULL OR product_type = ?)
        AND (effective_from <= datetime('now'))
        AND (effective_to IS NULL OR effective_to > datetime('now'))
      ORDER BY priority ASC
      LIMIT 1
    `).get(input.providerId, input.transactionType, input.productType || null) as any;
    if (providerRule) return providerRule;

    // System default
    const systemRule = this.db.prepare(`
      SELECT * FROM commission_rules
      WHERE is_active = 1
        AND scope_type = 'system'
        AND (transaction_type IS NULL OR transaction_type = ?)
        AND (effective_from <= datetime('now'))
        AND (effective_to IS NULL OR effective_to > datetime('now'))
      ORDER BY priority ASC
      LIMIT 1
    `).get(input.transactionType) as any;

    return systemRule || null;
  }

  private findRule(scopeType: string, scopeId: string, input: CommissionInput): any | null {
    return this.db.prepare(`
      SELECT * FROM commission_rules
      WHERE is_active = 1
        AND scope_type = ?
        AND scope_id = ?
        AND (transaction_type IS NULL OR transaction_type = ?)
        AND (product_type IS NULL OR product_type = ?)
        AND (provider_id IS NULL OR provider_id = ?)
        AND (effective_from <= datetime('now'))
        AND (effective_to IS NULL OR effective_to > datetime('now'))
      ORDER BY priority ASC
      LIMIT 1
    `).get(scopeType, scopeId, input.transactionType, input.productType || null, input.providerId) as any;
  }

  private emptyBreakdown(input: CommissionInput, ruleId: string | null): CommissionBreakdown {
    return {
      ruleId,
      ruleVersion: 0,
      grossAmountMinor: input.grossAmountMinor,
      providerFeeMinor: input.providerFeeMinor,
      distributablePoolMinor: Math.max(0, input.grossAmountMinor - input.providerFeeMinor),
      platformShareMinor: 0,
      agentShareMinor: 0,
      supervisorShareMinor: 0,
      tenantShareMinor: 0,
      regionalShareMinor: 0,
      reserveHoldbackMinor: 0,
      adjustmentMinor: 0,
      currency: input.currency
    };
  }
}
