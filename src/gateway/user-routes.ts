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
      profilePicture: user.profile_picture || null,
    });
  });

  // ── Profile Picture Upload ──
  router.post('/api/auth/profile-picture', authenticate, (req: Request, res: Response) => {
    const { image } = req.body as { image?: string };
    if (!image || typeof image !== 'string') {
      res.status(400).json({ error: 'Image data required (base64)' });
      return;
    }
    // Validate it's a data URL (image/png, image/jpeg, image/webp)
    if (!image.startsWith('data:image/')) {
      res.status(400).json({ error: 'Invalid image format. Must be data:image/ URL' });
      return;
    }
    // Limit to ~2MB base64
    if (image.length > 2 * 1024 * 1024) {
      res.status(400).json({ error: 'Image too large. Max 1.5MB' });
      return;
    }
    db.prepare('UPDATE users SET profile_picture = ?, updated_at = ? WHERE id = ?')
      .run(image, new Date().toISOString(), req.auth!.userId);
    res.json({ success: true });
  });

  router.delete('/api/auth/profile-picture', authenticate, (req: Request, res: Response) => {
    db.prepare('UPDATE users SET profile_picture = NULL, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), req.auth!.userId);
    res.json({ success: true });
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

  // ══════════════════════════════════════════════════════════
  // REWARD BALANCE
  // ══════════════════════════════════════════════════════════

  router.get('/api/rewards/balance', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const row = db.prepare(
        'SELECT balance, lifetime_earned, last_credited_at FROM reward_balances WHERE user_id = ?'
      ).get(userId) as { balance: number; lifetime_earned: number; last_credited_at: string | null } | undefined;

      res.json({
        balance: row?.balance ?? 0,
        lifetimeEarned: row?.lifetime_earned ?? 0,
        lastCreditedAt: row?.last_credited_at ?? null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Reward balance error: ${msg}`);
      res.status(500).json({ error: 'Failed to get reward balance' });
    }
  });

  // ══════════════════════════════════════════════════════════
  // STRIPE PAYMENT METHODS
  // ══════════════════════════════════════════════════════════

  async function stripeRequest(
    path: string, body: URLSearchParams | null, method: 'POST' | 'GET' | 'DELETE' = 'POST'
  ): Promise<Record<string, unknown>> {
    const opts: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${CONFIG.stripe.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(15000),
    };
    if (body && method === 'POST') opts.body = body.toString();
    const url = `https://api.stripe.com/v1${path}${method === 'GET' && body ? `?${body.toString()}` : ''}`;
    const resp = await fetch(url, opts);
    return await resp.json() as Record<string, unknown>;
  }

  async function getOrCreateStripeCustomer(userId: string): Promise<string> {
    const row = db.prepare('SELECT stripe_customer_id, email FROM users WHERE id = ?')
      .get(userId) as { stripe_customer_id: string | null; email: string } | undefined;
    if (row?.stripe_customer_id) return row.stripe_customer_id;

    const body = new URLSearchParams();
    body.set('metadata[user_id]', userId);
    if (row?.email) body.set('email', row.email);
    const customer = await stripeRequest('/customers', body);
    if (!customer.id) throw new Error('Failed to create Stripe customer');

    db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?')
      .run(customer.id as string, userId);
    return customer.id as string;
  }

  // ── Stripe Publishable Key ──
  router.get('/api/config/stripe-key', (_req: Request, res: Response) => {
    const key = CONFIG.stripe.publishableKey;
    if (!key) { res.status(503).json({ error: 'Stripe not configured' }); return; }
    res.json({ publishableKey: key });
  });

  // ── Add Payment Method ──
  router.post('/api/user/payment-methods', authenticate, async (req: Request, res: Response) => {
    try {
      const { paymentMethodId } = req.body;
      if (!paymentMethodId) {
        res.status(400).json({ error: 'paymentMethodId is required' });
        return;
      }

      const customerId = await getOrCreateStripeCustomer(req.auth!.userId);

      // Attach payment method to customer
      const body = new URLSearchParams();
      body.set('customer', customerId);
      const result = await stripeRequest(`/payment_methods/${paymentMethodId}/attach`, body);

      if (result.error) {
        res.status(400).json({ error: (result.error as Record<string, string>).message || 'Failed to add card' });
        return;
      }

      const card = result.card as Record<string, unknown> | undefined;
      deps.logger.info(`Payment method added for user ${req.auth!.userId}: ${result.id}`);
      res.json({
        success: true,
        paymentMethod: {
          id: result.id,
          brand: card?.brand || 'card',
          last4: card?.last4 || '****',
          expMonth: card?.exp_month,
          expYear: card?.exp_year,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Add payment method error: ${msg}`);
      res.status(500).json({ error: 'Failed to add payment method' });
    }
  });

  // ── List Payment Methods ──
  router.get('/api/user/payment-methods', authenticate, async (req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
        .get(req.auth!.userId) as { stripe_customer_id: string | null } | undefined;

      if (!row?.stripe_customer_id) {
        res.json({ methods: [] });
        return;
      }

      const params = new URLSearchParams();
      params.set('customer', row.stripe_customer_id);
      params.set('type', 'card');
      const result = await stripeRequest('/payment_methods', params, 'GET');

      const data = (result.data || []) as Array<Record<string, unknown>>;
      const methods = data.map((pm) => {
        const card = pm.card as Record<string, unknown> | undefined;
        return {
          id: pm.id,
          brand: card?.brand || 'card',
          last4: card?.last4 || '****',
          expMonth: card?.exp_month,
          expYear: card?.exp_year,
        };
      });

      res.json({ methods });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`List payment methods error: ${msg}`);
      res.status(500).json({ error: 'Failed to list payment methods' });
    }
  });

  // ── Remove Payment Method ──
  router.delete('/api/user/payment-methods/:id', authenticate, async (req: Request, res: Response) => {
    try {
      const result = await stripeRequest(`/payment_methods/${req.params.id}/detach`, new URLSearchParams());
      if (result.error) {
        res.status(400).json({ error: (result.error as Record<string, string>).message || 'Failed to remove card' });
        return;
      }
      deps.logger.info(`Payment method removed: ${req.params.id}`);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Remove payment method error: ${msg}`);
      res.status(500).json({ error: 'Failed to remove payment method' });
    }
  });

  // ── Set Default Payment Method ──
  router.post('/api/user/payment-methods/:id/default', authenticate, async (req: Request, res: Response) => {
    try {
      const customerId = await getOrCreateStripeCustomer(req.auth!.userId);
      const body = new URLSearchParams();
      body.set('invoice_settings[default_payment_method]', req.params.id as string);
      const result = await stripeRequest(`/customers/${customerId}`, body);
      if (result.error) {
        res.status(400).json({ error: (result.error as Record<string, string>).message || 'Failed to set default' });
        return;
      }
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Set default payment method error: ${msg}`);
      res.status(500).json({ error: 'Failed to set default payment method' });
    }
  });

  // ══════════════════════════════════════════════════════════
  // KYC VERIFICATION
  // ══════════════════════════════════════════════════════════

  // Get KYC status for current user
  router.get('/api/kyc/status', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const user = db.prepare('SELECT country, kyc_tier, kyc_status FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
      const kyc = db.prepare('SELECT * FROM kyc_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId) as Record<string, unknown> | undefined;

      const country = (user?.country || '') as string;
      const countryConf = (CONFIG as Record<string, unknown>).countryConfig as Record<string, Record<string, unknown>> | undefined;
      const cc = countryConf?.[country];

      res.json({
        country,
        tier: user?.kyc_tier || 0,
        status: user?.kyc_status || 'none',
        verification: kyc || null,
        requirements: cc?.kycRequirements || null,
        limits: cc?.tierLimits || null,
        currency: cc?.currency || 'USD',
        currencySymbol: cc?.currencySymbol || '$',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`KYC status error: ${msg}`);
      res.status(500).json({ error: 'Failed to get KYC status' });
    }
  });

  // Submit KYC verification
  router.post('/api/kyc/submit', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { country, bvn, nin, ghana_card_number, national_id, phone_number, full_name, date_of_birth } = req.body;

      if (!country) {
        res.status(400).json({ error: 'Country is required' });
        return;
      }

      const now = new Date().toISOString();
      const id = uuid();

      // Determine tier based on what's submitted
      let tier = 1;
      const countryConf = (CONFIG as Record<string, unknown>).countryConfig as Record<string, Record<string, unknown>> | undefined;
      const cc = countryConf?.[country];

      if (cc) {
        const reqs = cc.kycRequirements as Record<string, string[]>;
        // Check Tier 2 requirements
        if (country === 'NG' && bvn && nin) tier = 2;
        else if (country === 'GH' && ghana_card_number && phone_number) tier = 2;
        else if ((country === 'KE' || country === 'UG') && national_id && phone_number) tier = 2;
      }

      // Upsert KYC record
      const existing = db.prepare('SELECT id FROM kyc_verifications WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;

      if (existing) {
        db.prepare(`
          UPDATE kyc_verifications SET country = ?, tier = ?, status = 'verified',
            bvn = ?, nin = ?, ghana_card_number = ?, national_id = ?,
            phone_number = ?, full_name = ?, date_of_birth = ?,
            verified_at = ?, updated_at = ?
          WHERE user_id = ?
        `).run(country, tier, bvn || null, nin || null, ghana_card_number || null, national_id || null,
          phone_number || null, full_name || null, date_of_birth || null, now, now, userId);
      } else {
        db.prepare(`
          INSERT INTO kyc_verifications (id, user_id, country, tier, status, bvn, nin, ghana_card_number, national_id, phone_number, full_name, date_of_birth, verified_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'verified', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, userId, country, tier, bvn || null, nin || null, ghana_card_number || null, national_id || null,
          phone_number || null, full_name || null, date_of_birth || null, now, now, now);
      }

      // Update user record
      db.prepare('UPDATE users SET kyc_tier = ?, kyc_status = ?, country = ?, phone_number = ? WHERE id = ?')
        .run(tier, 'verified', country, phone_number || null, userId);

      deps.logger.info(`KYC submitted: user=${userId} country=${country} tier=${tier}`);

      // Send confirmation email (fire-and-forget)
      if (deps.emailChannel?.isActive()) {
        const userRow = db.prepare('SELECT email, display_name FROM users WHERE id = ?')
          .get(userId) as { email: string; display_name: string } | undefined;
        if (userRow?.email) {
          import('../channels/email.js').then(({ EmailTemplates: _ET }) => {
            const tierLabel = (cc?.tierLimits as Record<number, { label?: string }>)?.[tier]?.label || `Tier ${tier}`;
            deps.emailChannel!.sendEmail(userRow.email,
              'Identity Verified — PromptPay',
              `<h2 style="color:#1a1a2e;margin:0 0 16px">Verification Complete</h2>
               <p style="color:#444;line-height:1.6;margin:0 0 16px">
                 Hi ${userRow.display_name || 'there'}, your identity has been verified successfully.
                 You are now at <strong>${tierLabel}</strong> level.
               </p>
               <div style="text-align:center;margin:24px 0">
                 <a href="${CONFIG.platform.domainUrl}"
                    style="display:inline-block;padding:12px 32px;background:#7c3aed;color:#fff;
                           text-decoration:none;border-radius:8px;font-weight:600">
                   Open PromptPay
                 </a>
               </div>`
            ).catch(() => {});
          }).catch(() => {});
        }
      }

      // Send push notification (fire-and-forget)
      if (deps.pushChannel) {
        deps.pushChannel.sendMessage(userId, JSON.stringify({
          title: 'Identity Verified',
          body: `You're verified! Your account is now Tier ${tier}.`,
        })).catch(() => {});
      }

      res.json({
        success: true,
        tier,
        status: 'verified',
        limits: (cc?.tierLimits as Record<number, unknown>)?.[tier] || null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`KYC submit error: ${msg}`);
      res.status(500).json({ error: 'Failed to submit KYC' });
    }
  });

  // ══════════════════════════════════════════════════════════
  // BANK ACCOUNTS & MOBILE WALLETS
  // ══════════════════════════════════════════════════════════

  // Get bank list for a country
  router.get('/api/banks/:country', (req: Request, res: Response) => {
    const country = (req.params.country as string).toUpperCase();
    const bankLists = (CONFIG as Record<string, unknown>).bankLists as Record<string, Array<{ code: string; name: string }>> | undefined;
    const banks = bankLists?.[country] || [];
    res.json({ banks });
  });

  // Add linked bank account
  router.post('/api/bank-accounts', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { country, bank_code, bank_name, account_number, account_name, currency } = req.body;

      if (!country || !bank_code || !bank_name || !account_number || !currency) {
        res.status(400).json({ error: 'country, bank_code, bank_name, account_number, and currency are required' });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();

      // Check if this account already exists
      const existing = db.prepare(
        'SELECT id FROM user_bank_accounts WHERE user_id = ? AND bank_code = ? AND account_number = ?'
      ).get(userId, bank_code, account_number);

      if (existing) {
        res.status(409).json({ error: 'This bank account is already linked' });
        return;
      }

      // Count existing accounts to set default
      const count = db.prepare('SELECT COUNT(*) as c FROM user_bank_accounts WHERE user_id = ?').get(userId) as { c: number };
      const isDefault = count.c === 0 ? 1 : 0;

      db.prepare(`
        INSERT INTO user_bank_accounts (id, user_id, country, bank_code, bank_name, account_number, account_name, currency, is_default, verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(id, userId, country, bank_code, bank_name, account_number, account_name || null, currency, isDefault, now);

      res.json({ success: true, id, is_default: isDefault === 1 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Add bank account error: ${msg}`);
      res.status(500).json({ error: 'Failed to add bank account' });
    }
  });

  // List linked bank accounts
  router.get('/api/bank-accounts', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const accounts = db.prepare('SELECT * FROM user_bank_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(userId);
      res.json({ accounts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`List bank accounts error: ${msg}`);
      res.status(500).json({ error: 'Failed to list bank accounts' });
    }
  });

  // Remove linked bank account
  router.delete('/api/bank-accounts/:id', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      db.prepare('DELETE FROM user_bank_accounts WHERE id = ? AND user_id = ?').run(req.params.id, userId);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Remove bank account error: ${msg}`);
      res.status(500).json({ error: 'Failed to remove bank account' });
    }
  });

  // Add linked mobile wallet
  router.post('/api/mobile-wallets', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { country, provider, phone_number, account_name, currency } = req.body;

      if (!country || !provider || !phone_number || !currency) {
        res.status(400).json({ error: 'country, provider, phone_number, and currency are required' });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();

      const existing = db.prepare(
        'SELECT id FROM user_mobile_wallets WHERE user_id = ? AND provider = ? AND phone_number = ?'
      ).get(userId, provider, phone_number);

      if (existing) {
        res.status(409).json({ error: 'This mobile wallet is already linked' });
        return;
      }

      const count = db.prepare('SELECT COUNT(*) as c FROM user_mobile_wallets WHERE user_id = ?').get(userId) as { c: number };
      const isDefault = count.c === 0 ? 1 : 0;

      db.prepare(`
        INSERT INTO user_mobile_wallets (id, user_id, country, provider, phone_number, account_name, currency, is_default, verified, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      `).run(id, userId, country, provider, phone_number, account_name || null, currency, isDefault, now);

      res.json({ success: true, id, is_default: isDefault === 1 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Add mobile wallet error: ${msg}`);
      res.status(500).json({ error: 'Failed to add mobile wallet' });
    }
  });

  // List linked mobile wallets
  router.get('/api/mobile-wallets', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const wallets = db.prepare('SELECT * FROM user_mobile_wallets WHERE user_id = ? ORDER BY is_default DESC, created_at DESC').all(userId);
      res.json({ wallets });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`List mobile wallets error: ${msg}`);
      res.status(500).json({ error: 'Failed to list mobile wallets' });
    }
  });

  // Remove linked mobile wallet
  router.delete('/api/mobile-wallets/:id', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      db.prepare('DELETE FROM user_mobile_wallets WHERE id = ? AND user_id = ?').run(req.params.id, userId);
      res.json({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Remove mobile wallet error: ${msg}`);
      res.status(500).json({ error: 'Failed to remove mobile wallet' });
    }
  });

  // ══════════════════════════════════════════════════════════
  // DOMESTIC TRANSFERS
  // ══════════════════════════════════════════════════════════

  // Initiate bank transfer (via Flutterwave)
  router.post('/api/transfers/bank', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { bank_code, account_number, account_name, amount, currency, narration, country } = req.body;

      if (!bank_code || !account_number || !amount || !currency) {
        res.status(400).json({ error: 'bank_code, account_number, amount, and currency are required' });
        return;
      }

      // Check KYC tier
      const user = db.prepare('SELECT kyc_tier, kyc_status, country FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
      if (!user || (user.kyc_tier as number) < 1) {
        res.status(403).json({ error: 'KYC verification required before making transfers', requiresKyc: true });
        return;
      }

      // Check daily limit
      const userCountry = (country || user.country || '') as string;
      const countryConf = (CONFIG as Record<string, unknown>).countryConfig as Record<string, Record<string, unknown>> | undefined;
      const cc = countryConf?.[userCountry];
      if (cc) {
        const limits = (cc.tierLimits as Record<number, { dailySend: number }>)?.[user.kyc_tier as number];
        if (limits && amount > limits.dailySend) {
          res.status(403).json({ error: `Amount exceeds your Tier ${user.kyc_tier} daily limit of ${cc.currencySymbol}${limits.dailySend.toLocaleString()}. Upgrade KYC to increase.` });
          return;
        }
      }

      // Attempt Flutterwave transfer
      if (!CONFIG.flutterwave.secretKey) {
        // Simulate for development
        const transferId = uuid();
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO domestic_transfers (id, user_id, country, type, provider, provider_ref, recipient_account, recipient_name, amount, currency, fee, status, narration, created_at)
          VALUES (?, ?, ?, 'bank', 'simulated', ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
        `).run(transferId, userId, userCountry, 'SIM-' + transferId.slice(0, 8), account_number, account_name || null,
          amount, currency, amount * 0.01, narration || null, now);

        res.json({
          success: true,
          transfer: { id: transferId, status: 'completed', provider: 'simulated', amount, currency, fee: amount * 0.01 },
        });
        return;
      }

      // Real Flutterwave transfer
      const flwRes = await fetch('https://api.flutterwave.com/v3/transfers', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CONFIG.flutterwave.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          account_bank: bank_code,
          account_number,
          amount,
          currency,
          narration: narration || `PromptPay transfer`,
          reference: `PP-${uuid().slice(0, 12)}`,
          debit_currency: currency,
        }),
      });

      const flwData = await flwRes.json() as Record<string, unknown>;

      const transferId = uuid();
      const now = new Date().toISOString();
      const fee = amount * (CONFIG.fees.p2pPercent / 100);

      db.prepare(`
        INSERT INTO domestic_transfers (id, user_id, country, type, provider, provider_ref, recipient_account, recipient_name, amount, currency, fee, status, narration, created_at)
        VALUES (?, ?, ?, 'bank', 'flutterwave', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(transferId, userId, userCountry,
        (flwData.data as Record<string, unknown>)?.id?.toString() || null,
        account_number, account_name || null,
        amount, currency, fee,
        flwData.status === 'success' ? 'pending' : 'failed',
        narration || null, now);

      if (flwData.status !== 'success') {
        res.status(400).json({ error: (flwData.message as string) || 'Transfer failed', details: flwData });
        return;
      }

      deps.logger.info(`Bank transfer initiated: ${transferId} ${currency} ${amount} to ${account_number}`);
      res.json({
        success: true,
        transfer: {
          id: transferId,
          status: 'pending',
          provider: 'flutterwave',
          provider_ref: (flwData.data as Record<string, unknown>)?.id,
          amount,
          currency,
          fee,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Bank transfer error: ${msg}`);
      res.status(500).json({ error: 'Failed to initiate transfer' });
    }
  });

  // Initiate mobile money transfer
  router.post('/api/transfers/mobile-money', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { provider, phone_number, amount, currency, narration, country } = req.body;

      if (!provider || !phone_number || !amount || !currency) {
        res.status(400).json({ error: 'provider, phone_number, amount, and currency are required' });
        return;
      }

      // Check KYC
      const user = db.prepare('SELECT kyc_tier, kyc_status, country FROM users WHERE id = ?').get(userId) as Record<string, unknown> | undefined;
      if (!user || (user.kyc_tier as number) < 1) {
        res.status(403).json({ error: 'KYC verification required before making transfers', requiresKyc: true });
        return;
      }

      const userCountry = (country || user.country || '') as string;
      const transferId = uuid();
      const now = new Date().toISOString();
      const fee = amount * (CONFIG.fees.p2pPercent / 100);

      // Route to appropriate provider
      let providerRef = '';
      let status = 'pending';

      if (provider === 'mpesa' && CONFIG.mpesa.consumerKey) {
        // M-Pesa STK Push
        const tokenRes = await fetch(
          `https://${CONFIG.mpesa.environment === 'production' ? 'api' : 'sandbox'}.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials`,
          { headers: { 'Authorization': 'Basic ' + Buffer.from(`${CONFIG.mpesa.consumerKey}:${CONFIG.mpesa.consumerSecret}`).toString('base64') } }
        );
        const tokenData = await tokenRes.json() as Record<string, string>;
        const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
        const password = Buffer.from(`${CONFIG.mpesa.shortcode}${CONFIG.mpesa.passkey}${timestamp}`).toString('base64');

        const stkRes = await fetch(
          `https://${CONFIG.mpesa.environment === 'production' ? 'api' : 'sandbox'}.safaricom.co.ke/mpesa/stkpush/v1/processrequest`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              BusinessShortCode: CONFIG.mpesa.shortcode,
              Password: password,
              Timestamp: timestamp,
              TransactionType: 'CustomerPayBillOnline',
              Amount: Math.ceil(amount),
              PartyA: phone_number.replace('+', ''),
              PartyB: CONFIG.mpesa.shortcode,
              PhoneNumber: phone_number.replace('+', ''),
              CallBackURL: `${CONFIG.platform.domainUrl}/webhooks/mpesa`,
              AccountReference: `PP${transferId.slice(0, 8)}`,
              TransactionDesc: narration || 'PromptPay Transfer',
            }),
          }
        );
        const stkData = await stkRes.json() as Record<string, string>;
        providerRef = stkData.CheckoutRequestID || '';
        status = stkData.ResponseCode === '0' ? 'pending' : 'failed';

      } else if ((provider === 'mtn' || provider === 'mtn_momo') && CONFIG.mtnMomo.subscriptionKey) {
        // MTN MoMo Request to Pay
        const tokenRes = await fetch('https://momodeveloper.mtn.com/collection/token/', {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${CONFIG.mtnMomo.apiUser}:${CONFIG.mtnMomo.apiKey}`).toString('base64'),
            'Ocp-Apim-Subscription-Key': CONFIG.mtnMomo.subscriptionKey,
          },
        });
        const tokenData = await tokenRes.json() as Record<string, string>;
        const refId = uuid();

        const momoRes = await fetch('https://momodeveloper.mtn.com/collection/v1_0/requesttopay', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${tokenData.access_token}`,
            'X-Reference-Id': refId,
            'X-Target-Environment': CONFIG.mtnMomo.environment,
            'Ocp-Apim-Subscription-Key': CONFIG.mtnMomo.subscriptionKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: amount.toString(),
            currency,
            externalId: transferId,
            payer: { partyIdType: 'MSISDN', partyId: phone_number.replace('+', '') },
            payerMessage: narration || 'PromptPay Transfer',
            payeeNote: 'PromptPay',
          }),
        });

        providerRef = refId;
        status = momoRes.ok ? 'pending' : 'failed';

      } else {
        // Simulated
        providerRef = 'SIM-' + transferId.slice(0, 8);
        status = 'completed';
      }

      db.prepare(`
        INSERT INTO domestic_transfers (id, user_id, country, type, provider, provider_ref, recipient_account, recipient_name, amount, currency, fee, status, narration, created_at)
        VALUES (?, ?, ?, 'mobile_money', ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
      `).run(transferId, userId, userCountry, provider, providerRef, phone_number,
        amount, currency, fee, status, narration || null, now);

      deps.logger.info(`Mobile money transfer: ${transferId} ${provider} ${currency} ${amount} to ${phone_number} status=${status}`);
      res.json({
        success: true,
        transfer: { id: transferId, status, provider, provider_ref: providerRef, amount, currency, fee },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Mobile money transfer error: ${msg}`);
      res.status(500).json({ error: 'Failed to initiate transfer' });
    }
  });

  // Get transfer history
  router.get('/api/transfers', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const limit = parseInt(req.query.limit as string) || 20;
      const transfers = db.prepare(
        'SELECT * FROM domestic_transfers WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(userId, limit);
      res.json({ transfers });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Transfer history error: ${msg}`);
      res.status(500).json({ error: 'Failed to get transfer history' });
    }
  });

  // Get country config for frontend
  router.get('/api/config/country/:code', (req: Request, res: Response) => {
    const code = (req.params.code as string).toUpperCase();
    const countryConf = (CONFIG as Record<string, unknown>).countryConfig as Record<string, unknown> | undefined;
    const cc = countryConf?.[code];
    if (!cc) {
      res.status(404).json({ error: 'Country not supported' });
      return;
    }
    const bankLists = (CONFIG as Record<string, unknown>).bankLists as Record<string, unknown[]> | undefined;
    res.json({ config: cc, banks: bankLists?.[code] || [] });
  });

  return router;
}
