// ═══════════════════════════════════════════════════════════════
// PromptPay :: Spending Insights Engine
// Weekly spending summaries, category breakdowns, trend analysis
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';

export interface InsightData {
  totalSpent: number;
  totalIncome: number;
  savingsRate: number;
  categoryBreakdown: Record<string, number>;
  topMerchants: Array<{ name: string; amount: number; count: number }>;
  vsLastPeriod: { spentChange: number; savingsChange: number };
  tips: string[];
}

export class InsightsEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Generate weekly spending insights for a user */
  generateWeeklyInsight(userId: string): InsightData {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

    // Current period spending from execution log
    const currentSpending = this.getSpendingInPeriod(userId, weekAgo, now);
    const previousSpending = this.getSpendingInPeriod(userId, twoWeeksAgo, weekAgo);

    // Current period income
    const currentIncome = this.getIncomeInPeriod(userId, weekAgo, now);
    const previousIncome = this.getIncomeInPeriod(userId, twoWeeksAgo, weekAgo);

    const savingsRate = currentIncome > 0 ? ((currentIncome - currentSpending.total) / currentIncome) * 100 : 0;
    const prevSavingsRate = previousIncome > 0 ? ((previousIncome - previousSpending.total) / previousIncome) * 100 : 0;

    const insight: InsightData = {
      totalSpent: currentSpending.total,
      totalIncome: currentIncome,
      savingsRate: Math.round(savingsRate * 100) / 100,
      categoryBreakdown: currentSpending.categories,
      topMerchants: currentSpending.merchants.slice(0, 5),
      vsLastPeriod: {
        spentChange: previousSpending.total > 0
          ? Math.round(((currentSpending.total - previousSpending.total) / previousSpending.total) * 10000) / 100
          : 0,
        savingsChange: Math.round((savingsRate - prevSavingsRate) * 100) / 100,
      },
      tips: this.generateTips(currentSpending, savingsRate),
    };

    // Store the insight
    const vsPercent = previousSpending.total > 0
      ? ((currentSpending.total - previousSpending.total) / previousSpending.total) * 100
      : 0;

    this.db.prepare(`
      INSERT INTO spending_insights (id, user_id, period_type, period_start, period_end, total_spent, total_earned, category_breakdown, top_merchants, savings_rate, compared_to_previous, created_at)
      VALUES (?, ?, 'weekly', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), userId, weekAgo.toISOString(), now.toISOString(), insight.totalSpent, insight.totalIncome, JSON.stringify(insight.categoryBreakdown), JSON.stringify(insight.topMerchants), insight.savingsRate, vsPercent, now.toISOString());

    this.logger.info(`[Insights] Generated weekly insight for ${userId}: $${insight.totalSpent} spent`);
    return insight;
  }

  private getSpendingInPeriod(userId: string, start: Date, end: Date): {
    total: number; categories: Record<string, number>;
    merchants: Array<{ name: string; amount: number; count: number }>;
  } {
    // Pull from execution log for payment-related actions
    const rows = this.db.prepare(`
      SELECT action, result FROM execution_log
      WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ? AND success = 1
        AND (action LIKE '%payment%' OR action LIKE '%transfer%' OR action LIKE '%send%')
    `).all(userId, start.toISOString(), end.toISOString()) as Array<{ action: string; result: string }>;

    let total = 0;
    const categories: Record<string, number> = {};
    const merchantMap: Record<string, { amount: number; count: number }> = {};

    for (const row of rows) {
      try {
        const data = JSON.parse(row.result || '{}');
        const amount = data.amount || data.totalAmount || 0;
        const category = data.category || 'uncategorized';
        const merchant = data.merchant || data.recipient || 'unknown';

        total += amount;
        categories[category] = (categories[category] || 0) + amount;

        if (!merchantMap[merchant]) merchantMap[merchant] = { amount: 0, count: 0 };
        merchantMap[merchant].amount += amount;
        merchantMap[merchant].count++;
      } catch {
        // Skip unparseable results
      }
    }

    const merchants = Object.entries(merchantMap)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount);

    return { total, categories, merchants };
  }

  private getIncomeInPeriod(userId: string, start: Date, end: Date): number {
    const rows = this.db.prepare(`
      SELECT result FROM execution_log
      WHERE agent_id = ? AND timestamp >= ? AND timestamp <= ? AND success = 1
        AND (action LIKE '%deposit%' OR action LIKE '%topup%' OR action LIKE '%receive%')
    `).all(userId, start.toISOString(), end.toISOString()) as Array<{ result: string }>;

    let total = 0;
    for (const row of rows) {
      try {
        const data = JSON.parse(row.result || '{}');
        total += data.amount || 0;
      } catch {
        // Skip
      }
    }
    return total;
  }

  private generateTips(spending: { total: number; categories: Record<string, number> }, savingsRate: number): string[] {
    const tips: string[] = [];

    if (savingsRate < 10) {
      tips.push('Your savings rate is below 10%. Try enabling round-up savings to automatically save spare change.');
    } else if (savingsRate > 30) {
      tips.push('Great savings rate! Consider setting up a new savings goal to put your surplus to work.');
    }

    // Find highest spending category
    const topCategory = Object.entries(spending.categories).sort((a, b) => b[1] - a[1])[0];
    if (topCategory && topCategory[1] > spending.total * 0.5) {
      tips.push(`${topCategory[0]} accounts for over 50% of your spending. Look for cashback opportunities in this category.`);
    }

    if (tips.length === 0) {
      tips.push('Keep up the good financial habits! Check your achievements to see what milestones are coming up.');
    }

    return tips;
  }

  /** Get the latest insight for a user */
  getLatestInsight(userId: string): InsightData | null {
    const row = this.db.prepare(
      'SELECT * FROM spending_insights WHERE user_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(userId) as {
      total_spent: number; total_earned: number; savings_rate: number;
      category_breakdown: string; top_merchants: string; compared_to_previous: number;
    } | undefined;

    if (!row) return null;
    return {
      totalSpent: row.total_spent,
      totalIncome: row.total_earned,
      savingsRate: row.savings_rate,
      categoryBreakdown: JSON.parse(row.category_breakdown || '{}'),
      topMerchants: JSON.parse(row.top_merchants || '[]'),
      vsLastPeriod: { spentChange: row.compared_to_previous, savingsChange: 0 },
      tips: [],
    };
  }

  /** Get global insights stats */
  getStats(): { totalInsightsGenerated: number; usersWithInsights: number; avgSavingsRate: number } {
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM spending_insights').get() as { c: number }).c;
    const users = (this.db.prepare('SELECT COUNT(DISTINCT user_id) as c FROM spending_insights').get() as { c: number }).c;

    const avg = this.db.prepare(`
      SELECT AVG(savings_rate) as avg_rate FROM (
        SELECT savings_rate FROM spending_insights si
        WHERE created_at = (SELECT MAX(created_at) FROM spending_insights WHERE user_id = si.user_id)
      )
    `).get() as { avg_rate: number | null };

    return {
      totalInsightsGenerated: total,
      usersWithInsights: users,
      avgSavingsRate: Math.round((avg.avg_rate || 0) * 100) / 100,
    };
  }
}
