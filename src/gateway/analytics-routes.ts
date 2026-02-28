// ═══════════════════════════════════════════════════════════════
// PromptPay :: Analytics Routes
// /super-analytics (owner) and /partner-admin/analytics (partner)
// Predictive Analytics & AI Insights Dashboard
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import type { MemoryStore } from '../memory/store.js';
import type { LoggerHandle } from '../core/types.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { ForecastEngine } from '../services/forecastEngine.js';
import { InsightEngine } from '../services/insightEngine.js';

export interface AnalyticsDependencies {
  memory: MemoryStore;
  logger: LoggerHandle;
}

export function createAnalyticsRoutes(deps: AnalyticsDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();
  const analytics = new AnalyticsService(db);
  const forecaster = new ForecastEngine();
  const insights = new InsightEngine(db);

  // Simple in-memory cache (2-minute TTL)
  const cache = new Map<string, { data: unknown; expires: number }>();
  function cached<T>(key: string, ttlMs: number, fn: () => T): T {
    const now = Date.now();
    const entry = cache.get(key);
    if (entry && entry.expires > now) return entry.data as T;
    const data = fn();
    cache.set(key, { data, expires: now + ttlMs });
    return data;
  }

  // ════════════════════════════════════════════════
  // SUPER ADMIN: /super-analytics/*
  // ════════════════════════════════════════════════

  router.get('/super-analytics/metrics',
    authenticate, requireRole('owner'),
    (_req: Request, res: Response) => {
      const data = cached('platform-metrics', 120_000, () => {
        const metrics = analytics.getPlatformMetrics();
        const sparklines = {
          volume: analytics.getSparkline('volume'),
          revenue: analytics.getSparkline('revenue'),
          transactions: analytics.getSparkline('transactions'),
          users: analytics.getSparkline('users'),
        };
        return { metrics, sparklines };
      });
      res.json(data);
    }
  );

  router.get('/super-analytics/trends',
    authenticate, requireRole('owner'),
    (req: Request, res: Response) => {
      const filters = {
        startDate: req.query.start as string,
        endDate: req.query.end as string,
        partnerId: req.query.partner as string,
        transactionType: req.query.type as string,
        currency: req.query.currency as string,
        aggregation: (req.query.agg || 'daily') as 'hourly' | 'daily' | 'weekly' | 'monthly',
      };
      const trends = analytics.getTransactionTrends(filters);
      const userGrowth = analytics.getUserGrowthTrend(90, filters.partnerId);
      res.json({ trends, userGrowth });
    }
  );

  router.get('/super-analytics/forecast',
    authenticate, requireRole('owner'),
    (req: Request, res: Response) => {
      const horizon = Math.min(90, parseInt(req.query.days as string) || 30);
      const metric = (req.query.metric as string) || 'volume';

      const trendData = analytics.getTransactionTrends({
        aggregation: 'daily',
        startDate: new Date(Date.now() - 90 * 86400000).toISOString(),
      });

      const series = trendData.map(t => ({
        period: t.period,
        value: metric === 'revenue' ? t.revenue : metric === 'transactions' ? t.transactions : t.volume,
      }));

      const forecast = forecaster.generateForecast(series, horizon);
      res.json(forecast);
    }
  );

  router.get('/super-analytics/insights',
    authenticate, requireRole('owner'),
    (_req: Request, res: Response) => {
      const data = cached('platform-insights', 300_000, () => {
        return {
          insights: insights.generateInsights(),
          summary: insights.generateSummaryText(),
        };
      });
      res.json(data);
    }
  );

  router.get('/super-analytics/cash-flow',
    authenticate, requireRole('owner'),
    (_req: Request, res: Response) => {
      const days = Math.min(90, parseInt(_req.query.days as string) || 30);

      // Historical inflow/outflow
      const inflow = analytics.getTransactionTrends({
        aggregation: 'daily',
        startDate: new Date(Date.now() - 90 * 86400000).toISOString(),
      });

      const inflowSeries = inflow.map(t => ({ period: t.period, value: t.volume }));
      const outflowSeries = inflow.map(t => ({ period: t.period, value: t.volume * 0.85 })); // estimated 85% outflow

      const inflowForecast = forecaster.generateForecast(inflowSeries, days);
      const outflowForecast = forecaster.generateForecast(outflowSeries, days);

      // Projected balance
      let balance = 0;
      const balanceProjection = inflowForecast.forecast.map((f, i) => {
        const outflow = outflowForecast.forecast[i]?.value || 0;
        balance += f.value - outflow;
        return { period: f.period, balance: Math.round(balance * 100) / 100, inflow: f.value, outflow };
      });

      const lowLiquidityWarning = balanceProjection.some(b => b.balance < 0);

      res.json({
        historical: inflow,
        inflowForecast: inflowForecast.forecast,
        outflowForecast: outflowForecast.forecast,
        balanceProjection,
        lowLiquidityWarning,
      });
    }
  );

  router.get('/super-analytics/partners',
    authenticate, requireRole('owner'),
    (req: Request, res: Response) => {
      const sortBy = (req.query.sort || 'volume') as 'volume' | 'revenue' | 'growth';
      const rankings = analytics.getPartnerRankings(sortBy);
      const atRisk = analytics.getAtRiskPartners();
      res.json({ rankings, atRisk });
    }
  );

  // ════════════════════════════════════════════════
  // PARTNER ADMIN: /partner-admin/analytics/*
  // ════════════════════════════════════════════════

  router.get('/partner-admin/analytics/metrics',
    authenticate, requireRole('owner', 'partner_admin'),
    (req: Request, res: Response) => {
      const partnerId = (req as any).auth?.tenantId;
      if (!partnerId && (req as any).auth?.role !== 'owner') {
        return res.status(403).json({ error: 'No partner context' });
      }
      const pid = partnerId || (req.query.partner as string);
      if (!pid) return res.status(400).json({ error: 'Partner ID required' });

      const metrics = analytics.getPartnerMetrics(pid);
      const sparklines = {
        volume: analytics.getSparkline('volume', pid),
        revenue: analytics.getSparkline('revenue', pid),
        transactions: analytics.getSparkline('transactions', pid),
        users: analytics.getSparkline('users', pid),
      };
      res.json({ metrics, sparklines });
    }
  );

  router.get('/partner-admin/analytics/trends',
    authenticate, requireRole('owner', 'partner_admin'),
    (req: Request, res: Response) => {
      const partnerId = (req as any).auth?.tenantId || (req.query.partner as string);
      if (!partnerId) return res.status(400).json({ error: 'Partner ID required' });

      const trends = analytics.getTransactionTrends({
        partnerId,
        aggregation: (req.query.agg || 'daily') as 'hourly' | 'daily' | 'weekly' | 'monthly',
        startDate: req.query.start as string,
        endDate: req.query.end as string,
      });
      const userGrowth = analytics.getUserGrowthTrend(90, partnerId);
      res.json({ trends, userGrowth });
    }
  );

  router.get('/partner-admin/analytics/forecast',
    authenticate, requireRole('owner', 'partner_admin'),
    (req: Request, res: Response) => {
      const partnerId = (req as any).auth?.tenantId || (req.query.partner as string);
      if (!partnerId) return res.status(400).json({ error: 'Partner ID required' });

      const horizon = Math.min(90, parseInt(req.query.days as string) || 30);
      const trendData = analytics.getTransactionTrends({
        partnerId,
        aggregation: 'daily',
        startDate: new Date(Date.now() - 90 * 86400000).toISOString(),
      });

      const series = trendData.map(t => ({ period: t.period, value: t.volume }));
      const forecast = forecaster.generateForecast(series, horizon);
      res.json(forecast);
    }
  );

  router.get('/partner-admin/analytics/insights',
    authenticate, requireRole('owner', 'partner_admin'),
    (req: Request, res: Response) => {
      const partnerId = (req as any).auth?.tenantId || (req.query.partner as string);
      if (!partnerId) return res.status(400).json({ error: 'Partner ID required' });

      res.json({
        insights: insights.generateInsights(partnerId),
        summary: insights.generateSummaryText(partnerId),
      });
    }
  );

  return router;
}
