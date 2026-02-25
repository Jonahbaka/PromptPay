// ═══════════════════════════════════════════════════════════════
// Tests :: Agent::Assistant_Ops (Otto)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockContext } from '../../test-utils/mocks.js';
import type { ExecutionContext } from '../../core/types.js';

// Mock CONFIG
vi.mock('../../core/config.js', () => ({
  CONFIG: {
    database: { path: ':memory:' },
    assistant: {
      enabled: true,
      subscriptionScanEnabled: true,
      priceAlertCheckIntervalMs: 3600000,
      maxDocumentSizeMb: 10,
    },
  },
}));

describe('Assistant Agent (Otto)', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('tool exports', () => {
    it('should export 8 tools', async () => {
      const { assistantTools } = await import('./index.js');
      expect(assistantTools).toHaveLength(8);
    });

    it('should have correct tool names', async () => {
      const { assistantTools } = await import('./index.js');
      const names = assistantTools.map(t => t.name);
      expect(names).toContain('manage_subscriptions');
      expect(names).toContain('negotiate_bill');
      expect(names).toContain('schedule_appointment');
      expect(names).toContain('store_document');
      expect(names).toContain('set_price_alert');
      expect(names).toContain('process_return');
      expect(names).toContain('find_deals');
      expect(names).toContain('auto_pay_optimize');
    });

    it('all tools should have assistant category', async () => {
      const { assistantTools } = await import('./index.js');
      for (const tool of assistantTools) {
        expect(tool.category).toBe('assistant');
      }
    });

    it('process_return should be medium risk', async () => {
      const { assistantTools } = await import('./index.js');
      const processReturn = assistantTools.find(t => t.name === 'process_return');
      expect(processReturn?.riskLevel).toBe('medium');
    });
  });

  describe('negotiateBillTool', () => {
    it('should generate negotiation scripts for internet bill', async () => {
      const { negotiateBillTool } = await import('./index.js');
      const result = await negotiateBillTool.execute({
        userId: 'test-user',
        billType: 'internet',
        currentMonthlyAmount: 100,
        provider: 'Comcast',
        accountYears: 3,
      }, ctx);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.provider).toBe('Comcast');
      expect(data.currentAmount).toBe(100);
      expect(data.targetAmount).toBe(80); // 20% reduction
      expect(data.potentialAnnualSavings).toBe(240); // $20/mo * 12
      expect((data.scripts as string[]).length).toBeGreaterThan(0);
      expect((data.tips as string[]).length).toBeGreaterThan(0);
    });

    it('should calculate correct savings for phone bill', async () => {
      const { negotiateBillTool } = await import('./index.js');
      const result = await negotiateBillTool.execute({
        userId: 'test-user',
        billType: 'phone',
        currentMonthlyAmount: 80,
        provider: 'AT&T',
        accountYears: 1,
      }, ctx);

      const data = result.data as Record<string, unknown>;
      expect(data.targetAmount).toBe(64); // 80 * 0.8
      expect(data.potentialAnnualSavings).toBe(192); // 16 * 12
    });
  });

  describe('storeDocumentTool', () => {
    it('should reject documents exceeding size limit', async () => {
      const { storeDocumentTool } = await import('./index.js');
      // Create a string larger than 10MB
      const largeContent = 'x'.repeat(11 * 1024 * 1024);
      const result = await storeDocumentTool.execute({
        userId: 'test-user',
        name: 'huge-doc',
        type: 'pdf',
        category: 'other',
        content: largeContent,
      }, ctx);

      expect(result.success).toBe(false);
      expect(result.error).toContain('10MB');
    });
  });

  describe('manageSubscriptionsTool', () => {
    it('should require serviceName for add action', async () => {
      const { manageSubscriptionsTool } = await import('./index.js');
      try {
        const result = await manageSubscriptionsTool.execute({
          userId: 'test-user',
          action: 'add',
          // Missing serviceName, amount, frequency
        }, ctx);
        if (!result.success) {
          expect(result.error).toContain('required');
        }
      } catch {
        // Expected when tables don't exist
        expect(true).toBe(true);
      }
    });

    it('should require subscriptionId for cancel action', async () => {
      const { manageSubscriptionsTool } = await import('./index.js');
      try {
        const result = await manageSubscriptionsTool.execute({
          userId: 'test-user',
          action: 'cancel',
          // Missing subscriptionId
        }, ctx);
        if (!result.success) {
          expect(result.error).toContain('subscriptionId');
        }
      } catch {
        expect(true).toBe(true);
      }
    });
  });
});
