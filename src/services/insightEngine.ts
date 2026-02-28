// ═══════════════════════════════════════════════════════════════
// PromptPay :: AI Insight Engine
// Behavioral pattern analysis, anomaly detection, churn risk
// ═══════════════════════════════════════════════════════════════

import type Database from 'better-sqlite3';

export interface Insight {
  id: string;
  type: 'warning' | 'info' | 'positive';
  title: string;
  description: string;
  confidence: number;          // 0-100
  impact_level: 'low' | 'medium' | 'high';
  category: string;
  timestamp: string;
}

export class InsightEngine {
  constructor(private db: Database.Database) {}

  // ── Generate all insights for platform or partner ──
  generateInsights(partnerId?: string): Insight[] {
    const insights: Insight[] = [];
    const now = new Date().toISOString();

    insights.push(...this.detectVolumeSpikes(partnerId));
    insights.push(...this.detectRevenueTrends(partnerId));
    insights.push(...this.detectChurnRisk(partnerId));
    insights.push(...this.detectGrowthAnomalies(partnerId));
    insights.push(...this.detectPositiveTrends(partnerId));

    return insights.sort((a, b) => {
      const impactOrder = { high: 0, medium: 1, low: 2 };
      return impactOrder[a.impact_level] - impactOrder[b.impact_level];
    });
  }

  // ── Volume Spikes ──
  private detectVolumeSpikes(partnerId?: string): Insight[] {
    const insights: Insight[] = [];
    const tenantClause = partnerId ? 'AND tenant_id = ?' : '';
    const params = partnerId ? [partnerId] : [];

    const todayVol = (this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM fee_ledger
      WHERE created_at >= date('now') ${tenantClause}
    `).get(...params) as { v: number }).v;

    const avg7d = (this.db.prepare(`
      SELECT COALESCE(SUM(amount) / 7.0, 0) as v FROM fee_ledger
      WHERE created_at >= datetime('now', '-7 days') ${tenantClause}
    `).get(...params) as { v: number }).v;

    if (avg7d > 0 && todayVol > avg7d * 2) {
      const pct = Math.round(((todayVol - avg7d) / avg7d) * 100);
      insights.push({
        id: `spike-vol-${Date.now()}`,
        type: 'warning',
        title: 'Unusual Transaction Spike',
        description: `Today's transaction volume ($${todayVol.toFixed(2)}) is ${pct}% above the 7-day average ($${avg7d.toFixed(2)}). This may indicate unusual activity or a surge in demand.`,
        confidence: Math.min(95, 60 + pct / 5),
        impact_level: pct > 200 ? 'high' : 'medium',
        category: 'volume',
        timestamp: new Date().toISOString(),
      });
    }

    return insights;
  }

  // ── Revenue Trends ──
  private detectRevenueTrends(partnerId?: string): Insight[] {
    const insights: Insight[] = [];
    const tenantClause = partnerId ? 'AND tenant_id = ?' : '';
    const params = partnerId ? [partnerId] : [];

    const thisWeek = (this.db.prepare(`
      SELECT COALESCE(SUM(net_fee), 0) as v FROM fee_ledger
      WHERE created_at >= datetime('now', '-7 days') ${tenantClause}
    `).get(...params) as { v: number }).v;

    const lastWeek = (this.db.prepare(`
      SELECT COALESCE(SUM(net_fee), 0) as v FROM fee_ledger
      WHERE created_at >= datetime('now', '-14 days')
        AND created_at < datetime('now', '-7 days') ${tenantClause}
    `).get(...params) as { v: number }).v;

    if (lastWeek > 0) {
      const change = Math.round(((thisWeek - lastWeek) / lastWeek) * 100);

      if (change < -15) {
        insights.push({
          id: `rev-decline-${Date.now()}`,
          type: 'warning',
          title: 'Revenue Declining',
          description: `Revenue dropped ${Math.abs(change)}% this week ($${thisWeek.toFixed(2)}) compared to last week ($${lastWeek.toFixed(2)}). Review transaction patterns and user engagement.`,
          confidence: 75,
          impact_level: change < -30 ? 'high' : 'medium',
          category: 'revenue',
          timestamp: new Date().toISOString(),
        });
      } else if (change > 20) {
        insights.push({
          id: `rev-growth-${Date.now()}`,
          type: 'positive',
          title: 'Strong Revenue Growth',
          description: `Revenue increased ${change}% this week ($${thisWeek.toFixed(2)}) vs last week ($${lastWeek.toFixed(2)}). Momentum is building across the platform.`,
          confidence: 80,
          impact_level: 'medium',
          category: 'revenue',
          timestamp: new Date().toISOString(),
        });
      }
    }

    return insights;
  }

  // ── Churn Risk (Partners) ──
  private detectChurnRisk(partnerId?: string): Insight[] {
    if (partnerId) return []; // Only for platform-wide
    const insights: Insight[] = [];

    const atRisk = this.db.prepare(`
      SELECT f.tenant_id, COALESCE(u.display_name, f.tenant_id) as name,
        MAX(f.created_at) as last_activity, COUNT(*) as total_tx
      FROM fee_ledger f
      LEFT JOIN users u ON u.id = f.tenant_id
      WHERE f.tenant_id IS NOT NULL
      GROUP BY f.tenant_id
      HAVING MAX(f.created_at) < datetime('now', '-14 days')
      ORDER BY total_tx DESC
      LIMIT 5
    `).all() as Array<{ tenant_id: string; name: string; last_activity: string; total_tx: number }>;

    for (const partner of atRisk) {
      const daysSince = Math.floor((Date.now() - new Date(partner.last_activity).getTime()) / 86400000);
      insights.push({
        id: `churn-${partner.tenant_id}-${Date.now()}`,
        type: 'warning',
        title: `Partner "${partner.name}" at Churn Risk`,
        description: `No activity for ${daysSince} days (last: ${partner.last_activity.split('T')[0]}). Had ${partner.total_tx} total transactions. Consider outreach.`,
        confidence: Math.min(90, 50 + daysSince * 2),
        impact_level: daysSince > 30 ? 'high' : 'medium',
        category: 'churn',
        timestamp: new Date().toISOString(),
      });
    }

    return insights;
  }

  // ── Growth Anomalies ──
  private detectGrowthAnomalies(partnerId?: string): Insight[] {
    const insights: Insight[] = [];
    const tenantClause = partnerId ? 'AND tenant_id = ?' : '';
    const params = partnerId ? [partnerId] : [];

    const newUsersThisWeek = (this.db.prepare(`
      SELECT COUNT(*) as c FROM users
      WHERE created_at >= datetime('now', '-7 days') ${tenantClause.replace('tenant_id', 'tenant_id')}
    `).get(...params) as { c: number }).c;

    const newUsersLastWeek = (this.db.prepare(`
      SELECT COUNT(*) as c FROM users
      WHERE created_at >= datetime('now', '-14 days')
        AND created_at < datetime('now', '-7 days') ${tenantClause.replace('tenant_id', 'tenant_id')}
    `).get(...params) as { c: number }).c;

    if (newUsersLastWeek > 2) {
      const change = Math.round(((newUsersThisWeek - newUsersLastWeek) / newUsersLastWeek) * 100);
      if (change > 50) {
        insights.push({
          id: `growth-spike-${Date.now()}`,
          type: 'positive',
          title: 'User Growth Surge',
          description: `New user signups jumped ${change}% this week (${newUsersThisWeek} vs ${newUsersLastWeek} last week). Review acquisition channels to sustain momentum.`,
          confidence: 70,
          impact_level: 'medium',
          category: 'growth',
          timestamp: new Date().toISOString(),
        });
      } else if (change < -40) {
        insights.push({
          id: `growth-decline-${Date.now()}`,
          type: 'warning',
          title: 'User Acquisition Slowing',
          description: `New signups dropped ${Math.abs(change)}% (${newUsersThisWeek} vs ${newUsersLastWeek}). Investigate marketing effectiveness and onboarding friction.`,
          confidence: 65,
          impact_level: 'medium',
          category: 'growth',
          timestamp: new Date().toISOString(),
        });
      }
    }

    return insights;
  }

  // ── Positive Trends ──
  private detectPositiveTrends(partnerId?: string): Insight[] {
    const insights: Insight[] = [];
    const tenantClause = partnerId ? 'AND tenant_id = ?' : '';
    const params = partnerId ? [partnerId] : [];

    // Check for milestone
    const totalTx = (this.db.prepare(`
      SELECT COUNT(*) as c FROM fee_ledger WHERE 1=1 ${tenantClause}
    `).get(...params) as { c: number }).c;

    const milestones = [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000];
    for (const m of milestones) {
      if (totalTx >= m && totalTx < m * 1.05) {
        insights.push({
          id: `milestone-${m}-${Date.now()}`,
          type: 'positive',
          title: `${m.toLocaleString()} Transactions Milestone!`,
          description: `The platform has processed ${totalTx.toLocaleString()} transactions. This milestone demonstrates strong product-market fit and growing adoption.`,
          confidence: 100,
          impact_level: 'low',
          category: 'milestone',
          timestamp: new Date().toISOString(),
        });
        break;
      }
    }

    return insights;
  }

  // ── Generate text summary for AI integration ──
  generateSummaryText(partnerId?: string): string {
    const insights = this.generateInsights(partnerId);
    if (insights.length === 0) {
      return 'All metrics are within normal ranges. No anomalies detected.';
    }

    const warnings = insights.filter(i => i.type === 'warning');
    const positives = insights.filter(i => i.type === 'positive');

    let summary = '';
    if (warnings.length > 0) {
      summary += `⚠️ ${warnings.length} attention item(s): `;
      summary += warnings.map(w => w.title).join(', ') + '. ';
    }
    if (positives.length > 0) {
      summary += `✅ ${positives.length} positive trend(s): `;
      summary += positives.map(p => p.title).join(', ') + '.';
    }
    return summary;
  }
}
