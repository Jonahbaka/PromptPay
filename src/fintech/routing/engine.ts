import type Database from 'better-sqlite3';

export interface RoutingRequest {
  transactionType: string;
  productType?: string;
  tenantId?: string;
  region?: string;
  agentId?: string;
}

export interface RoutingDecision {
  providerId: string;
  ruleId: string | null;
  fallbackUsed: boolean;
  reason: string;
}

export class RoutingEngine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  resolve(request: RoutingRequest, transactionId?: string): RoutingDecision {
    const start = Date.now();

    // Find matching rules ordered by priority (lower = higher priority)
    const rules = this.db.prepare(`
      SELECT * FROM routing_rules
      WHERE is_active = 1
        AND (transaction_type IS NULL OR transaction_type = ?)
        AND (product_type IS NULL OR product_type = ?)
        AND (tenant_id IS NULL OR tenant_id = ?)
        AND (region IS NULL OR region = ?)
        AND (effective_from <= datetime('now'))
        AND (effective_to IS NULL OR effective_to > datetime('now'))
      ORDER BY priority ASC
      LIMIT 20
    `).all(
      request.transactionType,
      request.productType || null,
      request.tenantId || null,
      request.region || null
    ) as any[];

    if (rules.length === 0) {
      const decision: RoutingDecision = {
        providerId: 'paystack', // system default fallback
        ruleId: null,
        fallbackUsed: true,
        reason: 'No matching routing rules; using system default'
      };
      this.logDecision(transactionId || null, decision, Date.now() - start);
      return decision;
    }

    // Get highest priority rules (lowest number)
    const topPriority = rules[0].priority;
    const topRules = rules.filter((r: any) => r.priority === topPriority);

    // Weighted random selection among same-priority rules
    let selected: any;
    if (topRules.length === 1) {
      selected = topRules[0];
    } else {
      const totalWeight = topRules.reduce((sum: number, r: any) => sum + (r.weight || 100), 0);
      let random = Math.random() * totalWeight;
      for (const rule of topRules) {
        random -= rule.weight || 100;
        if (random <= 0) { selected = rule; break; }
      }
      if (!selected) selected = topRules[0];
    }

    const decision: RoutingDecision = {
      providerId: selected.provider_id,
      ruleId: selected.id,
      fallbackUsed: false,
      reason: `Matched rule "${selected.name}" (priority ${selected.priority})`
    };

    this.logDecision(transactionId || null, decision, Date.now() - start);
    return decision;
  }

  resolveFallback(originalDecision: RoutingDecision): RoutingDecision | null {
    if (!originalDecision.ruleId) return null;

    const rule = this.db.prepare('SELECT fallback_provider_id FROM routing_rules WHERE id = ?')
      .get(originalDecision.ruleId) as any;

    if (!rule?.fallback_provider_id) return null;

    return {
      providerId: rule.fallback_provider_id,
      ruleId: originalDecision.ruleId,
      fallbackUsed: true,
      reason: `Fallback from "${originalDecision.providerId}" to "${rule.fallback_provider_id}"`
    };
  }

  private logDecision(transactionId: string | null, decision: RoutingDecision, latencyMs: number): void {
    try {
      this.db.prepare(`
        INSERT INTO routing_decisions (id, transaction_id, rule_id, provider_id, fallback_used, decision_reason, latency_ms)
        VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)
      `).run(transactionId, decision.ruleId, decision.providerId, decision.fallbackUsed ? 1 : 0, decision.reason, latencyMs);
    } catch { /* non-critical logging */ }
  }
}
