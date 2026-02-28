// ═══════════════════════════════════════════════════════════════
// PromptPay :: Analytics Service
// Platform-wide and partner-scoped metrics aggregation
// ═══════════════════════════════════════════════════════════════

import type Database from 'better-sqlite3';

export interface MetricsSummary {
  totalVolume: number;
  totalTransactions: number;
  activeUsers: number;
  activePartners: number;
  totalRevenue: number;
  avgTransactionSize: number;
  growth24h: number;
  growth7d: number;
  growth30d: number;
}

export interface TrendPoint {
  period: string;
  volume: number;
  transactions: number;
  revenue: number;
  users: number;
}

export interface TrendFilters {
  startDate?: string;
  endDate?: string;
  partnerId?: string;
  transactionType?: string;
  currency?: string;
  aggregation?: 'hourly' | 'daily' | 'weekly' | 'monthly';
}

export interface PartnerRanking {
  partnerId: string;
  partnerName: string;
  volume: number;
  revenue: number;
  transactions: number;
  growthRate: number;
}

export class AnalyticsService {
  constructor(private db: Database.Database) {}

  // ── Platform-wide KPIs ──
  getPlatformMetrics(): MetricsSummary {
    const now = new Date().toISOString();

    const volumeRow = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as vol, COUNT(*) as cnt
      FROM fee_ledger
    `).get() as { vol: number; cnt: number };

    const revenueRow = this.db.prepare(`
      SELECT COALESCE(SUM(net_fee), 0) as rev FROM fee_ledger
    `).get() as { rev: number };

    const activeUsers = (this.db.prepare(`
      SELECT COUNT(*) as c FROM users WHERE status = 'active'
        AND last_login_at >= datetime('now', '-30 days')
    `).get() as { c: number }).c;

    const activePartners = (this.db.prepare(`
      SELECT COUNT(DISTINCT tenant_id) as c FROM users
      WHERE tenant_id IS NOT NULL AND status = 'active'
    `).get() as { c: number }).c;

    const avgSize = volumeRow.cnt > 0 ? volumeRow.vol / volumeRow.cnt : 0;

    // Growth rates
    const growth24h = this.calcGrowthRate(1);
    const growth7d = this.calcGrowthRate(7);
    const growth30d = this.calcGrowthRate(30);

    return {
      totalVolume: Math.round(volumeRow.vol * 100) / 100,
      totalTransactions: volumeRow.cnt,
      activeUsers,
      activePartners,
      totalRevenue: Math.round(revenueRow.rev * 100) / 100,
      avgTransactionSize: Math.round(avgSize * 100) / 100,
      growth24h,
      growth7d,
      growth30d,
    };
  }

  // ── Partner-scoped KPIs ──
  getPartnerMetrics(partnerId: string): MetricsSummary {
    const volumeRow = this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as vol, COUNT(*) as cnt
      FROM fee_ledger WHERE tenant_id = ?
    `).get(partnerId) as { vol: number; cnt: number };

    const revenueRow = this.db.prepare(`
      SELECT COALESCE(SUM(net_fee), 0) as rev FROM fee_ledger WHERE tenant_id = ?
    `).get(partnerId) as { rev: number };

    const activeUsers = (this.db.prepare(`
      SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND status = 'active'
        AND last_login_at >= datetime('now', '-30 days')
    `).get(partnerId) as { c: number }).c;

    const avgSize = volumeRow.cnt > 0 ? volumeRow.vol / volumeRow.cnt : 0;

    return {
      totalVolume: Math.round(volumeRow.vol * 100) / 100,
      totalTransactions: volumeRow.cnt,
      activeUsers,
      activePartners: 1,
      totalRevenue: Math.round(revenueRow.rev * 100) / 100,
      avgTransactionSize: Math.round(avgSize * 100) / 100,
      growth24h: this.calcGrowthRate(1, partnerId),
      growth7d: this.calcGrowthRate(7, partnerId),
      growth30d: this.calcGrowthRate(30, partnerId),
    };
  }

  // ── Transaction Trends ──
  getTransactionTrends(filters: TrendFilters): TrendPoint[] {
    const agg = filters.aggregation || 'daily';
    const fmtMap: Record<string, string> = {
      hourly: '%Y-%m-%d %H:00',
      daily: '%Y-%m-%d',
      weekly: '%Y-W%W',
      monthly: '%Y-%m',
    };
    const fmt = fmtMap[agg] || fmtMap.daily;

    let sql = `
      SELECT strftime('${fmt}', created_at) as period,
        COALESCE(SUM(amount), 0) as volume,
        COUNT(*) as transactions,
        COALESCE(SUM(net_fee), 0) as revenue
      FROM fee_ledger WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters.startDate) { sql += ' AND created_at >= ?'; params.push(filters.startDate); }
    if (filters.endDate) { sql += ' AND created_at <= ?'; params.push(filters.endDate); }
    if (filters.partnerId) { sql += ' AND tenant_id = ?'; params.push(filters.partnerId); }
    if (filters.transactionType) { sql += ' AND transaction_type = ?'; params.push(filters.transactionType); }
    if (filters.currency) { sql += ' AND currency = ?'; params.push(filters.currency); }

    sql += ` GROUP BY period ORDER BY period ASC LIMIT 365`;

    const rows = this.db.prepare(sql).all(...params) as Array<{
      period: string; volume: number; transactions: number; revenue: number;
    }>;

    // Attach user count per period
    return rows.map(r => ({
      ...r,
      volume: Math.round(r.volume * 100) / 100,
      revenue: Math.round(r.revenue * 100) / 100,
      users: 0, // filled in separately if needed
    }));
  }

  // ── User Growth Trend ──
  getUserGrowthTrend(days: number = 90, partnerId?: string): TrendPoint[] {
    let sql = `
      SELECT strftime('%Y-%m-%d', created_at) as period,
        COUNT(*) as users
      FROM users WHERE created_at >= datetime('now', '-' || ? || ' days')
    `;
    const params: unknown[] = [days];
    if (partnerId) { sql += ' AND tenant_id = ?'; params.push(partnerId); }
    sql += ' GROUP BY period ORDER BY period ASC';

    return (this.db.prepare(sql).all(...params) as Array<{ period: string; users: number }>)
      .map(r => ({ period: r.period, users: r.users, volume: 0, transactions: 0, revenue: 0 }));
  }

  // ── Partner Rankings ──
  getPartnerRankings(sortBy: 'volume' | 'revenue' | 'growth' = 'volume', limit = 20): PartnerRanking[] {
    const rows = this.db.prepare(`
      SELECT f.tenant_id as partnerId,
        COALESCE(u.display_name, f.tenant_id) as partnerName,
        SUM(f.amount) as volume,
        SUM(f.net_fee) as revenue,
        COUNT(*) as transactions
      FROM fee_ledger f
      LEFT JOIN users u ON u.id = f.tenant_id
      WHERE f.tenant_id IS NOT NULL
      GROUP BY f.tenant_id
      ORDER BY ${sortBy === 'revenue' ? 'revenue' : 'volume'} DESC
      LIMIT ?
    `).all(limit) as PartnerRanking[];

    return rows.map(r => ({
      ...r,
      volume: Math.round((r.volume || 0) * 100) / 100,
      revenue: Math.round((r.revenue || 0) * 100) / 100,
      growthRate: 0, // computed separately
    }));
  }

  // ── Top/At-Risk Partners ──
  getAtRiskPartners(inactiveDays: number = 14): PartnerRanking[] {
    const rows = this.db.prepare(`
      SELECT f.tenant_id as partnerId,
        COALESCE(u.display_name, f.tenant_id) as partnerName,
        SUM(f.amount) as volume,
        SUM(f.net_fee) as revenue,
        COUNT(*) as transactions,
        MAX(f.created_at) as lastActivity
      FROM fee_ledger f
      LEFT JOIN users u ON u.id = f.tenant_id
      WHERE f.tenant_id IS NOT NULL
      GROUP BY f.tenant_id
      HAVING MAX(f.created_at) < datetime('now', '-' || ? || ' days')
      ORDER BY volume DESC
    `).all(inactiveDays) as Array<PartnerRanking & { lastActivity: string }>;

    return rows.map(r => ({
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      volume: Math.round((r.volume || 0) * 100) / 100,
      revenue: Math.round((r.revenue || 0) * 100) / 100,
      transactions: r.transactions,
      growthRate: -100,
    }));
  }

  // ── Sparkline data (last 14 data points) ──
  getSparkline(metric: 'volume' | 'revenue' | 'transactions' | 'users', partnerId?: string): number[] {
    if (metric === 'users') {
      let sql = `SELECT COUNT(*) as v FROM users WHERE created_at >= datetime('now', '-' || ? || ' days')
                 AND created_at < datetime('now', '-' || ? || ' days')`;
      const params = partnerId ? [partnerId] : [];
      const points: number[] = [];
      for (let i = 13; i >= 0; i--) {
        const row = this.db.prepare(
          partnerId
            ? `SELECT COUNT(*) as v FROM users WHERE created_at >= datetime('now', '-${i + 1} days') AND created_at < datetime('now', '-${i} days') AND tenant_id = ?`
            : `SELECT COUNT(*) as v FROM users WHERE created_at >= datetime('now', '-${i + 1} days') AND created_at < datetime('now', '-${i} days')`
        ).get(...(partnerId ? [partnerId] : [])) as { v: number };
        points.push(row.v);
      }
      return points;
    }

    const col = metric === 'volume' ? 'SUM(amount)' : metric === 'revenue' ? 'SUM(net_fee)' : 'COUNT(*)';
    const points: number[] = [];
    for (let i = 13; i >= 0; i--) {
      const row = this.db.prepare(
        partnerId
          ? `SELECT COALESCE(${col}, 0) as v FROM fee_ledger WHERE created_at >= datetime('now', '-${i + 1} days') AND created_at < datetime('now', '-${i} days') AND tenant_id = ?`
          : `SELECT COALESCE(${col}, 0) as v FROM fee_ledger WHERE created_at >= datetime('now', '-${i + 1} days') AND created_at < datetime('now', '-${i} days')`
      ).get(...(partnerId ? [partnerId] : [])) as { v: number };
      points.push(Math.round(row.v * 100) / 100);
    }
    return points;
  }

  // ── Private Helpers ──
  private calcGrowthRate(days: number, partnerId?: string): number {
    const tenantClause = partnerId ? 'AND tenant_id = ?' : '';
    const params = partnerId ? [days, partnerId, days * 2, days, partnerId] : [days, days * 2, days];

    const current = (this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as vol FROM fee_ledger
      WHERE created_at >= datetime('now', '-' || ? || ' days') ${tenantClause}
    `).get(...(partnerId ? [days, partnerId] : [days])) as { vol: number }).vol;

    const previous = (this.db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as vol FROM fee_ledger
      WHERE created_at >= datetime('now', '-' || ? || ' days')
        AND created_at < datetime('now', '-' || ? || ' days') ${tenantClause}
    `).get(...(partnerId ? [days * 2, days, partnerId] : [days * 2, days])) as { vol: number }).vol;

    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }
}
