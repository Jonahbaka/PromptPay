// ═══════════════════════════════════════════════════════════════
// Agent::Trading_Ops (Quant)
// Stock/crypto trades, portfolio mgmt, DCA, market signals, risk
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

// ── Helper: Alpaca API request ──

async function alpacaRequest(method: string, path: string, body?: unknown): Promise<unknown> {
  if (CONFIG.trading.provider === 'paper_only') {
    return { simulated: true, message: 'Paper trading mode — no live API calls' };
  }

  const url = `${CONFIG.trading.alpacaBaseUrl}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'APCA-API-KEY-ID': CONFIG.trading.alpacaApiKey,
      'APCA-API-SECRET-KEY': CONFIG.trading.alpacaSecretKey,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alpaca API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── Market Lookup ──

const MarketLookupInput = z.object({
  symbol: z.string().min(1),
  type: z.enum(['stock', 'crypto', 'etf']).default('stock'),
});

export const marketLookupTool: ToolDefinition = {
  name: 'market_lookup',
  description: 'Look up current market data for a stock, crypto, or ETF symbol. Returns price, change, and basic market data.',
  category: 'trading',
  inputSchema: MarketLookupInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = MarketLookupInput.parse(input);
    ctx.logger.info(`Market lookup: ${parsed.symbol} (${parsed.type})`);

    if (CONFIG.trading.provider === 'paper_only') {
      return {
        success: true,
        data: {
          symbol: parsed.symbol.toUpperCase(),
          type: parsed.type,
          price: null,
          note: 'Paper trading mode. Configure ALPACA_API_KEY for live market data.',
        },
      };
    }

    const data = await alpacaRequest('GET', `/v2/assets/${parsed.symbol}`);
    return { success: true, data };
  },
};

// ── Place Trade ──

const PlaceTradeInput = z.object({
  userId: z.string(),
  portfolioId: z.string(),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  type: z.enum(['market', 'limit']).default('market'),
  limitPrice: z.number().positive().optional(),
  paperTrade: z.boolean().optional(),
});

export const placeTradeTool: ToolDefinition = {
  name: 'place_trade',
  description: 'Place a buy or sell trade for stocks, crypto, or ETFs. Defaults to paper trading for safety.',
  category: 'trading',
  inputSchema: PlaceTradeInput,
  requiresApproval: true,
  riskLevel: 'critical',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = PlaceTradeInput.parse(input);
    const isPaper = parsed.paperTrade ?? CONFIG.trading.paperTradingDefault;
    ctx.logger.info(`Trade: ${parsed.side} ${parsed.quantity} ${parsed.symbol} (paper=${isPaper})`);

    const estimatedValue = parsed.quantity * (parsed.limitPrice || 0);
    if (parsed.limitPrice && estimatedValue > CONFIG.trading.maxTradeUsd) {
      return {
        success: false,
        data: null,
        error: `Estimated trade value $${estimatedValue} exceeds max trade limit of $${CONFIG.trading.maxTradeUsd}`,
      };
    }

    const db = getDb();
    const now = new Date().toISOString();
    const orderId = uuid();

    db.prepare(`
      INSERT INTO trading_orders (id, portfolio_id, symbol, side, order_type, quantity, price, status, paper_trade, filled_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    `).run(orderId, parsed.portfolioId, parsed.symbol.toUpperCase(), parsed.side, parsed.type, parsed.quantity, parsed.limitPrice ?? null, isPaper ? 'filled' : 'pending', isPaper ? 1 : 0, now);

    // For paper trades, simulate immediate fill and update positions
    if (isPaper) {
      const existing = db.prepare(
        'SELECT * FROM trading_positions WHERE portfolio_id = ? AND symbol = ?'
      ).get(parsed.portfolioId, parsed.symbol.toUpperCase()) as Record<string, unknown> | undefined;

      if (parsed.side === 'buy') {
        const fillPrice = parsed.limitPrice || 100; // Simulated price
        if (existing) {
          const oldQty = existing.quantity as number;
          const oldCost = existing.avg_cost_basis as number;
          const newQty = oldQty + parsed.quantity;
          const newCost = ((oldCost * oldQty) + (fillPrice * parsed.quantity)) / newQty;
          db.prepare('UPDATE trading_positions SET quantity = ?, avg_cost_basis = ?, current_price = ? WHERE id = ?')
            .run(newQty, newCost, fillPrice, existing.id);
        } else {
          db.prepare(`
            INSERT INTO trading_positions (id, portfolio_id, symbol, type, quantity, avg_cost_basis, current_price, unrealized_pnl, opened_at)
            VALUES (?, ?, ?, 'stock', ?, ?, ?, 0, ?)
          `).run(uuid(), parsed.portfolioId, parsed.symbol.toUpperCase(), parsed.quantity, fillPrice, fillPrice, now);
        }
      } else if (parsed.side === 'sell' && existing) {
        const newQty = (existing.quantity as number) - parsed.quantity;
        if (newQty <= 0) {
          db.prepare('DELETE FROM trading_positions WHERE id = ?').run(existing.id);
        } else {
          db.prepare('UPDATE trading_positions SET quantity = ? WHERE id = ?').run(newQty, existing.id);
        }
      }

      db.prepare("UPDATE trading_orders SET status = 'filled', filled_at = ? WHERE id = ?").run(now, orderId);
    }
    db.close();

    return {
      success: true,
      data: {
        orderId,
        symbol: parsed.symbol.toUpperCase(),
        side: parsed.side,
        quantity: parsed.quantity,
        type: parsed.type,
        status: isPaper ? 'filled' : 'pending',
        paperTrade: isPaper,
      },
    };
  },
};

// ── Portfolio Overview ──

const PortfolioInput = z.object({
  userId: z.string(),
  portfolioId: z.string().optional(),
});

export const portfolioOverviewTool: ToolDefinition = {
  name: 'portfolio_overview',
  description: 'Get an overview of a trading portfolio including all positions, cash balance, and total value.',
  category: 'trading',
  inputSchema: PortfolioInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = PortfolioInput.parse(input);
    ctx.logger.info(`Portfolio overview for user ${parsed.userId}`);

    const db = getDb();
    let portfolios;
    if (parsed.portfolioId) {
      portfolios = db.prepare('SELECT * FROM trading_portfolios WHERE id = ? AND user_id = ?').all(parsed.portfolioId, parsed.userId);
    } else {
      portfolios = db.prepare('SELECT * FROM trading_portfolios WHERE user_id = ?').all(parsed.userId);
    }

    const result = (portfolios as Array<Record<string, unknown>>).map(p => {
      const positions = db.prepare('SELECT * FROM trading_positions WHERE portfolio_id = ?').all(p.id as string);
      return { ...p, positions };
    });

    // If no portfolio exists, create a default paper portfolio
    if (result.length === 0) {
      const now = new Date().toISOString();
      const id = uuid();
      db.prepare(`
        INSERT INTO trading_portfolios (id, user_id, name, cash_balance, total_value, paper_mode, created_at, updated_at)
        VALUES (?, ?, 'Default Portfolio', 100000, 100000, 1, ?, ?)
      `).run(id, parsed.userId, now, now);
      db.close();
      return {
        success: true,
        data: {
          portfolios: [{
            id, name: 'Default Portfolio', cashBalance: 100000, totalValue: 100000,
            paperMode: true, positions: [],
          }],
          note: 'Created default paper trading portfolio with $100,000 virtual cash.',
        },
      };
    }
    db.close();

    return { success: true, data: { portfolios: result } };
  },
};

// ── Set DCA Schedule ──

const DCAInput = z.object({
  userId: z.string(),
  portfolioId: z.string(),
  symbol: z.string().min(1),
  amountUsd: z.number().positive(),
  frequencyHours: z.number().min(CONFIG.trading.dcaMinIntervalHours),
});

export const setDcaScheduleTool: ToolDefinition = {
  name: 'set_dca_schedule',
  description: 'Set up a Dollar-Cost Averaging (DCA) schedule to automatically buy an asset at regular intervals.',
  category: 'trading',
  inputSchema: DCAInput,
  requiresApproval: true,
  riskLevel: 'high',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = DCAInput.parse(input);
    ctx.logger.info(`DCA schedule: ${parsed.symbol} $${parsed.amountUsd} every ${parsed.frequencyHours}h`);

    const db = getDb();
    const now = new Date().toISOString();
    const id = uuid();
    const nextExecution = new Date(Date.now() + parsed.frequencyHours * 3600000).toISOString();

    db.prepare(`
      INSERT INTO trading_dca_schedules (id, user_id, portfolio_id, symbol, amount_usd, frequency_hours, next_execution, status, executions_count, total_invested, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, ?)
    `).run(id, parsed.userId, parsed.portfolioId, parsed.symbol.toUpperCase(), parsed.amountUsd, parsed.frequencyHours, nextExecution, now);
    db.close();

    return {
      success: true,
      data: {
        scheduleId: id,
        symbol: parsed.symbol.toUpperCase(),
        amountUsd: parsed.amountUsd,
        frequencyHours: parsed.frequencyHours,
        nextExecution,
      },
    };
  },
};

// ── Risk Assessment ──

const RiskInput = z.object({
  userId: z.string(),
  portfolioId: z.string().optional(),
});

export const riskAssessmentTool: ToolDefinition = {
  name: 'risk_assessment',
  description: 'Assess the risk profile of a portfolio based on diversification, concentration, and asset types.',
  category: 'trading',
  inputSchema: RiskInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = RiskInput.parse(input);
    ctx.logger.info(`Risk assessment for user ${parsed.userId}`);

    const db = getDb();
    const positions = db.prepare(`
      SELECT tp.* FROM trading_positions tp
      JOIN trading_portfolios tpf ON tp.portfolio_id = tpf.id
      WHERE tpf.user_id = ? ${parsed.portfolioId ? 'AND tpf.id = ?' : ''}
    `).all(...(parsed.portfolioId ? [parsed.userId, parsed.portfolioId] : [parsed.userId])) as Array<Record<string, unknown>>;
    db.close();

    if (positions.length === 0) {
      return { success: true, data: { riskLevel: 'none', message: 'No positions to assess.' } };
    }

    const totalValue = positions.reduce((s, p) => s + (p.quantity as number) * ((p.current_price as number) || (p.avg_cost_basis as number)), 0);
    const concentrations = positions.map(p => ({
      symbol: p.symbol,
      value: (p.quantity as number) * ((p.current_price as number) || (p.avg_cost_basis as number)),
      percent: totalValue > 0 ? Math.round(((p.quantity as number) * ((p.current_price as number) || (p.avg_cost_basis as number)) / totalValue) * 100) : 0,
    }));

    const maxConcentration = Math.max(...concentrations.map(c => c.percent));
    const diversificationScore = positions.length >= 10 ? 'good' : positions.length >= 5 ? 'moderate' : 'low';
    const riskLevel = maxConcentration > 50 ? 'high' : maxConcentration > 30 ? 'medium' : 'low';

    return {
      success: true,
      data: {
        riskLevel,
        diversificationScore,
        positionCount: positions.length,
        topConcentrations: concentrations.sort((a, b) => b.percent - a.percent).slice(0, 5),
        warnings: maxConcentration > 30 ? [`${concentrations[0]?.symbol} is ${maxConcentration}% of portfolio — consider diversifying.`] : [],
      },
    };
  },
};

// ── Market Signals ──

const SignalsInput = z.object({
  symbols: z.array(z.string()).optional(),
  watchlistUserId: z.string().optional(),
});

export const marketSignalsTool: ToolDefinition = {
  name: 'market_signals',
  description: 'Get market signals and trends for specified symbols or watchlist. Includes basic technical indicators.',
  category: 'trading',
  inputSchema: SignalsInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = SignalsInput.parse(input);
    ctx.logger.info(`Market signals request`);

    let symbols = parsed.symbols || [];
    if (parsed.watchlistUserId && symbols.length === 0) {
      const db = getDb();
      const watchlist = db.prepare('SELECT symbol FROM trading_watchlist WHERE user_id = ?')
        .all(parsed.watchlistUserId) as Array<{ symbol: string }>;
      symbols = watchlist.map(w => w.symbol);
      db.close();
    }

    return {
      success: true,
      data: {
        symbols,
        signals: [],
        note: 'Market signal analysis requires live market data. Configure trading provider for real-time signals.',
      },
    };
  },
};

// ── Paper Trade ──

const PaperTradeInput = z.object({
  userId: z.string(),
  portfolioId: z.string(),
  symbol: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  quantity: z.number().positive(),
  simulatedPrice: z.number().positive(),
});

export const paperTradeTool: ToolDefinition = {
  name: 'paper_trade',
  description: 'Execute a simulated paper trade with a specified price. No real money is involved.',
  category: 'trading',
  inputSchema: PaperTradeInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = PaperTradeInput.parse(input);
    ctx.logger.info(`Paper trade: ${parsed.side} ${parsed.quantity} ${parsed.symbol} @ $${parsed.simulatedPrice}`);

    // Delegate to place_trade with paperTrade=true
    return placeTradeTool.execute({
      userId: parsed.userId,
      portfolioId: parsed.portfolioId,
      symbol: parsed.symbol,
      side: parsed.side,
      quantity: parsed.quantity,
      type: 'limit',
      limitPrice: parsed.simulatedPrice,
      paperTrade: true,
    }, ctx);
  },
};

// ── Trading History ──

const HistoryInput = z.object({
  userId: z.string(),
  portfolioId: z.string().optional(),
  limit: z.number().default(20),
});

export const tradingHistoryTool: ToolDefinition = {
  name: 'trading_history',
  description: 'View trading order history including filled, pending, and cancelled orders.',
  category: 'trading',
  inputSchema: HistoryInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = HistoryInput.parse(input);
    ctx.logger.info(`Trading history for user ${parsed.userId}`);

    const db = getDb();
    let orders;
    if (parsed.portfolioId) {
      orders = db.prepare(
        'SELECT * FROM trading_orders WHERE portfolio_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(parsed.portfolioId, parsed.limit);
    } else {
      orders = db.prepare(`
        SELECT o.* FROM trading_orders o
        JOIN trading_portfolios p ON o.portfolio_id = p.id
        WHERE p.user_id = ?
        ORDER BY o.created_at DESC LIMIT ?
      `).all(parsed.userId, parsed.limit);
    }
    db.close();

    return { success: true, data: { orders } };
  },
};

// ── Set Stop Loss ──

const StopLossInput = z.object({
  userId: z.string(),
  portfolioId: z.string(),
  symbol: z.string().min(1),
  stopPrice: z.number().positive(),
  quantity: z.number().positive().optional(),
});

export const setStopLossTool: ToolDefinition = {
  name: 'set_stop_loss',
  description: 'Set a stop-loss order to automatically sell if a position drops below a specified price.',
  category: 'trading',
  inputSchema: StopLossInput,
  requiresApproval: true,
  riskLevel: 'high',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = StopLossInput.parse(input);
    ctx.logger.info(`Stop loss: ${parsed.symbol} @ $${parsed.stopPrice}`);

    const db = getDb();
    const position = db.prepare(
      'SELECT * FROM trading_positions WHERE portfolio_id = ? AND symbol = ?'
    ).get(parsed.portfolioId, parsed.symbol.toUpperCase()) as Record<string, unknown> | undefined;

    if (!position) {
      db.close();
      return { success: false, data: null, error: `No position found for ${parsed.symbol}` };
    }

    const qty = parsed.quantity || (position.quantity as number);
    const now = new Date().toISOString();
    const orderId = uuid();

    db.prepare(`
      INSERT INTO trading_orders (id, portfolio_id, symbol, side, order_type, quantity, price, status, paper_trade, filled_at, created_at)
      VALUES (?, ?, ?, 'sell', 'stop_loss', ?, ?, 'pending', ?, NULL, ?)
    `).run(orderId, parsed.portfolioId, parsed.symbol.toUpperCase(), qty, parsed.stopPrice,
      CONFIG.trading.paperTradingDefault ? 1 : 0, now);
    db.close();

    return {
      success: true,
      data: {
        orderId,
        symbol: parsed.symbol.toUpperCase(),
        stopPrice: parsed.stopPrice,
        quantity: qty,
        status: 'pending',
      },
    };
  },
};

// ── Rebalance Portfolio ──

const RebalanceInput = z.object({
  userId: z.string(),
  portfolioId: z.string(),
  targetAllocations: z.array(z.object({
    symbol: z.string(),
    targetPercent: z.number().min(0).max(100),
  })),
});

export const rebalancePortfolioTool: ToolDefinition = {
  name: 'rebalance_portfolio',
  description: 'Calculate and execute trades to rebalance a portfolio to target allocations. Requires approval.',
  category: 'trading',
  inputSchema: RebalanceInput,
  requiresApproval: true,
  riskLevel: 'critical',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = RebalanceInput.parse(input);
    ctx.logger.info(`Rebalancing portfolio ${parsed.portfolioId}`);

    const totalPercent = parsed.targetAllocations.reduce((s, a) => s + a.targetPercent, 0);
    if (Math.abs(totalPercent - 100) > 1) {
      return { success: false, data: null, error: `Target allocations sum to ${totalPercent}%, must be ~100%` };
    }

    const db = getDb();
    const portfolio = db.prepare('SELECT * FROM trading_portfolios WHERE id = ? AND user_id = ?')
      .get(parsed.portfolioId, parsed.userId) as Record<string, unknown> | undefined;

    if (!portfolio) {
      db.close();
      return { success: false, data: null, error: 'Portfolio not found' };
    }

    const positions = db.prepare('SELECT * FROM trading_positions WHERE portfolio_id = ?')
      .all(parsed.portfolioId) as Array<Record<string, unknown>>;

    const totalValue = (portfolio.cash_balance as number) +
      positions.reduce((s, p) => s + (p.quantity as number) * ((p.current_price as number) || (p.avg_cost_basis as number)), 0);

    const trades = parsed.targetAllocations.map(alloc => {
      const currentPos = positions.find(p => p.symbol === alloc.symbol.toUpperCase());
      const currentValue = currentPos
        ? (currentPos.quantity as number) * ((currentPos.current_price as number) || (currentPos.avg_cost_basis as number))
        : 0;
      const targetValue = totalValue * (alloc.targetPercent / 100);
      const diff = targetValue - currentValue;
      return {
        symbol: alloc.symbol.toUpperCase(),
        currentPercent: totalValue > 0 ? Math.round((currentValue / totalValue) * 100) : 0,
        targetPercent: alloc.targetPercent,
        action: diff > 10 ? 'buy' : diff < -10 ? 'sell' : 'hold',
        tradeValueUsd: Math.abs(+diff.toFixed(2)),
      };
    });
    db.close();

    return {
      success: true,
      data: {
        portfolioId: parsed.portfolioId,
        totalValue,
        proposedTrades: trades.filter(t => t.action !== 'hold'),
        noAction: trades.filter(t => t.action === 'hold'),
        note: 'Review proposed trades. Execute individually or approve batch.',
      },
    };
  },
};

export const tradingTools: ToolDefinition[] = [
  marketLookupTool,
  placeTradeTool,
  portfolioOverviewTool,
  setDcaScheduleTool,
  riskAssessmentTool,
  marketSignalsTool,
  paperTradeTool,
  tradingHistoryTool,
  setStopLossTool,
  rebalancePortfolioTool,
];
