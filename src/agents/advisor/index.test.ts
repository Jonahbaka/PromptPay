// ═══════════════════════════════════════════════════════════════
// Tests :: Agent::Advisor_Ops (Sage)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createMockContext, createMockLogger } from '../../test-utils/mocks.js';
import type { ExecutionContext } from '../../core/types.js';

// Mock CONFIG
vi.mock('../../core/config.js', () => ({
  CONFIG: {
    database: { path: ':memory:' },
    advisor: {
      enabled: true,
      budgetAlertThresholdPercent: 80,
      insightFrequency: 'weekly',
    },
  },
}));

describe('Advisor Agent (Sage)', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('tool exports', () => {
    it('should export 8 tools', async () => {
      const { advisorTools } = await import('./index.js');
      expect(advisorTools).toHaveLength(8);
    });

    it('should have correct tool names', async () => {
      const { advisorTools } = await import('./index.js');
      const names = advisorTools.map(t => t.name);
      expect(names).toContain('create_budget');
      expect(names).toContain('analyze_spending');
      expect(names).toContain('debt_strategy');
      expect(names).toContain('savings_advice');
      expect(names).toContain('tax_tips');
      expect(names).toContain('net_worth_snapshot');
      expect(names).toContain('financial_health_score');
      expect(names).toContain('goal_planning');
    });

    it('all tools should have advisory category', async () => {
      const { advisorTools } = await import('./index.js');
      for (const tool of advisorTools) {
        expect(tool.category).toBe('advisory');
      }
    });

    it('no tools should require approval (pure computation)', async () => {
      const { advisorTools } = await import('./index.js');
      for (const tool of advisorTools) {
        expect(tool.requiresApproval).toBe(false);
      }
    });
  });

  describe('debtStrategyTool', () => {
    it('should calculate avalanche strategy correctly', async () => {
      const { debtStrategyTool } = await import('./index.js');
      const result = await debtStrategyTool.execute({
        userId: 'test-user',
        debts: [
          { name: 'Credit Card', balance: 5000, interestRate: 20, minimumPayment: 100 },
          { name: 'Car Loan', balance: 10000, interestRate: 5, minimumPayment: 200 },
        ],
        monthlyBudget: 500,
        strategy: 'avalanche',
      }, ctx);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.strategy).toBe('avalanche');
      expect((data.payoffOrder as string[])[0]).toBe('Credit Card'); // highest interest first
      expect(data.totalDebt).toBe(15000);
    });

    it('should calculate snowball strategy correctly', async () => {
      const { debtStrategyTool } = await import('./index.js');
      const result = await debtStrategyTool.execute({
        userId: 'test-user',
        debts: [
          { name: 'Credit Card', balance: 5000, interestRate: 20, minimumPayment: 100 },
          { name: 'Car Loan', balance: 10000, interestRate: 5, minimumPayment: 200 },
        ],
        monthlyBudget: 500,
        strategy: 'snowball',
      }, ctx);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.strategy).toBe('snowball');
      expect((data.payoffOrder as string[])[0]).toBe('Credit Card'); // smallest balance first
    });
  });

  describe('taxTipsTool', () => {
    it('should return general tips', async () => {
      const { taxTipsTool } = await import('./index.js');
      const result = await taxTipsTool.execute({
        userId: 'test-user',
        filingStatus: 'single',
      }, ctx);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.filingStatus).toBe('single');
      expect((data.tips as string[]).length).toBeGreaterThan(0);
      expect(data.disclaimer).toContain('tax professional');
    });

    it('should add high-income tips for income > 100k', async () => {
      const { taxTipsTool } = await import('./index.js');
      const result = await taxTipsTool.execute({
        userId: 'test-user',
        filingStatus: 'married_joint',
        annualIncome: 150000,
      }, ctx);

      const data = result.data as Record<string, unknown>;
      const tips = data.tips as string[];
      expect(tips.some(t => t.includes('backdoor Roth'))).toBe(true);
    });
  });
});
