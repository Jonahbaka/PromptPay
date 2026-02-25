// ═══════════════════════════════════════════════════════════════
// Agent::Shopping_Ops (Aria)
// Shopping lists, price comparison, autonomous purchasing, tracking
// ═══════════════════════════════════════════════════════════════

import { ToolDefinition, ToolResult, ExecutionContext } from '../../core/types.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import { CONFIG } from '../../core/config.js';

// ── Helper: get DB ──

function getDb(): Database.Database {
  return new Database(CONFIG.database.path);
}

// ── Create Shopping List ──

const CreateListInput = z.object({
  userId: z.string(),
  name: z.string().min(1),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().positive().default(1),
    unit: z.string().default('each'),
    estimatedPrice: z.number().optional(),
  })).optional().default([]),
});

export const createShoppingListTool: ToolDefinition = {
  name: 'create_shopping_list',
  description: 'Create a new shopping list with optional initial items. Supports grocery, household, and custom lists.',
  category: 'shopping',
  inputSchema: CreateListInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = CreateListInput.parse(input);
    ctx.logger.info(`Creating shopping list: ${parsed.name} for user ${parsed.userId}`);

    const db = getDb();
    const now = new Date().toISOString();
    const listId = uuid();
    let totalEstimated = 0;

    db.prepare(`
      INSERT INTO shopping_lists (id, user_id, name, status, total_estimated, total_actual, created_at, updated_at)
      VALUES (?, ?, ?, 'active', 0, 0, ?, ?)
    `).run(listId, parsed.userId, parsed.name, now, now);

    const itemStmt = db.prepare(`
      INSERT INTO shopping_items (id, list_id, name, quantity, unit, estimated_price, actual_price, purchased, store, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0, NULL, NULL, ?)
    `);

    for (const item of parsed.items) {
      const est = item.estimatedPrice ?? null;
      if (est) totalEstimated += est * item.quantity;
      itemStmt.run(uuid(), listId, item.name, item.quantity, item.unit, est, now);
    }

    db.prepare('UPDATE shopping_lists SET total_estimated = ? WHERE id = ?').run(totalEstimated, listId);
    db.close();

    return {
      success: true,
      data: {
        listId,
        name: parsed.name,
        itemCount: parsed.items.length,
        totalEstimated,
      },
    };
  },
};

// ── Add to List ──

const AddToListInput = z.object({
  listId: z.string(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().positive().default(1),
    unit: z.string().default('each'),
    estimatedPrice: z.number().optional(),
    store: z.string().optional(),
    notes: z.string().optional(),
  })),
});

export const addToListTool: ToolDefinition = {
  name: 'add_to_list',
  description: 'Add items to an existing shopping list.',
  category: 'shopping',
  inputSchema: AddToListInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = AddToListInput.parse(input);
    ctx.logger.info(`Adding ${parsed.items.length} items to list ${parsed.listId}`);

    const db = getDb();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO shopping_items (id, list_id, name, quantity, unit, estimated_price, actual_price, purchased, store, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?)
    `);

    const addedIds: string[] = [];
    for (const item of parsed.items) {
      const id = uuid();
      stmt.run(id, parsed.listId, item.name, item.quantity, item.unit, item.estimatedPrice ?? null, item.store ?? null, item.notes ?? null, now);
      addedIds.push(id);
    }

    // Recalculate totals
    const total = db.prepare(
      'SELECT COALESCE(SUM(estimated_price * quantity), 0) as t FROM shopping_items WHERE list_id = ?'
    ).get(parsed.listId) as { t: number };
    db.prepare('UPDATE shopping_lists SET total_estimated = ?, updated_at = ? WHERE id = ?').run(total.t, now, parsed.listId);
    db.close();

    return {
      success: true,
      data: { addedIds, newTotal: total.t },
    };
  },
};

// ── Find Best Price ──

const FindPriceInput = z.object({
  productName: z.string(),
  maxResults: z.number().default(5),
});

export const findBestPriceTool: ToolDefinition = {
  name: 'find_best_price',
  description: 'Search for the best price on a product across available stores and comparison providers.',
  category: 'shopping',
  inputSchema: FindPriceInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = FindPriceInput.parse(input);
    ctx.logger.info(`Price search: ${parsed.productName}`);

    // Simulated price comparison — in production, integrates with price APIs
    return {
      success: true,
      data: {
        product: parsed.productName,
        results: [],
        provider: CONFIG.shopping.priceComparisonProvider,
        note: 'Price comparison API not yet configured. Set SHOPPING_PRICE_API_KEY to enable.',
      },
    };
  },
};

// ── Place Order ──

const PlaceOrderInput = z.object({
  userId: z.string(),
  listId: z.string().optional(),
  store: z.string(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().positive(),
    price: z.number().positive(),
  })),
  paymentMethodId: z.string().optional(),
});

export const placeOrderTool: ToolDefinition = {
  name: 'place_order',
  description: 'Place an order for items from a specific store. Requires explicit user confirmation.',
  category: 'shopping',
  inputSchema: PlaceOrderInput,
  requiresApproval: true,
  riskLevel: 'critical',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = PlaceOrderInput.parse(input);
    const totalAmount = parsed.items.reduce((sum, i) => sum + i.price * i.quantity, 0);
    ctx.logger.info(`Placing order: ${parsed.store} total=$${totalAmount} for user ${parsed.userId}`);

    if (totalAmount > CONFIG.shopping.maxBudgetUsd) {
      return {
        success: false,
        data: null,
        error: `Order total $${totalAmount} exceeds max budget of $${CONFIG.shopping.maxBudgetUsd}`,
      };
    }

    const db = getDb();
    const now = new Date().toISOString();
    const orderId = uuid();

    db.prepare(`
      INSERT INTO shopping_orders (id, user_id, list_id, store, total_amount, currency, status, tracking_number, estimated_delivery, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'usd', 'pending', NULL, NULL, ?, ?)
    `).run(orderId, parsed.userId, parsed.listId ?? null, parsed.store, totalAmount, now, now);
    db.close();

    return {
      success: true,
      data: {
        orderId,
        store: parsed.store,
        totalAmount,
        itemCount: parsed.items.length,
        status: 'pending',
      },
    };
  },
};

// ── Track Order ──

const TrackOrderInput = z.object({
  userId: z.string(),
  orderId: z.string().optional(),
});

export const trackOrderTool: ToolDefinition = {
  name: 'track_order',
  description: 'Track the status of shopping orders. Shows delivery status, tracking numbers, and estimated delivery dates.',
  category: 'shopping',
  inputSchema: TrackOrderInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = TrackOrderInput.parse(input);
    ctx.logger.info(`Tracking orders for user ${parsed.userId}`);

    const db = getDb();
    let orders;
    if (parsed.orderId) {
      orders = db.prepare('SELECT * FROM shopping_orders WHERE id = ? AND user_id = ?').all(parsed.orderId, parsed.userId);
    } else {
      orders = db.prepare("SELECT * FROM shopping_orders WHERE user_id = ? AND status != 'cancelled' ORDER BY created_at DESC LIMIT 10").all(parsed.userId);
    }
    db.close();

    return {
      success: true,
      data: { orders },
    };
  },
};

// ── Reorder Items ──

const ReorderInput = z.object({
  userId: z.string(),
  orderId: z.string(),
});

export const reorderItemsTool: ToolDefinition = {
  name: 'reorder_items',
  description: 'Reorder items from a previous order. Creates a new order with the same items and store.',
  category: 'shopping',
  inputSchema: ReorderInput,
  requiresApproval: true,
  riskLevel: 'high',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = ReorderInput.parse(input);
    ctx.logger.info(`Reorder from order ${parsed.orderId}`);

    const db = getDb();
    const original = db.prepare('SELECT * FROM shopping_orders WHERE id = ? AND user_id = ?')
      .get(parsed.orderId, parsed.userId) as Record<string, unknown> | undefined;

    if (!original) {
      db.close();
      return { success: false, data: null, error: 'Original order not found' };
    }

    const now = new Date().toISOString();
    const newOrderId = uuid();
    db.prepare(`
      INSERT INTO shopping_orders (id, user_id, list_id, store, total_amount, currency, status, tracking_number, estimated_delivery, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)
    `).run(newOrderId, parsed.userId, original.list_id, original.store, original.total_amount, original.currency, now, now);
    db.close();

    return {
      success: true,
      data: {
        newOrderId,
        store: original.store,
        totalAmount: original.total_amount,
        status: 'pending',
      },
    };
  },
};

// ── Compare Prices ──

const ComparePricesInput = z.object({
  items: z.array(z.string().min(1)),
});

export const comparePricesTool: ToolDefinition = {
  name: 'compare_prices',
  description: 'Compare prices across multiple stores for a list of items. Returns best deals per item.',
  category: 'shopping',
  inputSchema: ComparePricesInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = ComparePricesInput.parse(input);
    ctx.logger.info(`Comparing prices for ${parsed.items.length} items`);

    // Simulated — in production, hits multiple price APIs
    return {
      success: true,
      data: {
        items: parsed.items.map(name => ({
          name,
          comparisons: [],
          bestDeal: null,
        })),
        provider: CONFIG.shopping.priceComparisonProvider,
        note: 'Price comparison requires API configuration.',
      },
    };
  },
};

// ── Smart Recommendations ──

const RecommendInput = z.object({
  userId: z.string(),
  context: z.enum(['grocery', 'household', 'electronics', 'general']).default('general'),
});

export const smartRecommendationsTool: ToolDefinition = {
  name: 'smart_recommendations',
  description: 'Generate smart shopping recommendations based on purchase history, seasonal items, and frequently bought items.',
  category: 'shopping',
  inputSchema: RecommendInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = RecommendInput.parse(input);
    ctx.logger.info(`Generating recommendations for user ${parsed.userId}, context: ${parsed.context}`);

    const db = getDb();
    // Look at past shopping lists to find frequently purchased items
    const recentItems = db.prepare(`
      SELECT si.name, COUNT(*) as frequency
      FROM shopping_items si
      JOIN shopping_lists sl ON si.list_id = sl.id
      WHERE sl.user_id = ?
      GROUP BY si.name
      ORDER BY frequency DESC
      LIMIT 10
    `).all(parsed.userId) as Array<{ name: string; frequency: number }>;
    db.close();

    return {
      success: true,
      data: {
        frequentlyBought: recentItems,
        suggestions: recentItems.length > 0
          ? recentItems.map(i => `Consider restocking: ${i.name}`)
          : ['Start adding items to your shopping lists to get personalized recommendations.'],
        context: parsed.context,
      },
    };
  },
};

export const shoppingTools: ToolDefinition[] = [
  createShoppingListTool,
  addToListTool,
  findBestPriceTool,
  placeOrderTool,
  trackOrderTool,
  reorderItemsTool,
  comparePricesTool,
  smartRecommendationsTool,
];
