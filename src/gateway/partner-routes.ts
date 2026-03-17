// ═══════════════════════════════════════════════════════════════
// PromptPay :: Partner Routes
// Bank partnership onboarding, management, and scoped dashboards
// Tiers: Standard ($99/mo) | Professional ($299/mo) | Enterprise ($999/mo)
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { hashPassword } from '../auth/tokens.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import { CONFIG } from '../core/config.js';
import type { MemoryStore } from '../memory/store.js';
import type { AuditTrail } from '../protocols/audit-trail.js';
import type { HookEngine } from '../hooks/engine.js';
import type { LoggerHandle } from '../core/types.js';

export interface PartnerRouteDependencies {
  memory: MemoryStore;
  auditTrail: AuditTrail;
  hookEngine: HookEngine;
  logger: LoggerHandle;
}

// Tier feature limits
const TIER_LIMITS: Record<string, {
  maxUsers: number; apiCalls: number; features: string[];
  price: number; transactionCut: number; whiteLabel: boolean;
}> = {
  standard: {
    maxUsers: 1000, apiCalls: 10000, price: 99, transactionCut: 1.5, whiteLabel: false,
    features: ['wallets', 'airtime', 'pos', 'basic_analytics'],
  },
  professional: {
    maxUsers: 10000, apiCalls: 100000, price: 299, transactionCut: 1.0, whiteLabel: false,
    features: ['wallets', 'airtime', 'pos', 'ai_agents', 'loyalty', 'webhooks', 'advanced_analytics', 'priority_support', 'calendar_ai'],
  },
  enterprise: {
    maxUsers: Infinity, apiCalls: Infinity, price: 999, transactionCut: 0.5, whiteLabel: true,
    features: ['wallets', 'airtime', 'pos', 'ai_agents', 'loyalty', 'webhooks', 'advanced_analytics', 'priority_support', 'calendar_ai', 'white_label', 'custom_domain', 'dedicated_support', 'sla'],
  },
};

export function createPartnerRoutes(deps: PartnerRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  function getTenantUserIds(tenantId: string): string[] {
    return (db.prepare('SELECT id FROM users WHERE tenant_id = ?').all(tenantId) as Array<{ id: string }>)
      .map((row) => row.id);
  }

  function getTenantAgentSummary(tenantId: string): { totalAgents: number; activeAgents: number } {
    return db.prepare(`
      SELECT
        COUNT(*) as totalAgents,
        COUNT(CASE WHEN pa.status = 'active' THEN 1 END) as activeAgents
      FROM pos_agents pa
      JOIN users u ON u.id = pa.user_id
      WHERE u.tenant_id = ?
    `).get(tenantId) as { totalAgents: number; activeAgents: number };
  }

  function getTenantTransactionSummary(tenantId: string): {
    totalTransactions: number;
    completedTransactions: number;
    pendingTransactions: number;
    totalVolume: number;
    completedVolume: number;
    totalAgentCommission: number;
    totalPlatformFee: number;
    lastTransactionAt: string | null;
  } {
    return db.prepare(`
      SELECT
        COUNT(*) as totalTransactions,
        COUNT(CASE WHEN pt.status = 'completed' THEN 1 END) as completedTransactions,
        COUNT(CASE WHEN pt.status = 'pending' THEN 1 END) as pendingTransactions,
        COALESCE(SUM(pt.face_value), 0) as totalVolume,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.face_value END), 0) as completedVolume,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.agent_profit END), 0) as totalAgentCommission,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.platform_fee END), 0) as totalPlatformFee,
        MAX(pt.created_at) as lastTransactionAt
      FROM pos_transactions pt
      JOIN users u ON u.id = pt.agent_user_id
      WHERE u.tenant_id = ?
    `).get(tenantId) as {
      totalTransactions: number;
      completedTransactions: number;
      pendingTransactions: number;
      totalVolume: number;
      completedVolume: number;
      totalAgentCommission: number;
      totalPlatformFee: number;
      lastTransactionAt: string | null;
    };
  }

  function getTenantApiUsage(tenantId: string): {
    totalCalls: number;
    todayCalls: number;
    activeKeys: number;
    lastRequestAt: string | null;
  } {
    return db.prepare(`
      SELECT
        COALESCE((SELECT COUNT(*) FROM developer_api_logs dal JOIN users du ON du.id = dal.user_id WHERE du.tenant_id = ?), 0) as totalCalls,
        COALESCE((SELECT SUM(dk.requests_today) FROM developer_keys dk JOIN users du ON du.id = dk.user_id WHERE du.tenant_id = ?), 0) as todayCalls,
        COALESCE((SELECT COUNT(*) FROM developer_keys dk JOIN users du ON du.id = dk.user_id WHERE du.tenant_id = ? AND dk.status = 'active'), 0) as activeKeys,
        (SELECT MAX(dal.created_at) FROM developer_api_logs dal JOIN users du ON du.id = dal.user_id WHERE du.tenant_id = ?) as lastRequestAt
      FROM users u
      WHERE u.tenant_id = ?
      LIMIT 1
    `).get(tenantId, tenantId, tenantId, tenantId, tenantId) as {
      totalCalls: number;
      todayCalls: number;
      activeKeys: number;
      lastRequestAt: string | null;
    };
  }

  // ── Ensure partner_documents table exists ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS partner_documents (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT,
      data TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    )
  `);

  // ── Apply for Partnership ──
  router.post('/api/partners/apply', (req: Request, res: Response) => {
    try {
      const { name, displayName, contactEmail, contactPhone, tier, website, description, documents } = req.body;
      if (!name || !contactEmail) {
        res.status(400).json({ error: 'name and contactEmail are required' });
        return;
      }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const existing = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
      if (existing) {
        res.status(409).json({ error: 'A partner with this name already exists' });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();
      const selectedTier = ['standard', 'professional', 'enterprise'].includes(tier) ? tier : 'standard';

      db.prepare(`
        INSERT INTO tenants (id, name, slug, display_name, contact_email, contact_phone, status, tier, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
      `).run(
        id, name, slug, displayName || name, contactEmail,
        contactPhone || null, selectedTier,
        JSON.stringify({ website: website || '', description: description || '' }),
        now, now,
      );

      // Store uploaded compliance documents
      let docCount = 0;
      if (documents && typeof documents === 'object') {
        const validDocTypes = ['cbn', 'cac', 'cac11', 'tin', 'scuml', 'signatory'];
        const insertDoc = db.prepare(`
          INSERT INTO partner_documents (id, tenant_id, doc_type, file_name, mime_type, data, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        `);

        for (const [docType, doc] of Object.entries(documents)) {
          if (!validDocTypes.includes(docType)) continue;
          const d = doc as { name?: string; type?: string; data?: string };
          if (!d.data || typeof d.data !== 'string') continue;
          // Limit to ~5MB base64
          if (d.data.length > 7 * 1024 * 1024) continue;

          insertDoc.run(uuid(), id, docType, d.name || `${docType}.pdf`, d.type || 'application/pdf', d.data, now);
          docCount++;
        }
      }

      deps.auditTrail.record('partner', 'application_submitted', name, { tenantId: id, contactEmail, tier: selectedTier, documentsUploaded: docCount });
      deps.logger.info(`[Partner] Application: ${name} (${contactEmail}) tier=${selectedTier} docs=${docCount}`);

      res.status(201).json({
        tenantId: id,
        slug,
        tier: selectedTier,
        status: 'pending',
        documentsUploaded: docCount,
        message: 'Application submitted. We will review and activate your account shortly.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[Partner] Application error: ${msg}`);
      res.status(500).json({ error: 'Application failed' });
    }
  });

  // ── Get Own Partner Details (Partner Admin) ──
  router.get('/api/partners/me', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as Record<string, unknown> | undefined;
    if (!partner) { res.status(404).json({ error: 'Partner not found' }); return; }

    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(tenantId) as { c: number }).c;
    const tier = partner.tier as string || 'standard';
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.standard;

    res.json({
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      displayName: partner.display_name,
      logoUrl: partner.logo_url,
      primaryColor: partner.primary_color,
      contactEmail: partner.contact_email,
      contactPhone: partner.contact_phone,
      status: partner.status,
      tier,
      config: JSON.parse(partner.config as string || '{}'),
      userCount,
      createdAt: partner.created_at,
      activatedAt: partner.activated_at,
      limits: {
        maxUsers: limits.maxUsers === Infinity ? 'unlimited' : limits.maxUsers,
        apiCalls: limits.apiCalls === Infinity ? 'unlimited' : limits.apiCalls,
        price: limits.price,
        transactionCut: limits.transactionCut,
        whiteLabel: limits.whiteLabel,
        features: limits.features,
      },
    });
  });

  // ── Partner Dashboard Stats ──
  router.get('/api/partners/me/stats', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const userIds = getTenantUserIds(tenantId);
    const hookStats = getPartnerHookStats(userIds);
    const txSummary = getTenantTransactionSummary(tenantId);
    const agentSummary = getTenantAgentSummary(tenantId);
    const apiUsage = getTenantApiUsage(tenantId);

    // User growth
    const totalUsers = userIds.length;
    const activeUsers = userIds.length > 0
      ? (db.prepare(`SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND last_login_at >= datetime('now', '-7 days')`).get(tenantId) as { c: number }).c
      : 0;
    const newUsersThisMonth = userIds.length > 0
      ? (db.prepare(`SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND created_at >= datetime('now', 'start of month')`).get(tenantId) as { c: number }).c
      : 0;

    res.json({
      ...hookStats,
      totalUsers,
      activeUsers,
      newUsersThisMonth,
      agentCount: agentSummary.totalAgents,
      activeAgents: agentSummary.activeAgents,
      transactionVolume: txSummary.completedVolume,
      transactionCount: txSummary.completedTransactions,
      pendingTransactions: txSummary.pendingTransactions,
      commissionSummary: {
        agentPayouts: txSummary.totalAgentCommission,
        promptPayShare: txSummary.totalPlatformFee,
      },
      apiStatus: apiUsage.activeKeys > 0 ? 'Connected' : 'Not Connected',
      lastTransactionAt: txSummary.lastTransactionAt,
    });
  });

  router.get('/api/partners/me/agents', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const agents = db.prepare(`
      SELECT
        pa.id,
        pa.agent_code,
        pa.display_name,
        pa.phone,
        pa.tier,
        pa.daily_limit,
        pa.daily_used,
        pa.total_transactions,
        pa.total_volume,
        pa.status,
        pa.created_at,
        u.id as user_id,
        u.email,
        u.last_login_at
      FROM pos_agents pa
      JOIN users u ON u.id = pa.user_id
      WHERE u.tenant_id = ?
      ORDER BY pa.created_at DESC
    `).all(tenantId) as Array<Record<string, unknown>>;

    res.json({ agents, total: agents.length });
  });

  // ── Partner Users List ──
  router.get('/api/partners/me/users', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const search = (req.query.search as string || '').trim();

    let query = 'SELECT id, email, display_name, role, status, country, last_login_at, created_at FROM users WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (search) {
      query += ' AND (email LIKE ? OR display_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const users = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    const total = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(tenantId) as { c: number }).c;

    res.json({ users, total, limit, offset });
  });

  // ── Partner Transactions ──
  router.get('/api/partners/me/transactions', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    const transactions = db.prepare(`
      SELECT
        pt.id,
        pt.product_type,
        pt.face_value,
        pt.cost_price,
        pt.agent_profit,
        pt.platform_fee,
        pt.currency,
        pt.country,
        pt.customer_phone,
        pt.carrier,
        pt.status,
        pt.created_at,
        pt.completed_at,
        u.id as agent_user_id,
        u.email as agent_email,
        u.display_name as agent_name
      FROM pos_transactions pt
      JOIN users u ON u.id = pt.agent_user_id
      WHERE u.tenant_id = ?
      ORDER BY pt.created_at DESC
      LIMIT ? OFFSET ?
    `).all(tenantId, limit, offset) as Array<Record<string, unknown>>;

    const total = (db.prepare(`
      SELECT COUNT(*) as c
      FROM pos_transactions pt
      JOIN users u ON u.id = pt.agent_user_id
      WHERE u.tenant_id = ?
    `).get(tenantId) as { c: number }).c;

    res.json({ transactions, total, limit, offset });
  });

  // ── Partner Revenue Breakdown ──
  router.get('/api/partners/me/revenue', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    const daily = db.prepare(`
      SELECT
        DATE(pt.created_at) as date,
        COUNT(*) as transactionCount,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.face_value END), 0) as volume,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.agent_profit END), 0) as agentCommission,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.platform_fee END), 0) as platformFee
      FROM pos_transactions pt
      JOIN users u ON u.id = pt.agent_user_id
      WHERE u.tenant_id = ? AND pt.created_at >= ?
      GROUP BY DATE(pt.created_at)
      ORDER BY date DESC
    `).all(tenantId, since) as Array<Record<string, unknown>>;

    const byType = db.prepare(`
      SELECT
        pt.product_type as type,
        COUNT(*) as transactionCount,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.face_value END), 0) as volume,
        COALESCE(SUM(CASE WHEN pt.status = 'completed' THEN pt.platform_fee END), 0) as platformFee
      FROM pos_transactions pt
      JOIN users u ON u.id = pt.agent_user_id
      WHERE u.tenant_id = ? AND pt.created_at >= ?
      GROUP BY pt.product_type
      ORDER BY volume DESC
    `).all(tenantId, since) as Array<Record<string, unknown>>;

    const totals = daily.reduce<{ volume: number; agentCommission: number; platformFee: number }>((acc, row) => {
      acc.volume += Number(row.volume || 0);
      acc.agentCommission += Number(row.agentCommission || 0);
      acc.platformFee += Number(row.platformFee || 0);
      return acc;
    }, { volume: 0, agentCommission: 0, platformFee: 0 });

    res.json({ daily, byType, totals, period: `${days} days` });
  });

  // ── Partner API Usage ──
  router.get('/api/partners/me/api-usage', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const userIds = (db.prepare('SELECT id FROM users WHERE tenant_id = ?').all(tenantId) as Array<{ id: string }>).map(r => r.id);
    if (userIds.length === 0) {
      res.json({ totalCalls: 0, todayCalls: 0, keys: [] });
      return;
    }

    const placeholders = userIds.map(() => '?').join(',');
    const keys = db.prepare(`
      SELECT id, name, api_key_prefix, requests_today, rate_limit, status, created_at
      FROM developer_keys WHERE user_id IN (${placeholders}) ORDER BY created_at DESC
    `).all(...userIds) as Array<Record<string, unknown>>;

    const todayCalls = keys.reduce((sum, k) => sum + (k.requests_today as number || 0), 0);
    const totalLogs = userIds.length > 0
      ? (db.prepare(`SELECT COUNT(*) as c FROM developer_api_logs WHERE user_id IN (${placeholders})`).get(...userIds) as { c: number }).c
      : 0;

    const lastRequestAt = userIds.length > 0
      ? (db.prepare(`SELECT MAX(created_at) as lastRequestAt FROM developer_api_logs WHERE user_id IN (${placeholders})`).get(...userIds) as { lastRequestAt: string | null }).lastRequestAt
      : null;

    res.json({
      totalCalls: totalLogs,
      todayCalls,
      keys,
      status: keys.length > 0 ? 'Connected' : 'Not Connected',
      activeKeys: keys.filter((key) => key.status === 'active').length,
      lastRequestAt,
    });
  });

  router.get('/api/partners/me/dashboard', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as Record<string, unknown> | undefined;
    if (!partner) { res.status(404).json({ error: 'Partner not found' }); return; }

    const userIds = getTenantUserIds(tenantId);
    const agentSummary = getTenantAgentSummary(tenantId);
    const transactionSummary = getTenantTransactionSummary(tenantId);
    const apiUsage = getTenantApiUsage(tenantId);

    const agents = db.prepare(`
      SELECT
        pa.id,
        pa.agent_code,
        pa.display_name,
        pa.phone,
        pa.tier,
        pa.total_transactions,
        pa.total_volume,
        pa.status,
        u.email
      FROM pos_agents pa
      JOIN users u ON u.id = pa.user_id
      WHERE u.tenant_id = ?
      ORDER BY pa.created_at DESC
      LIMIT 20
    `).all(tenantId) as Array<Record<string, unknown>>;

    res.json({
      partner: {
        id: partner.id,
        name: partner.name,
        slug: partner.slug,
        displayName: partner.display_name,
        contactEmail: partner.contact_email,
        contactPhone: partner.contact_phone,
        status: partner.status,
        tier: partner.tier,
        createdAt: partner.created_at,
        activatedAt: partner.activated_at,
        config: JSON.parse(String(partner.config || '{}')),
      },
      network: {
        totalUsers: userIds.length,
        totalAgents: agentSummary.totalAgents,
        activeAgents: agentSummary.activeAgents,
      },
      transactions: transactionSummary,
      commissionSummary: {
        agentPayouts: transactionSummary.totalAgentCommission,
        promptPayShare: transactionSummary.totalPlatformFee,
      },
      apiIntegration: {
        status: apiUsage.activeKeys > 0 ? 'Connected' : 'Not Connected',
        activeKeys: apiUsage.activeKeys,
        totalCalls: apiUsage.totalCalls,
        todayCalls: apiUsage.todayCalls,
        lastRequestAt: apiUsage.lastRequestAt,
      },
      agents,
    });
  });

  // ── Tier Info (public) ──
  router.get('/api/partners/tiers', (_req: Request, res: Response) => {
    res.json({
      tiers: Object.entries(TIER_LIMITS).map(([name, t]) => ({
        name,
        price: t.price,
        maxUsers: t.maxUsers === Infinity ? 'unlimited' : t.maxUsers,
        apiCalls: t.apiCalls === Infinity ? 'unlimited' : t.apiCalls,
        transactionCut: t.transactionCut,
        whiteLabel: t.whiteLabel,
        features: t.features,
      })),
    });
  });

  // ── Update Partner Branding ──
  router.put('/api/partners/me/branding', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) { res.status(400).json({ error: 'No tenant associated' }); return; }

    // Check tier for white-label
    const partner = db.prepare('SELECT tier FROM tenants WHERE id = ?').get(tenantId) as { tier: string } | undefined;
    const tier = partner?.tier || 'standard';
    const limits = TIER_LIMITS[tier] || TIER_LIMITS.standard;

    if (!limits.whiteLabel) {
      res.status(403).json({ error: 'White-label branding requires Enterprise tier. Upgrade to customize.' });
      return;
    }

    const { displayName, logoUrl, primaryColor } = req.body;
    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (displayName !== undefined) { updates.push('display_name = ?'); params.push(displayName); }
    if (logoUrl !== undefined) { updates.push('logo_url = ?'); params.push(logoUrl); }
    if (primaryColor !== undefined) { updates.push('primary_color = ?'); params.push(primaryColor); }

    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

    updates.push('updated_at = ?');
    params.push(now, tenantId);
    db.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  });

  // ════════════════════════════════════════════════════════════
  // OWNER-ONLY ROUTES (unchanged from before)
  // ════════════════════════════════════════════════════════════

  // ── List All Partners (Owner only) ──
  router.get('/api/partners', authenticate, requireRole('owner'), (_req: Request, res: Response) => {
    const partners = db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id) as user_count,
        (SELECT COUNT(*) FROM users WHERE tenant_id = t.id AND role = 'partner_admin') as admin_count
      FROM tenants t ORDER BY t.created_at DESC
    `).all() as Array<Record<string, unknown>>;

    res.json({
      partners: partners.map(p => ({
        id: p.id, name: p.name, slug: p.slug,
        displayName: p.display_name, logoUrl: p.logo_url, primaryColor: p.primary_color,
        contactEmail: p.contact_email, contactPhone: p.contact_phone,
        status: p.status, tier: p.tier,
        userCount: p.user_count, adminCount: p.admin_count,
        createdAt: p.created_at, activatedAt: p.activated_at,
      })),
      total: partners.length,
    });
  });

  // ── Get Partner Details (Owner only) ──
  router.get('/api/partners/:id', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const id = String(req.params.id);
    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!partner) { res.status(404).json({ error: 'Partner not found' }); return; }

    const users = db.prepare(
      'SELECT id, email, display_name, role, status, last_login_at, created_at FROM users WHERE tenant_id = ?'
    ).all(id) as Array<Record<string, unknown>>;

    const userIds = users.map(u => u.id as string);
    const hookStats = getPartnerHookStats(userIds);

    res.json({
      partner: {
        id: partner.id, name: partner.name, slug: partner.slug,
        displayName: partner.display_name, logoUrl: partner.logo_url,
        primaryColor: partner.primary_color, contactEmail: partner.contact_email,
        status: partner.status, tier: partner.tier,
        config: JSON.parse(partner.config as string || '{}'),
        createdAt: partner.created_at, activatedAt: partner.activated_at,
      },
      users: users.map(u => ({
        id: u.id, email: u.email, displayName: u.display_name,
        role: u.role, status: u.status, lastLoginAt: u.last_login_at,
      })),
      hookStats,
    });
  });

  // ── Approve Partner (Owner only) ──
  router.put('/api/partners/:id/approve', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const tenantId = String(req.params.id);
    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as Record<string, unknown> | undefined;
    if (!partner) { res.status(404).json({ error: 'Partner not found' }); return; }

    if (partner.status === 'active') {
      res.status(400).json({ error: 'Partner is already active' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE tenants SET status = ?, activated_at = ?, updated_at = ? WHERE id = ?')
      .run('active', now, now, tenantId);

    const adminId = uuid();
    const adminEmail = `admin@${partner.slug}.${CONFIG.platform.domain}`;
    const tempPassword = uuid().slice(0, 12);
    const passHash = hashPassword(tempPassword);

    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'partner_admin', 'active', ?, ?)
    `).run(adminId, tenantId, adminEmail, passHash, `${partner.display_name} Admin`, now, now);

    db.prepare(`
      INSERT INTO user_settings (user_id, ai_model_provider, preferred_channels, updated_at)
      VALUES (?, 'anthropic', 'email', ?)
    `).run(adminId, now);

    deps.auditTrail.record('owner', 'partner_approved', partner.name as string, { tenantId, adminEmail });
    deps.logger.info(`[Partner] Approved: ${partner.name} — admin: ${adminEmail}`);

    res.json({
      success: true,
      partner: { id: tenantId, status: 'active' },
      adminAccount: { email: adminEmail, tempPassword, note: 'Change this password on first login.' },
    });
  });

  // ── Suspend Partner (Owner only) ──
  router.put('/api/partners/:id/suspend', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const tenantId = String(req.params.id);
    const now = new Date().toISOString();
    const result = db.prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?').run('suspended', now, tenantId);
    if (result.changes === 0) { res.status(404).json({ error: 'Partner not found' }); return; }
    db.prepare('UPDATE users SET status = ? WHERE tenant_id = ?').run('suspended', tenantId);
    deps.auditTrail.record('owner', 'partner_suspended', tenantId, {});
    res.json({ success: true });
  });

  // ── Update Partner Config (Owner or Partner Admin) ──
  router.put('/api/partners/:id/config', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const tenantId = String(req.params.id);
    if (req.auth!.role === 'partner_admin' && req.auth!.tenantId !== tenantId) {
      res.status(403).json({ error: 'Cannot modify other partner configs' });
      return;
    }

    const { displayName, logoUrl, primaryColor, config } = req.body;
    const now = new Date().toISOString();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (displayName !== undefined) { updates.push('display_name = ?'); params.push(displayName); }
    if (logoUrl !== undefined) { updates.push('logo_url = ?'); params.push(logoUrl); }
    if (primaryColor !== undefined) { updates.push('primary_color = ?'); params.push(primaryColor); }
    if (config !== undefined) { updates.push('config = ?'); params.push(JSON.stringify(config)); }

    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }

    updates.push('updated_at = ?');
    params.push(now, tenantId);
    db.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  });

  // ── Helper: Get hook stats scoped to a set of user IDs ──
  function getPartnerHookStats(userIds: string[]): Record<string, unknown> {
    if (userIds.length === 0) {
      return { users: 0, streaks: {}, cashback: {}, loyalty: {}, achievements: {} };
    }

    const placeholders = userIds.map(() => '?').join(',');

    const streakStats = db.prepare(`
      SELECT COUNT(*) as total,
        COUNT(CASE WHEN current_streak > 0 THEN 1 END) as active,
        COALESCE(AVG(CASE WHEN current_streak > 0 THEN current_streak END), 0) as avg_streak,
        COALESCE(MAX(current_streak), 0) as max_streak
      FROM user_streaks WHERE user_id IN (${placeholders})
    `).get(...userIds) as Record<string, unknown>;

    const cashbackStats = db.prepare(`
      SELECT COALESCE(SUM(cashback_amount), 0) as total_cashback,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_count,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN cashback_amount END), 0) as pending_amount
      FROM cashback_ledger WHERE user_id IN (${placeholders})
    `).get(...userIds) as Record<string, unknown>;

    const loyaltyStats = db.prepare(`
      SELECT COUNT(*) as accounts,
        COALESCE(SUM(balance), 0) as total_points,
        COALESCE(SUM(lifetime_earned), 0) as total_earned
      FROM loyalty_accounts WHERE user_id IN (${placeholders})
    `).get(...userIds) as Record<string, unknown>;

    const achievementStats = db.prepare(`
      SELECT COUNT(*) as total_unlocks
      FROM user_achievements WHERE user_id IN (${placeholders})
    `).get(...userIds) as Record<string, unknown>;

    return {
      users: userIds.length,
      streaks: streakStats,
      cashback: cashbackStats,
      loyalty: loyaltyStats,
      achievements: achievementStats,
    };
  }

  return router;
}
