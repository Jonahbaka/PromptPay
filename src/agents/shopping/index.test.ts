// ═══════════════════════════════════════════════════════════════
// Tests :: Agent::Shopping_Ops (Aria)
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createMockContext, createMockLogger } from '../../test-utils/mocks.js';
import type { ExecutionContext } from '../../core/types.js';

// Mock CONFIG to use in-memory DB
vi.mock('../../core/config.js', () => ({
  CONFIG: {
    database: { path: ':memory:' },
    shopping: {
      enabled: true,
      maxBudgetUsd: 10000,
      priceComparisonProvider: 'internal',
      priceComparisonApiKey: '',
    },
  },
}));

// We need to initialize the schema in our in-memory DB
function initTestDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS shopping_lists (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
      status TEXT DEFAULT 'active', total_estimated REAL DEFAULT 0,
      total_actual REAL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shopping_items (
      id TEXT PRIMARY KEY, list_id TEXT NOT NULL, name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1, unit TEXT DEFAULT 'each',
      estimated_price REAL, actual_price REAL, purchased INTEGER DEFAULT 0,
      store TEXT, notes TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shopping_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, list_id TEXT,
      store TEXT NOT NULL, total_amount REAL NOT NULL, currency TEXT DEFAULT 'usd',
      status TEXT DEFAULT 'pending', tracking_number TEXT, estimated_delivery TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
}

describe('Shopping Agent (Aria)', () => {
  let ctx: ExecutionContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('createShoppingListTool', () => {
    it('should export 8 tools', async () => {
      const { shoppingTools } = await import('./index.js');
      expect(shoppingTools).toHaveLength(8);
    });

    it('should have correct tool names', async () => {
      const { shoppingTools } = await import('./index.js');
      const names = shoppingTools.map(t => t.name);
      expect(names).toContain('create_shopping_list');
      expect(names).toContain('add_to_list');
      expect(names).toContain('find_best_price');
      expect(names).toContain('place_order');
      expect(names).toContain('track_order');
      expect(names).toContain('reorder_items');
      expect(names).toContain('compare_prices');
      expect(names).toContain('smart_recommendations');
    });

    it('place_order should be critical risk and require approval', async () => {
      const { shoppingTools } = await import('./index.js');
      const placeOrder = shoppingTools.find(t => t.name === 'place_order');
      expect(placeOrder?.riskLevel).toBe('critical');
      expect(placeOrder?.requiresApproval).toBe(true);
    });

    it('all tools should have shopping category', async () => {
      const { shoppingTools } = await import('./index.js');
      for (const tool of shoppingTools) {
        expect(tool.category).toBe('shopping');
      }
    });

    it('find_best_price should return simulated results', async () => {
      const { findBestPriceTool } = await import('./index.js');
      const result = await findBestPriceTool.execute({ productName: 'Milk', maxResults: 3 }, ctx);
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('product', 'Milk');
    });

    it('compare_prices should accept array of items', async () => {
      const { comparePricesTool } = await import('./index.js');
      const result = await comparePricesTool.execute({ items: ['Bread', 'Butter', 'Eggs'] }, ctx);
      expect(result.success).toBe(true);
      expect((result.data as Record<string, unknown>).items).toHaveLength(3);
    });
  });
});
