// ═══════════════════════════════════════════════════════════════
// PromptPay :: POS Agent Routes
// "PromptPay Points" — POS agent onboarding, limits, management
// Progressive daily limits with first-increase auto-approval
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, requireRole } from '../auth/middleware.js';
import type { MemoryStore } from '../memory/store.js';
import type { AuditTrail } from '../protocols/audit-trail.js';
import type { LoggerHandle } from '../core/types.js';

export interface PosRouteDependencies {
  memory: MemoryStore;
  auditTrail: AuditTrail;
  logger: LoggerHandle;
}

// Tier progression for agents
const AGENT_TIERS = {
  starter:  { dailyLimit: 50000,   label: 'Starter',  color: '#6366f1' },
  verified: { dailyLimit: 200000,  label: 'Verified', color: '#22c55e' },
  trusted:  { dailyLimit: 500000,  label: 'Trusted',  color: '#a855f7' },
  premium:  { dailyLimit: 1000000, label: 'Premium',  color: '#eab308' },
};

export function createPosRoutes(deps: PosRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // ── Ensure POS tables exist ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS pos_agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      agent_code TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      bvn TEXT,
      nin TEXT,
      guarantor_name TEXT,
      guarantor_phone TEXT,
      deposit_amount REAL DEFAULT 0,
      tier TEXT DEFAULT 'starter',
      daily_limit REAL DEFAULT 50000,
      daily_used REAL DEFAULT 0,
      daily_reset_date TEXT,
      total_transactions INTEGER DEFAULT 0,
      total_volume REAL DEFAULT 0,
      rating REAL DEFAULT 5.0,
      rating_count INTEGER DEFAULT 0,
      limit_increases INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      suspended_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_user ON pos_agents(user_id);
    CREATE INDEX IF NOT EXISTS idx_pos_code ON pos_agents(agent_code);
    CREATE INDEX IF NOT EXISTS idx_pos_status ON pos_agents(status);

    CREATE TABLE IF NOT EXISTS pos_limit_requests (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      current_limit REAL NOT NULL,
      requested_limit REAL NOT NULL,
      reason TEXT,
      status TEXT DEFAULT 'pending',
      auto_approved INTEGER DEFAULT 0,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (agent_id) REFERENCES pos_agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_lr_agent ON pos_limit_requests(agent_id);

    CREATE TABLE IF NOT EXISTS pos_referrals (
      id TEXT PRIMARY KEY,
      referrer_agent_id TEXT NOT NULL,
      referred_agent_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      FOREIGN KEY (referrer_agent_id) REFERENCES pos_agents(id),
      FOREIGN KEY (referred_agent_id) REFERENCES pos_agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_ref_referrer ON pos_referrals(referrer_agent_id);
    CREATE INDEX IF NOT EXISTS idx_pos_ref_referred ON pos_referrals(referred_agent_id);

    CREATE TABLE IF NOT EXISTS pos_referral_bonuses (
      id TEXT PRIMARY KEY,
      referral_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      milestone TEXT NOT NULL,
      bonus_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      credited_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (referral_id) REFERENCES pos_referrals(id),
      FOREIGN KEY (agent_id) REFERENCES pos_agents(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pos_rb_agent ON pos_referral_bonuses(agent_id);
    CREATE INDEX IF NOT EXISTS idx_pos_rb_status ON pos_referral_bonuses(status);
  `);

  // Add referred_by column if missing (safe alter)
  try { db.exec('ALTER TABLE pos_agents ADD COLUMN referred_by TEXT'); } catch (_) { /* already exists */ }
  try { db.exec('ALTER TABLE pos_agents ADD COLUMN referral_count INTEGER DEFAULT 0'); } catch (_) { /* already exists */ }

  // Bonus structure (naira amounts)
  const BONUS_STRUCTURE: Record<string, { referrer: number; referred: number; condition: string }> = {
    signup:     { referrer: 500,  referred: 200, condition: 'Referred agent completes registration' },
    first_sale: { referrer: 1000, referred: 500, condition: 'Referred agent makes first sale' },
    '10_sales': { referrer: 2000, referred: 0,   condition: 'Referred agent reaches 10 sales' },
    '50_sales': { referrer: 5000, referred: 0,   condition: 'Referred agent reaches 50 sales' },
  };

  // ── Generate unique 8-char agent code ──
  function generateAgentCode(): string {
    const prefix = 'PP';
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = prefix;
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    const exists = db.prepare('SELECT 1 FROM pos_agents WHERE agent_code = ?').get(code);
    return exists ? generateAgentCode() : code;
  }

  // ═══════════════════════════════════════════════
  // AGENT-FACING ROUTES (authenticated users)
  // ═══════════════════════════════════════════════

  // ── Helper: Award referral bonus ──
  function awardReferralBonus(referralId: string, agentId: string, milestone: string): void {
    const bonus = BONUS_STRUCTURE[milestone];
    if (!bonus) return;
    const now = new Date().toISOString();

    // Check if already awarded for this milestone + referral
    const exists = db.prepare(
      'SELECT 1 FROM pos_referral_bonuses WHERE referral_id = ? AND milestone = ? AND agent_id = ?'
    ).get(referralId, milestone, agentId);
    if (exists) return;

    if (bonus.referrer > 0) {
      const referral = db.prepare('SELECT referrer_agent_id FROM pos_referrals WHERE id = ?').get(referralId) as { referrer_agent_id: string } | undefined;
      if (referral) {
        db.prepare(`
          INSERT INTO pos_referral_bonuses (id, referral_id, agent_id, milestone, bonus_amount, status, credited_at, created_at)
          VALUES (?, ?, ?, ?, ?, 'credited', ?, ?)
        `).run(uuid(), referralId, referral.referrer_agent_id, milestone, bonus.referrer, now, now);
        deps.logger.info(`[POS-Referral] Bonus ₦${bonus.referrer} to referrer for ${milestone}`);
      }
    }
    if (bonus.referred > 0) {
      db.prepare(`
        INSERT INTO pos_referral_bonuses (id, referral_id, agent_id, milestone, bonus_amount, status, credited_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'credited', ?, ?)
      `).run(uuid(), referralId, agentId, milestone, bonus.referred, now, now);
      deps.logger.info(`[POS-Referral] Bonus ₦${bonus.referred} to referred for ${milestone}`);
    }
  }

  // ── Register as POS Agent ──
  router.post('/api/pos/register', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const existing = db.prepare('SELECT id FROM pos_agents WHERE user_id = ?').get(userId);
      if (existing) {
        res.status(409).json({ error: 'You are already registered as a POS agent' });
        return;
      }

      const { displayName, phone, address, bvn, nin, guarantorName, guarantorPhone, referralCode } = req.body;
      if (!displayName || !phone) {
        res.status(400).json({ error: 'displayName and phone are required' });
        return;
      }

      const id = uuid();
      const agentCode = generateAgentCode();
      const now = new Date().toISOString();
      const today = now.slice(0, 10);

      // Validate referral code if provided
      let referrerAgent: Record<string, unknown> | undefined;
      if (referralCode && typeof referralCode === 'string' && referralCode.trim()) {
        referrerAgent = db.prepare(
          "SELECT id, user_id, agent_code, display_name FROM pos_agents WHERE agent_code = ? AND status = 'active'"
        ).get(referralCode.trim().toUpperCase()) as Record<string, unknown> | undefined;
      }

      db.prepare(`
        INSERT INTO pos_agents (id, user_id, agent_code, display_name, phone, address, bvn, nin,
          guarantor_name, guarantor_phone, referred_by, tier, daily_limit, daily_used, daily_reset_date,
          status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'starter', 50000, 0, ?, 'active', ?, ?)
      `).run(
        id, userId, agentCode, displayName, phone,
        address || null, bvn || null, nin || null,
        guarantorName || null, guarantorPhone || null,
        referrerAgent ? referrerAgent.id as string : null,
        today, now, now,
      );

      // Process referral if valid
      let referralMessage = '';
      if (referrerAgent) {
        const refId = uuid();
        db.prepare(`
          INSERT INTO pos_referrals (id, referrer_agent_id, referred_agent_id, status, created_at)
          VALUES (?, ?, ?, 'active', ?)
        `).run(refId, referrerAgent.id, id, now);

        // Increment referrer's count
        db.prepare('UPDATE pos_agents SET referral_count = referral_count + 1 WHERE id = ?').run(referrerAgent.id);

        // Award signup bonuses
        awardReferralBonus(refId, id, 'signup');

        referralMessage = ` Referred by ${referrerAgent.display_name} (${referrerAgent.agent_code}) — signup bonuses awarded!`;
        deps.logger.info(`[POS-Referral] ${agentCode} referred by ${referrerAgent.agent_code}`);
      }

      deps.auditTrail.record('pos', 'agent_registered', userId, { agentId: id, agentCode, referredBy: referrerAgent?.agent_code || null });
      deps.logger.info(`[POS] Agent registered: ${agentCode} (${displayName})`);

      res.status(201).json({
        agentId: id,
        agentCode,
        tier: 'starter',
        dailyLimit: 50000,
        status: 'active',
        referredBy: referrerAgent ? referrerAgent.agent_code : null,
        message: `Welcome to PromptPay Points! Your agent code is ${agentCode}. Daily limit: ₦50,000.${referralMessage}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[POS] Registration error: ${msg}`);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // ── Get My Agent Profile ──
  router.get('/api/pos/me', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const agent = db.prepare('SELECT * FROM pos_agents WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!agent) {
      res.status(404).json({ error: 'Not registered as a POS agent', registered: false });
      return;
    }

    // Reset daily used if new day
    const today = new Date().toISOString().slice(0, 10);
    if (agent.daily_reset_date !== today) {
      db.prepare('UPDATE pos_agents SET daily_used = 0, daily_reset_date = ? WHERE id = ?').run(today, agent.id);
      agent.daily_used = 0;
    }

    const tier = agent.tier as string || 'starter';
    const tierInfo = AGENT_TIERS[tier as keyof typeof AGENT_TIERS] || AGENT_TIERS.starter;

    // Get pending limit requests
    const pendingRequest = db.prepare(
      "SELECT * FROM pos_limit_requests WHERE agent_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    ).get(agent.id) as Record<string, unknown> | undefined;

    res.json({
      id: agent.id,
      agentCode: agent.agent_code,
      displayName: agent.display_name,
      phone: agent.phone,
      address: agent.address,
      tier,
      tierLabel: tierInfo.label,
      tierColor: tierInfo.color,
      dailyLimit: agent.daily_limit,
      dailyUsed: agent.daily_used,
      dailyRemaining: Math.max(0, (agent.daily_limit as number) - (agent.daily_used as number)),
      totalTransactions: agent.total_transactions,
      totalVolume: agent.total_volume,
      rating: agent.rating,
      ratingCount: agent.rating_count,
      limitIncreases: agent.limit_increases,
      status: agent.status,
      pendingLimitRequest: pendingRequest ? {
        id: pendingRequest.id,
        requestedLimit: pendingRequest.requested_limit,
        createdAt: pendingRequest.created_at,
      } : null,
      hasBvn: !!(agent.bvn),
      hasNin: !!(agent.nin),
      hasGuarantor: !!(agent.guarantor_name),
      registered: true,
      createdAt: agent.created_at,
    });
  });

  // ── Request Limit Increase ──
  router.post('/api/pos/limit-request', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const agent = db.prepare('SELECT * FROM pos_agents WHERE user_id = ? AND status = ?').get(userId, 'active') as Record<string, unknown> | undefined;
      if (!agent) {
        res.status(404).json({ error: 'No active POS agent profile found' });
        return;
      }

      // Check no pending request
      const pending = db.prepare(
        "SELECT id FROM pos_limit_requests WHERE agent_id = ? AND status = 'pending'"
      ).get(agent.id);
      if (pending) {
        res.status(409).json({ error: 'You already have a pending limit increase request' });
        return;
      }

      const { requestedLimit, reason } = req.body;
      const currentLimit = agent.daily_limit as number;
      const requested = Number(requestedLimit);

      if (!requested || requested <= currentLimit) {
        res.status(400).json({ error: `Requested limit must be higher than current ₦${currentLimit.toLocaleString()}` });
        return;
      }

      // Cap at ₦1,000,000 max
      const maxLimit = 1000000;
      if (requested > maxLimit) {
        res.status(400).json({ error: `Maximum daily limit is ₦${maxLimit.toLocaleString()}` });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();
      const limitIncreases = agent.limit_increases as number || 0;

      // FIRST REQUEST: Auto-approve instantly
      const isFirstRequest = limitIncreases === 0;

      if (isFirstRequest) {
        // Auto-approve: bump to requested limit (capped at verified tier)
        const approvedLimit = Math.min(requested, AGENT_TIERS.verified.dailyLimit);
        const newTier = approvedLimit >= AGENT_TIERS.verified.dailyLimit ? 'verified' : 'starter';

        db.prepare(`
          INSERT INTO pos_limit_requests (id, agent_id, current_limit, requested_limit, reason, status, auto_approved, reviewed_at, created_at)
          VALUES (?, ?, ?, ?, ?, 'approved', 1, ?, ?)
        `).run(id, agent.id, currentLimit, approvedLimit, reason || 'First limit increase', now, now);

        db.prepare(`
          UPDATE pos_agents SET daily_limit = ?, tier = ?, limit_increases = limit_increases + 1, updated_at = ?
          WHERE id = ?
        `).run(approvedLimit, newTier, now, agent.id);

        deps.auditTrail.record('pos', 'limit_auto_approved', userId, {
          agentId: agent.id, from: currentLimit, to: approvedLimit, tier: newTier,
        });
        deps.logger.info(`[POS] Limit auto-approved: ${agent.agent_code} ₦${currentLimit} → ₦${approvedLimit}`);

        res.json({
          requestId: id,
          status: 'approved',
          autoApproved: true,
          previousLimit: currentLimit,
          newLimit: approvedLimit,
          tier: newTier,
          message: `Your daily limit has been increased to ₦${approvedLimit.toLocaleString()}! Welcome to ${AGENT_TIERS[newTier as keyof typeof AGENT_TIERS].label} tier.`,
        });
        return;
      }

      // Subsequent requests: queue for admin review
      db.prepare(`
        INSERT INTO pos_limit_requests (id, agent_id, current_limit, requested_limit, reason, status, auto_approved, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)
      `).run(id, agent.id, currentLimit, requested, reason || '', now);

      deps.auditTrail.record('pos', 'limit_requested', userId, {
        agentId: agent.id, current: currentLimit, requested,
      });
      deps.logger.info(`[POS] Limit request: ${agent.agent_code} ₦${currentLimit} → ₦${requested} (pending review)`);

      res.json({
        requestId: id,
        status: 'pending',
        autoApproved: false,
        currentLimit,
        requestedLimit: requested,
        message: `Limit increase request submitted. Current: ₦${currentLimit.toLocaleString()}, Requested: ₦${requested.toLocaleString()}. An admin will review shortly.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[POS] Limit request error: ${msg}`);
      res.status(500).json({ error: 'Failed to submit limit request' });
    }
  });

  // ── Get My Limit Request History ──
  router.get('/api/pos/limit-requests', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const agent = db.prepare('SELECT id FROM pos_agents WHERE user_id = ?').get(userId) as { id: string } | undefined;
    if (!agent) { res.status(404).json({ error: 'Not a POS agent' }); return; }

    const requests = db.prepare(
      'SELECT * FROM pos_limit_requests WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20'
    ).all(agent.id);

    res.json({ requests });
  });

  // ═══════════════════════════════════════════════
  // ADMIN / OWNER ROUTES
  // ═══════════════════════════════════════════════

  // ── List All POS Agents ──
  router.get('/api/pos/agents', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const status = req.query.status as string || '';
    const search = (req.query.search as string || '').trim();

    let query = 'SELECT a.*, u.email FROM pos_agents a JOIN users u ON u.id = a.user_id WHERE 1=1';
    const params: unknown[] = [];

    if (status) { query += ' AND a.status = ?'; params.push(status); }
    if (search) {
      query += ' AND (a.display_name LIKE ? OR a.agent_code LIKE ? OR a.phone LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const countQuery = query.replace('SELECT a.*, u.email', 'SELECT COUNT(*) as c');
    const total = (db.prepare(countQuery).get(...params) as { c: number }).c;

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const agents = db.prepare(query).all(...params);

    res.json({ agents, total, limit, offset });
  });

  // ── Get Pending Limit Requests (Admin) ──
  router.get('/api/pos/admin/limit-requests', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const status = req.query.status as string || 'pending';
    const requests = db.prepare(`
      SELECT lr.*, a.agent_code, a.display_name, a.tier, a.total_transactions, a.total_volume, a.rating
      FROM pos_limit_requests lr
      JOIN pos_agents a ON a.id = lr.agent_id
      WHERE lr.status = ?
      ORDER BY lr.created_at DESC LIMIT 50
    `).all(status);

    res.json({ requests });
  });

  // ── Approve Limit Request (Admin) ──
  router.put('/api/pos/limit-requests/:id/approve', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const requestId = String(req.params.id);
    const request = db.prepare(
      "SELECT * FROM pos_limit_requests WHERE id = ? AND status = 'pending'"
    ).get(requestId) as Record<string, unknown> | undefined;

    if (!request) {
      res.status(404).json({ error: 'Limit request not found or already processed' });
      return;
    }

    const now = new Date().toISOString();
    const approvedLimit = Number(req.body.approvedLimit) || request.requested_limit as number;

    // Determine new tier
    let newTier = 'starter';
    if (approvedLimit >= AGENT_TIERS.premium.dailyLimit) newTier = 'premium';
    else if (approvedLimit >= AGENT_TIERS.trusted.dailyLimit) newTier = 'trusted';
    else if (approvedLimit >= AGENT_TIERS.verified.dailyLimit) newTier = 'verified';

    db.prepare("UPDATE pos_limit_requests SET status = 'approved', reviewed_by = ?, reviewed_at = ? WHERE id = ?")
      .run(req.auth!.userId, now, requestId);

    db.prepare('UPDATE pos_agents SET daily_limit = ?, tier = ?, limit_increases = limit_increases + 1, updated_at = ? WHERE id = ?')
      .run(approvedLimit, newTier, now, request.agent_id);

    deps.auditTrail.record('pos', 'limit_approved', req.auth!.userId, {
      requestId, agentId: request.agent_id, approvedLimit, tier: newTier,
    });

    res.json({ success: true, approvedLimit, tier: newTier });
  });

  // ── Deny Limit Request (Admin) ──
  router.put('/api/pos/limit-requests/:id/deny', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const requestId = String(req.params.id);
    const now = new Date().toISOString();

    const result = db.prepare("UPDATE pos_limit_requests SET status = 'denied', reviewed_by = ?, reviewed_at = ? WHERE id = ? AND status = 'pending'")
      .run(req.auth!.userId, now, requestId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Request not found or already processed' });
      return;
    }

    res.json({ success: true });
  });

  // ── Suspend Agent (Admin) ──
  router.put('/api/pos/agents/:id/suspend', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const agentId = String(req.params.id);
    const now = new Date().toISOString();
    const reason = req.body.reason || '';

    const result = db.prepare("UPDATE pos_agents SET status = 'suspended', suspended_reason = ?, updated_at = ? WHERE id = ?")
      .run(reason, now, agentId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    deps.auditTrail.record('pos', 'agent_suspended', req.auth!.userId, { agentId, reason });
    res.json({ success: true });
  });

  // ── Reactivate Agent (Admin) ──
  router.put('/api/pos/agents/:id/activate', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const agentId = String(req.params.id);
    const now = new Date().toISOString();

    const result = db.prepare("UPDATE pos_agents SET status = 'active', suspended_reason = NULL, updated_at = ? WHERE id = ?")
      .run(now, agentId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    deps.auditTrail.record('pos', 'agent_reactivated', req.auth!.userId, { agentId });
    res.json({ success: true });
  });

  // ── POS Dashboard Stats (Admin) ──
  router.get('/api/pos/stats', authenticate, requireRole('owner', 'partner_admin'), (_req: Request, res: Response) => {
    const total = (db.prepare('SELECT COUNT(*) as c FROM pos_agents').get() as { c: number }).c;
    const active = (db.prepare("SELECT COUNT(*) as c FROM pos_agents WHERE status = 'active'").get() as { c: number }).c;
    const suspended = (db.prepare("SELECT COUNT(*) as c FROM pos_agents WHERE status = 'suspended'").get() as { c: number }).c;
    const pendingRequests = (db.prepare("SELECT COUNT(*) as c FROM pos_limit_requests WHERE status = 'pending'").get() as { c: number }).c;

    const volumeStats = db.prepare(`
      SELECT COALESCE(SUM(total_volume), 0) as totalVolume,
             COALESCE(SUM(total_transactions), 0) as totalTransactions,
             COALESCE(AVG(rating), 5.0) as avgRating
      FROM pos_agents WHERE status = 'active'
    `).get() as Record<string, number>;

    const tierBreakdown = db.prepare(`
      SELECT tier, COUNT(*) as count FROM pos_agents WHERE status = 'active' GROUP BY tier
    `).all() as Array<{ tier: string; count: number }>;

    res.json({
      total, active, suspended, pendingRequests,
      totalVolume: volumeStats.totalVolume,
      totalTransactions: volumeStats.totalTransactions,
      avgRating: Math.round(volumeStats.avgRating * 10) / 10,
      tierBreakdown: Object.fromEntries(tierBreakdown.map(t => [t.tier, t.count])),
    });
  });

  // ═══════════════════════════════════════════════
  // REFERRAL SYSTEM
  // ═══════════════════════════════════════════════

  // ── Get My Referral Info (Agent-facing) ──
  router.get('/api/pos/my-referrals', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const agent = db.prepare('SELECT * FROM pos_agents WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
    if (!agent) { res.status(404).json({ error: 'Not a POS agent' }); return; }

    const referrals = db.prepare(`
      SELECT pr.id, pr.created_at, a.display_name, a.agent_code, a.tier, a.total_transactions, a.status
      FROM pos_referrals pr
      JOIN pos_agents a ON a.id = pr.referred_agent_id
      WHERE pr.referrer_agent_id = ?
      ORDER BY pr.created_at DESC
    `).all(agent.id) as Array<Record<string, unknown>>;

    const bonuses = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN status = 'credited' THEN bonus_amount ELSE 0 END), 0) as credited,
             COALESCE(SUM(CASE WHEN status = 'pending' THEN bonus_amount ELSE 0 END), 0) as pending,
             COUNT(*) as totalBonuses
      FROM pos_referral_bonuses WHERE agent_id = ?
    `).get(agent.id) as { credited: number; pending: number; totalBonuses: number };

    res.json({
      agentCode: agent.agent_code,
      referralCount: agent.referral_count || 0,
      referrals,
      bonuses: {
        totalEarned: bonuses.credited,
        pending: bonuses.pending,
        totalCount: bonuses.totalBonuses,
      },
      shareLink: `https://www.upromptpay.com/?ref=${agent.agent_code}`,
      bonusStructure: BONUS_STRUCTURE,
    });
  });

  // ── Admin: Referral Stats ──
  router.get('/api/pos/referral-stats', authenticate, requireRole('owner', 'partner_admin'), (_req: Request, res: Response) => {
    const totalReferrals = (db.prepare('SELECT COUNT(*) as c FROM pos_referrals').get() as { c: number }).c;
    const activeReferred = (db.prepare(`
      SELECT COUNT(*) as c FROM pos_referrals pr
      JOIN pos_agents a ON a.id = pr.referred_agent_id
      WHERE a.status = 'active'
    `).get() as { c: number }).c;

    const bonusStats = db.prepare(`
      SELECT COALESCE(SUM(CASE WHEN status = 'credited' THEN bonus_amount ELSE 0 END), 0) as paid,
             COALESCE(SUM(CASE WHEN status = 'pending' THEN bonus_amount ELSE 0 END), 0) as pending
      FROM pos_referral_bonuses
    `).get() as { paid: number; pending: number };

    // Top referrers
    const topReferrers = db.prepare(`
      SELECT a.id, a.display_name, a.agent_code, a.referral_count, a.status,
        (SELECT COUNT(*) FROM pos_referrals pr JOIN pos_agents ra ON ra.id = pr.referred_agent_id
         WHERE pr.referrer_agent_id = a.id AND ra.status = 'active') as active_count,
        COALESCE((SELECT SUM(bonus_amount) FROM pos_referral_bonuses WHERE agent_id = a.id AND status = 'credited'), 0) as total_bonuses
      FROM pos_agents a
      WHERE a.referral_count > 0
      ORDER BY a.referral_count DESC
      LIMIT 20
    `).all() as Array<Record<string, unknown>>;

    // Recent events
    const recentEvents = db.prepare(`
      SELECT rb.id, rb.milestone, rb.bonus_amount, rb.status, rb.created_at,
        ra.display_name as referrer_name, ra.agent_code as referrer_code,
        rd.display_name as referred_name, rd.agent_code as referred_code
      FROM pos_referral_bonuses rb
      JOIN pos_referrals pr ON pr.id = rb.referral_id
      JOIN pos_agents ra ON ra.id = pr.referrer_agent_id
      JOIN pos_agents rd ON rd.id = pr.referred_agent_id
      ORDER BY rb.created_at DESC LIMIT 50
    `).all() as Array<Record<string, unknown>>;

    res.json({
      totalReferrals,
      activeReferred,
      bonusesPaid: bonusStats.paid,
      bonusesPending: bonusStats.pending,
      topReferrers,
      recentEvents,
    });
  });

  return router;
}
