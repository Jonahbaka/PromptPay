// ═══════════════════════════════════════════════════════════════
// PromptPay :: User Routes
// Auth (register, login), profile, settings, API key, channels
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { hashPassword, verifyPassword, createToken } from '../auth/tokens.js';
import { authenticate } from '../auth/middleware.js';
import { CONFIG } from '../core/config.js';
import type { MemoryStore } from '../memory/store.js';
import type { LoggerHandle, CommunicationChannel } from '../core/types.js';
import type { EmailChannel } from '../channels/email.js';
import type { PushChannel } from '../channels/push.js';

export interface UserRouteDependencies {
  memory: MemoryStore;
  logger: LoggerHandle;
  emailChannel?: EmailChannel;
  pushChannel?: PushChannel;
}

const ALL_CHANNELS: CommunicationChannel[] = [
  'whatsapp', 'telegram', 'sms', 'signal', 'viber',
  'line', 'wechat', 'messenger', 'slack', 'discord',
  'email', 'push',
];

export function createUserRoutes(deps: UserRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // ── Register ──
  router.post('/api/auth/register', (req: Request, res: Response) => {
    try {
      const { email, password, displayName, country } = req.body;
      if (!email || !password || !displayName) {
        res.status(400).json({ error: 'email, password, and displayName are required' });
        return;
      }

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();
      const passwordHash = hashPassword(password);

      db.prepare(`
        INSERT INTO users (id, tenant_id, email, password_hash, display_name, country, role, status, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, 'user', 'active', ?, ?)
      `).run(id, email, passwordHash, displayName, country || '', now, now);

      // Create default settings
      db.prepare(`
        INSERT INTO user_settings (user_id, ai_model_provider, preferred_channels, updated_at)
        VALUES (?, 'anthropic', '', ?)
      `).run(id, now);

      const token = createToken(id, null, 'user', CONFIG.auth.jwtSecret, CONFIG.auth.tokenExpiryMs);

      deps.logger.info(`User registered: ${email}`, { userId: id });

      // Send welcome email (fire-and-forget)
      if (deps.emailChannel?.isActive()) {
        import('../channels/email.js').then(({ EmailTemplates }) => {
          const { subject, html } = EmailTemplates.welcome(displayName);
          deps.emailChannel!.sendEmail(email, subject, html).catch(err => {
            deps.logger.error(`Welcome email failed: ${err}`);
          });
        }).catch(() => {});
      }

      res.status(201).json({
        user: { id, email, displayName, role: 'user', country: country || '' },
        token,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Registration error: ${msg}`);
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  // ── Login ──
  router.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: 'email and password are required' });
        return;
      }

      const user = db.prepare(
        'SELECT id, tenant_id, email, password_hash, display_name, country, role, status FROM users WHERE email = ?'
      ).get(email) as { id: string; tenant_id: string | null; email: string; password_hash: string; display_name: string; country: string; role: string; status: string } | undefined;

      if (!user) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      if (user.status !== 'active') {
        res.status(403).json({ error: 'Account is ' + user.status });
        return;
      }

      if (!verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: 'Invalid email or password' });
        return;
      }

      // Update last login
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
        .run(new Date().toISOString(), user.id);

      const token = createToken(
        user.id,
        user.tenant_id,
        user.role as 'owner' | 'partner_admin' | 'user',
        CONFIG.auth.jwtSecret,
        CONFIG.auth.tokenExpiryMs,
      );

      deps.logger.info(`User logged in: ${email}`, { role: user.role });

      res.json({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          country: user.country || '',
          role: user.role,
          tenantId: user.tenant_id,
        },
        token,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Login error: ${msg}`);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  // ── Get Current User ──
  router.get('/api/auth/me', authenticate, (req: Request, res: Response) => {
    const user = db.prepare(
      'SELECT id, tenant_id, email, display_name, country, role, status, last_login_at, created_at FROM users WHERE id = ?'
    ).get(req.auth!.userId) as Record<string, unknown> | undefined;

    if (!user) {
      // System/legacy auth — return synthetic profile
      res.json({
        id: req.auth!.userId,
        email: 'admin@promptpay.app',
        displayName: 'System Admin',
        country: '',
        role: req.auth!.role,
        tenantId: req.auth!.tenantId,
      });
      return;
    }

    res.json({
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      country: user.country || '',
      role: user.role,
      tenantId: user.tenant_id,
      status: user.status,
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at,
    });
  });

  // ── Get User Settings ──
  router.get('/api/user/settings', authenticate, (req: Request, res: Response) => {
    const settings = db.prepare(
      'SELECT * FROM user_settings WHERE user_id = ?'
    ).get(req.auth!.userId) as Record<string, unknown> | undefined;

    if (!settings) {
      res.json({
        userId: req.auth!.userId,
        aiModelProvider: 'anthropic',
        aiModelName: null,
        hasApiKey: false,
        preferredChannels: [],
        notificationEnabled: true,
        language: 'en',
        timezone: 'UTC',
      });
      return;
    }

    const apiKey = settings.ai_model_api_key as string | null;
    res.json({
      userId: settings.user_id,
      aiModelProvider: settings.ai_model_provider,
      aiModelName: settings.ai_model_name,
      hasApiKey: !!apiKey,
      apiKeyLast4: apiKey ? '...' + apiKey.slice(-4) : null,
      preferredChannels: (settings.preferred_channels as string || '').split(',').filter(Boolean),
      notificationEnabled: settings.notification_enabled === 1,
      language: settings.language,
      timezone: settings.timezone,
    });
  });

  // ── Update User Settings ──
  router.put('/api/user/settings', authenticate, (req: Request, res: Response) => {
    const { preferredChannels, notificationEnabled, language, timezone, aiModelProvider, aiModelName, country } = req.body;
    const now = new Date().toISOString();

    // Update country on user record if provided
    if (country !== undefined) {
      db.prepare('UPDATE users SET country = ?, updated_at = ? WHERE id = ?')
        .run(country, now, req.auth!.userId);
    }

    // Validate channels if provided
    if (preferredChannels) {
      const channels = Array.isArray(preferredChannels) ? preferredChannels : [];
      const invalid = channels.filter((c: string) => !ALL_CHANNELS.includes(c as CommunicationChannel));
      if (invalid.length > 0) {
        res.status(400).json({ error: `Invalid channels: ${invalid.join(', ')}` });
        return;
      }
    }

    // Upsert settings
    db.prepare(`
      INSERT INTO user_settings (user_id, ai_model_provider, ai_model_name, preferred_channels, notification_enabled, language, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        ai_model_provider = COALESCE(?, ai_model_provider),
        ai_model_name = COALESCE(?, ai_model_name),
        preferred_channels = COALESCE(?, preferred_channels),
        notification_enabled = COALESCE(?, notification_enabled),
        language = COALESCE(?, language),
        timezone = COALESCE(?, timezone),
        updated_at = ?
    `).run(
      req.auth!.userId,
      aiModelProvider || 'anthropic',
      aiModelName || null,
      preferredChannels ? (Array.isArray(preferredChannels) ? preferredChannels.join(',') : '') : '',
      notificationEnabled !== undefined ? (notificationEnabled ? 1 : 0) : 1,
      language || 'en',
      timezone || 'UTC',
      now,
      // ON CONFLICT params
      aiModelProvider || null,
      aiModelName !== undefined ? aiModelName : null,
      preferredChannels ? (Array.isArray(preferredChannels) ? preferredChannels.join(',') : null) : null,
      notificationEnabled !== undefined ? (notificationEnabled ? 1 : 0) : null,
      language || null,
      timezone || null,
      now,
    );

    deps.logger.info(`Settings updated for user ${req.auth!.userId}`);
    res.json({ success: true });
  });

  // ── Set API Key ──
  router.put('/api/user/settings/api-key', authenticate, (req: Request, res: Response) => {
    const { apiKey, provider } = req.body;
    if (!apiKey) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_settings (user_id, ai_model_api_key, ai_model_provider, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        ai_model_api_key = ?,
        ai_model_provider = COALESCE(?, ai_model_provider),
        updated_at = ?
    `).run(
      req.auth!.userId, apiKey, provider || 'anthropic', now,
      apiKey, provider || null, now,
    );

    res.json({ success: true, apiKeyLast4: '...' + apiKey.slice(-4) });
  });

  // ── Remove API Key ──
  router.delete('/api/user/settings/api-key', authenticate, (req: Request, res: Response) => {
    db.prepare(`
      UPDATE user_settings SET ai_model_api_key = NULL, updated_at = ? WHERE user_id = ?
    `).run(new Date().toISOString(), req.auth!.userId);

    res.json({ success: true });
  });

  // ── List Available Channels ──
  router.get('/api/user/channels', authenticate, (_req: Request, res: Response) => {
    const active = ['telegram', 'whatsapp', 'sms', 'email', 'push'];
    res.json({
      channels: ALL_CHANNELS.map(ch => ({
        id: ch,
        name: ch.charAt(0).toUpperCase() + ch.slice(1),
        available: active.includes(ch),
        comingSoon: !active.includes(ch),
      })),
    });
  });

  // ── Push Subscription: Save ──
  router.post('/api/push/subscribe', authenticate, (req: Request, res: Response) => {
    if (!deps.pushChannel) {
      res.status(503).json({ error: 'Push notifications not available' });
      return;
    }
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      res.status(400).json({ error: 'subscription with endpoint is required' });
      return;
    }
    deps.pushChannel.saveSubscription(req.auth!.userId, subscription);
    res.json({ success: true });
  });

  // ── Push Subscription: Unsubscribe ──
  router.post('/api/push/unsubscribe', authenticate, (req: Request, res: Response) => {
    if (!deps.pushChannel) {
      res.status(503).json({ error: 'Push notifications not available' });
      return;
    }
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: 'endpoint is required' });
      return;
    }
    deps.pushChannel.removeSubscription(req.auth!.userId, endpoint);
    res.json({ success: true });
  });

  // ── VAPID Public Key ──
  router.get('/api/push/vapid-key', (_req: Request, res: Response) => {
    const key = CONFIG.push.vapidPublicKey;
    if (!key) {
      res.status(503).json({ error: 'Push not configured' });
      return;
    }
    res.json({ publicKey: key });
  });

  return router;
}
