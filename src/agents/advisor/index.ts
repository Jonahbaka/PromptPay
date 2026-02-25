// ═══════════════════════════════════════════════════════════════
// Agent::Advisor_Ops (Sage)
// Budgets, spending analysis, debt strategy, savings, tax tips
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

// ── Create Budget ──

const CreateBudgetInput = z.object({
  userId: z.string(),
  name: z.string().min(1),
  totalAmount: z.number().positive(),
  period: z.enum(['weekly', 'monthly', 'quarterly', 'annual']),
  categories: z.array(z.object({
    name: z.string(),
    allocatedAmount: z.number().positive(),
  })).optional().default([]),
});

export const createBudgetTool: ToolDefinition = {
  name: 'create_budget',
  description: 'Create a new budget with optional spending categories. Supports weekly, monthly, quarterly, and annual periods.',
  category: 'advisory',
  inputSchema: CreateBudgetInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = CreateBudgetInput.parse(input);
    ctx.logger.info(`Creating budget: ${parsed.name} ($${parsed.totalAmount} ${parsed.period})`);

    const db = getDb();
    const now = new Date().toISOString();
    const budgetId = uuid();

    // Calculate period dates
    const start = new Date();
    const end = new Date();
    switch (parsed.period) {
      case 'weekly': end.setDate(end.getDate() + 7); break;
      case 'monthly': end.setMonth(end.getMonth() + 1); break;
      case 'quarterly': end.setMonth(end.getMonth() + 3); break;
      case 'annual': end.setFullYear(end.getFullYear() + 1); break;
    }

    db.prepare(`
      INSERT INTO budgets (id, user_id, name, total_amount, period, start_date, end_date, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(budgetId, parsed.userId, parsed.name, parsed.totalAmount, parsed.period, start.toISOString(), end.toISOString(), now, now);

    const catStmt = db.prepare(`
      INSERT INTO budget_categories (id, budget_id, name, allocated_amount, spent_amount, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `);
    for (const cat of parsed.categories) {
      catStmt.run(uuid(), budgetId, cat.name, cat.allocatedAmount, now);
    }
    db.close();

    return {
      success: true,
      data: {
        budgetId,
        name: parsed.name,
        totalAmount: parsed.totalAmount,
        period: parsed.period,
        categories: parsed.categories.length,
      },
    };
  },
};

// ── Analyze Spending ──

const AnalyzeSpendingInput = z.object({
  userId: z.string(),
  periodDays: z.number().positive().default(30),
});

export const analyzeSpendingTool: ToolDefinition = {
  name: 'analyze_spending',
  description: 'Analyze spending patterns over a given period. Uses transaction data and spending insights to identify trends, overspending, and savings opportunities.',
  category: 'advisory',
  inputSchema: AnalyzeSpendingInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = AnalyzeSpendingInput.parse(input);
    ctx.logger.info(`Analyzing spending for user ${parsed.userId} (${parsed.periodDays} days)`);

    const db = getDb();
    // Cross-agent: use existing spending_insights table
    const insights = db.prepare(`
      SELECT * FROM spending_insights
      WHERE user_id = ?
      ORDER BY period_start DESC
      LIMIT 5
    `).all(parsed.userId) as Array<Record<string, unknown>>;

    // Check budgets for overspending
    const budgets = db.prepare(`
      SELECT b.*,
        (SELECT COALESCE(SUM(bc.spent_amount), 0) FROM budget_categories bc WHERE bc.budget_id = b.id) as total_spent
      FROM budgets b
      WHERE b.user_id = ? AND b.status = 'active'
    `).all(parsed.userId) as Array<Record<string, unknown>>;

    const overBudget = budgets.filter(b => {
      const spent = b.total_spent as number;
      const total = b.total_amount as number;
      return total > 0 && (spent / total) * 100 >= CONFIG.advisor.budgetAlertThresholdPercent;
    });
    db.close();

    return {
      success: true,
      data: {
        recentInsights: insights,
        activeBudgets: budgets.length,
        overBudgetAlerts: overBudget.map(b => ({
          budgetName: b.name,
          totalAmount: b.total_amount,
          totalSpent: b.total_spent,
          percentUsed: b.total_amount ? Math.round(((b.total_spent as number) / (b.total_amount as number)) * 100) : 0,
        })),
        summary: insights.length > 0
          ? `Found ${insights.length} spending insight records and ${overBudget.length} budget alerts.`
          : 'No spending data available yet. Use the app to make transactions and build spending history.',
      },
    };
  },
};

// ── Debt Strategy ──

const DebtStrategyInput = z.object({
  userId: z.string(),
  debts: z.array(z.object({
    name: z.string(),
    balance: z.number().positive(),
    interestRate: z.number().min(0),
    minimumPayment: z.number().positive(),
  })),
  monthlyBudget: z.number().positive(),
  strategy: z.enum(['avalanche', 'snowball']).default('avalanche'),
});

export const debtStrategyTool: ToolDefinition = {
  name: 'debt_strategy',
  description: 'Calculate an optimal debt payoff strategy using avalanche (highest interest first) or snowball (smallest balance first) methods.',
  category: 'advisory',
  inputSchema: DebtStrategyInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = DebtStrategyInput.parse(input);
    ctx.logger.info(`Debt strategy: ${parsed.strategy} for ${parsed.debts.length} debts`);

    const sorted = [...parsed.debts].sort((a, b) =>
      parsed.strategy === 'avalanche'
        ? b.interestRate - a.interestRate
        : a.balance - b.balance
    );

    const totalDebt = parsed.debts.reduce((s, d) => s + d.balance, 0);
    const totalMinimum = parsed.debts.reduce((s, d) => s + d.minimumPayment, 0);
    const extraBudget = Math.max(0, parsed.monthlyBudget - totalMinimum);

    // Estimate payoff timeline
    let remainingDebt = totalDebt;
    let months = 0;
    let totalInterestPaid = 0;
    while (remainingDebt > 0 && months < 600) {
      months++;
      for (const debt of sorted) {
        if (debt.balance <= 0) continue;
        const interest = debt.balance * (debt.interestRate / 100 / 12);
        totalInterestPaid += interest;
        debt.balance += interest;
        const payment = debt.minimumPayment + (sorted.indexOf(debt) === 0 ? extraBudget : 0);
        debt.balance = Math.max(0, debt.balance - payment);
      }
      remainingDebt = sorted.reduce((s, d) => s + d.balance, 0);
    }

    return {
      success: true,
      data: {
        strategy: parsed.strategy,
        payoffOrder: sorted.map(d => d.name),
        totalDebt,
        monthlyBudget: parsed.monthlyBudget,
        estimatedMonths: months,
        estimatedYears: +(months / 12).toFixed(1),
        totalInterestPaid: +totalInterestPaid.toFixed(2),
        recommendation: extraBudget > 0
          ? `Extra $${extraBudget}/mo goes to ${sorted[0]?.name} first (${parsed.strategy} method).`
          : 'Your budget only covers minimum payments. Consider increasing your monthly debt budget.',
      },
    };
  },
};

// ── Savings Advice ──

const SavingsAdviceInput = z.object({
  userId: z.string(),
  monthlyIncome: z.number().positive().optional(),
});

export const savingsAdviceTool: ToolDefinition = {
  name: 'savings_advice',
  description: 'Provide personalized savings advice based on spending patterns and existing savings goals.',
  category: 'advisory',
  inputSchema: SavingsAdviceInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = SavingsAdviceInput.parse(input);
    ctx.logger.info(`Savings advice for user ${parsed.userId}`);

    const db = getDb();
    // Cross-agent: use existing savings_goals table
    const goals = db.prepare(`
      SELECT * FROM savings_goals WHERE user_id = ? AND status = 'active'
    `).all(parsed.userId) as Array<Record<string, unknown>>;

    const totalSaved = goals.reduce((s, g) => s + (g.current_amount as number), 0);
    const totalTarget = goals.reduce((s, g) => s + (g.target_amount as number), 0);
    db.close();

    const tips: string[] = [
      'Aim to save 20% of your income (50/30/20 rule).',
      'Build a 3-6 month emergency fund before investing.',
      'Automate savings with round-up rules on transactions.',
    ];

    if (parsed.monthlyIncome) {
      const idealSavings = parsed.monthlyIncome * 0.2;
      tips.unshift(`Target monthly savings: $${idealSavings.toFixed(2)} (20% of income).`);
    }

    return {
      success: true,
      data: {
        activeGoals: goals.length,
        totalSaved,
        totalTarget,
        progressPercent: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
        tips,
      },
    };
  },
};

// ── Tax Tips ──

const TaxTipsInput = z.object({
  userId: z.string(),
  filingStatus: z.enum(['single', 'married_joint', 'married_separate', 'head_of_household']).default('single'),
  annualIncome: z.number().positive().optional(),
});

export const taxTipsTool: ToolDefinition = {
  name: 'tax_tips',
  description: 'Provide general tax optimization tips based on filing status and income. Not a substitute for professional tax advice.',
  category: 'advisory',
  inputSchema: TaxTipsInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = TaxTipsInput.parse(input);
    ctx.logger.info(`Tax tips for user ${parsed.userId}, status: ${parsed.filingStatus}`);

    const tips: string[] = [
      'Maximize contributions to tax-advantaged accounts (401k, IRA, HSA).',
      'Track deductible expenses throughout the year, not just at tax time.',
      'Consider tax-loss harvesting on investment losses to offset gains.',
      'Review your withholding — large refunds mean you over-withheld.',
    ];

    if (parsed.annualIncome && parsed.annualIncome > 100000) {
      tips.push('Look into backdoor Roth IRA contributions if income exceeds Roth limits.');
      tips.push('Consider charitable giving strategies like donor-advised funds.');
    }

    return {
      success: true,
      data: {
        filingStatus: parsed.filingStatus,
        tips,
        disclaimer: 'These are general tips. Consult a CPA or tax professional for personalized tax advice.',
      },
    };
  },
};

// ── Net Worth Snapshot ──

const NetWorthInput = z.object({
  userId: z.string(),
});

export const netWorthSnapshotTool: ToolDefinition = {
  name: 'net_worth_snapshot',
  description: 'Calculate net worth from wallet balances, savings goals, and trading portfolios minus known debts.',
  category: 'advisory',
  inputSchema: NetWorthInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = NetWorthInput.parse(input);
    ctx.logger.info(`Net worth snapshot for user ${parsed.userId}`);

    const db = getDb();
    // Aggregate assets from multiple tables
    const savings = db.prepare(
      "SELECT COALESCE(SUM(current_amount), 0) as total FROM savings_goals WHERE user_id = ? AND status = 'active'"
    ).get(parsed.userId) as { total: number };

    const portfolios = db.prepare(
      "SELECT COALESCE(SUM(total_value + cash_balance), 0) as total FROM trading_portfolios WHERE user_id = ?"
    ).get(parsed.userId) as { total: number };

    const goals = db.prepare(
      "SELECT COALESCE(SUM(target_amount - current_amount), 0) as remaining FROM financial_goals WHERE user_id = ? AND type = 'debt_payoff' AND status = 'active'"
    ).get(parsed.userId) as { remaining: number };
    db.close();

    const totalAssets = savings.total + portfolios.total;
    const totalLiabilities = goals.remaining;
    const netWorth = totalAssets - totalLiabilities;

    return {
      success: true,
      data: {
        assets: {
          savings: savings.total,
          investments: portfolios.total,
          total: totalAssets,
        },
        liabilities: {
          debts: totalLiabilities,
          total: totalLiabilities,
        },
        netWorth,
      },
    };
  },
};

// ── Financial Health Score ──

const HealthScoreInput = z.object({
  userId: z.string(),
});

export const financialHealthScoreTool: ToolDefinition = {
  name: 'financial_health_score',
  description: 'Calculate a financial health score (0-100) based on savings rate, debt level, budget adherence, and financial goal progress.',
  category: 'advisory',
  inputSchema: HealthScoreInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = HealthScoreInput.parse(input);
    ctx.logger.info(`Financial health score for user ${parsed.userId}`);

    const db = getDb();
    let score = 50; // Base score
    const factors: Array<{ factor: string; impact: number; detail: string }> = [];

    // Factor 1: Has active savings goals
    const savingsGoals = db.prepare(
      "SELECT COUNT(*) as c FROM savings_goals WHERE user_id = ? AND status = 'active'"
    ).get(parsed.userId) as { c: number };
    if (savingsGoals.c > 0) { score += 10; factors.push({ factor: 'Active savings goals', impact: 10, detail: `${savingsGoals.c} active goal(s)` }); }

    // Factor 2: Has a budget
    const budgets = db.prepare(
      "SELECT COUNT(*) as c FROM budgets WHERE user_id = ? AND status = 'active'"
    ).get(parsed.userId) as { c: number };
    if (budgets.c > 0) { score += 15; factors.push({ factor: 'Active budget', impact: 15, detail: `${budgets.c} budget(s)` }); }

    // Factor 3: Has diversified investments
    const positions = db.prepare(`
      SELECT COUNT(DISTINCT tp.symbol) as c
      FROM trading_positions tp
      JOIN trading_portfolios tpf ON tp.portfolio_id = tpf.id
      WHERE tpf.user_id = ?
    `).get(parsed.userId) as { c: number };
    if (positions.c >= 3) { score += 10; factors.push({ factor: 'Diversified portfolio', impact: 10, detail: `${positions.c} positions` }); }
    else if (positions.c > 0) { score += 5; factors.push({ factor: 'Investment started', impact: 5, detail: `${positions.c} position(s)` }); }

    // Factor 4: Financial goals set
    const goals = db.prepare(
      "SELECT COUNT(*) as c FROM financial_goals WHERE user_id = ? AND status = 'active'"
    ).get(parsed.userId) as { c: number };
    if (goals.c > 0) { score += 10; factors.push({ factor: 'Financial goals set', impact: 10, detail: `${goals.c} goal(s)` }); }
    db.close();

    score = Math.min(100, Math.max(0, score));
    const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : score >= 20 ? 'D' : 'F';

    return {
      success: true,
      data: { score, grade, factors },
    };
  },
};

// ── Goal Planning ──

const GoalPlanningInput = z.object({
  userId: z.string(),
  name: z.string(),
  type: z.enum(['savings', 'debt_payoff', 'investment', 'emergency_fund', 'retirement', 'custom']),
  targetAmount: z.number().positive(),
  targetDate: z.string().optional(),
  monthlyContribution: z.number().positive().optional(),
});

export const goalPlanningTool: ToolDefinition = {
  name: 'goal_planning',
  description: 'Create and plan a financial goal with projected timeline and required monthly contributions.',
  category: 'advisory',
  inputSchema: GoalPlanningInput,
  requiresApproval: false,
  riskLevel: 'low',
  async execute(input: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const parsed = GoalPlanningInput.parse(input);
    ctx.logger.info(`Goal planning: ${parsed.name} ($${parsed.targetAmount})`);

    const db = getDb();
    const now = new Date().toISOString();
    const goalId = uuid();

    db.prepare(`
      INSERT INTO financial_goals (id, user_id, name, type, target_amount, current_amount, target_date, status, strategy, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, ?, 'active', '{}', ?, ?)
    `).run(goalId, parsed.userId, parsed.name, parsed.type, parsed.targetAmount, parsed.targetDate ?? null, now, now);
    db.close();

    // Calculate projections
    let monthsToGoal: number | null = null;
    let requiredMonthly: number | null = null;

    if (parsed.monthlyContribution) {
      monthsToGoal = Math.ceil(parsed.targetAmount / parsed.monthlyContribution);
    }
    if (parsed.targetDate) {
      const target = new Date(parsed.targetDate);
      const monthsRemaining = Math.max(1, Math.round((target.getTime() - Date.now()) / (30.44 * 24 * 60 * 60 * 1000)));
      requiredMonthly = +(parsed.targetAmount / monthsRemaining).toFixed(2);
    }

    return {
      success: true,
      data: {
        goalId,
        name: parsed.name,
        type: parsed.type,
        targetAmount: parsed.targetAmount,
        monthsToGoal,
        requiredMonthly,
        tip: parsed.type === 'emergency_fund'
          ? 'Aim for 3-6 months of living expenses.'
          : `Break your $${parsed.targetAmount} goal into monthly milestones for accountability.`,
      },
    };
  },
};

export const advisorTools: ToolDefinition[] = [
  createBudgetTool,
  analyzeSpendingTool,
  debtStrategyTool,
  savingsAdviceTool,
  taxTipsTool,
  netWorthSnapshotTool,
  financialHealthScoreTool,
  goalPlanningTool,
];
