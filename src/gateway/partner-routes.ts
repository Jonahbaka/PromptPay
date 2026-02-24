// ═══════════════════════════════════════════════════════════════
// PromptPay :: Partner Routes
// Bank partnership onboarding, management, and scoped dashboards
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

export function createPartnerRoutes(deps: PartnerRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // ── Apply for Partnership ──
  router.post('/api/partners/apply', (req: Request, res: Response) => {
    try {
      const { name, displayName, contactEmail, contactPhone, tier } = req.body;
      if (!name || !contactEmail) {
        res.status(400).json({ error: 'name and contactEmail are required' });
        return;
      }

      // Generate slug from name
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      const existing = db.prepare('SELECT id FROM tenants WHERE slug = ?').get(slug);
      if (existing) {
        res.status(409).json({ error: 'A partner with this name already exists' });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO tenants (id, name, slug, display_name, contact_email, contact_phone, status, tier, config, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, '{}', ?, ?)
      `).run(
        id, name, slug, displayName || name, contactEmail,
        contactPhone || null, tier || 'standard', now, now,
      );

      deps.auditTrail.record('partner', 'application_submitted', name, {
        tenantId: id, contactEmail,
      });

      deps.logger.info(`Partner application: ${name} (${contactEmail})`);

      res.status(201).json({
        tenantId: id,
        slug,
        status: 'pending',
        message: 'Application submitted. Awaiting owner approval.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Partner application error: ${msg}`);
      res.status(500).json({ error: 'Application failed' });
    }
  });

  // ── Get Own Partner Details (Partner Admin) ──
  // NOTE: Must be before /:id routes so Express doesn't match "me" as an id
  router.get('/api/partners/me', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'No tenant associated' });
      return;
    }

    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as Record<string, unknown> | undefined;
    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const userCount = (db.prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ?').get(tenantId) as { c: number }).c;

    res.json({
      id: partner.id,
      name: partner.name,
      slug: partner.slug,
      displayName: partner.display_name,
      logoUrl: partner.logo_url,
      primaryColor: partner.primary_color,
      status: partner.status,
      tier: partner.tier,
      userCount,
    });
  });

  // ── Partner Scoped Stats (Partner Admin) ──
  router.get('/api/partners/me/stats', authenticate, requireRole('partner_admin'), (req: Request, res: Response) => {
    const tenantId = req.auth!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'No tenant associated' });
      return;
    }

    const userIds = (db.prepare('SELECT id FROM users WHERE tenant_id = ?').all(tenantId) as Array<{ id: string }>).map(r => r.id);
    const stats = getPartnerHookStats(userIds);

    res.json(stats);
  });

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
        id: p.id,
        name: p.name,
        slug: p.slug,
        displayName: p.display_name,
        logoUrl: p.logo_url,
        primaryColor: p.primary_color,
        contactEmail: p.contact_email,
        contactPhone: p.contact_phone,
        status: p.status,
        tier: p.tier,
        userCount: p.user_count,
        adminCount: p.admin_count,
        createdAt: p.created_at,
        activatedAt: p.activated_at,
      })),
      total: partners.length,
    });
  });

  // ── Get Partner Details (Owner only) ──
  router.get('/api/partners/:id', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const id = String(req.params.id);
    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(id) as Record<string, unknown> | undefined;

    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    const users = db.prepare(
      'SELECT id, email, display_name, role, status, last_login_at, created_at FROM users WHERE tenant_id = ?'
    ).all(id) as Array<Record<string, unknown>>;

    // Get hook stats for this partner's users
    const userIds = users.map(u => u.id as string);
    const hookStats = getPartnerHookStats(userIds);

    res.json({
      partner: {
        id: partner.id,
        name: partner.name,
        slug: partner.slug,
        displayName: partner.display_name,
        logoUrl: partner.logo_url,
        primaryColor: partner.primary_color,
        contactEmail: partner.contact_email,
        status: partner.status,
        tier: partner.tier,
        config: JSON.parse(partner.config as string || '{}'),
        createdAt: partner.created_at,
        activatedAt: partner.activated_at,
      },
      users: users.map(u => ({
        id: u.id,
        email: u.email,
        displayName: u.display_name,
        role: u.role,
        status: u.status,
        lastLoginAt: u.last_login_at,
      })),
      hookStats,
    });
  });

  // ── Approve Partner (Owner only) ──
  router.put('/api/partners/:id/approve', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const tenantId = String(req.params.id);
    const partner = db.prepare('SELECT * FROM tenants WHERE id = ?').get(tenantId) as Record<string, unknown> | undefined;

    if (!partner) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    if (partner.status === 'active') {
      res.status(400).json({ error: 'Partner is already active' });
      return;
    }

    const now = new Date().toISOString();

    // Activate tenant
    db.prepare('UPDATE tenants SET status = ?, activated_at = ?, updated_at = ? WHERE id = ?')
      .run('active', now, now, tenantId);

    // Create partner admin account
    const adminId = uuid();
    const adminEmail = `admin@${partner.slug}.${CONFIG.platform.domain}`;
    const tempPassword = uuid().slice(0, 12);
    const passwordHash = hashPassword(tempPassword);

    db.prepare(`
      INSERT INTO users (id, tenant_id, email, password_hash, display_name, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'partner_admin', 'active', ?, ?)
    `).run(adminId, tenantId, adminEmail, passwordHash, `${partner.display_name} Admin`, now, now);

    // Create settings for admin
    db.prepare(`
      INSERT INTO user_settings (user_id, ai_model_provider, preferred_channels, updated_at)
      VALUES (?, 'anthropic', 'email', ?)
    `).run(adminId, now);

    deps.auditTrail.record('owner', 'partner_approved', partner.name as string, {
      tenantId, adminEmail,
    });

    deps.logger.info(`Partner approved: ${partner.name} — admin: ${adminEmail}`);

    res.json({
      success: true,
      partner: { id: tenantId, status: 'active' },
      adminAccount: {
        email: adminEmail,
        tempPassword,
        note: 'Please change this password on first login.',
      },
    });
  });

  // ── Suspend Partner (Owner only) ──
  router.put('/api/partners/:id/suspend', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const tenantId = String(req.params.id);
    const now = new Date().toISOString();

    const result = db.prepare('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?')
      .run('suspended', now, tenantId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Partner not found' });
      return;
    }

    // Suspend all partner users
    db.prepare('UPDATE users SET status = ? WHERE tenant_id = ?')
      .run('suspended', tenantId);

    deps.auditTrail.record('owner', 'partner_suspended', tenantId, {});
    res.json({ success: true });
  });

  // ── Update Partner Config (Owner or Partner Admin) ──
  router.put('/api/partners/:id/config', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const tenantId = String(req.params.id);

    // Partner admins can only update their own tenant
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

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

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
