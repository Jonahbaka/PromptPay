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
// ensureStripeCustomer moved inline as getOrCreateStripeCustomer to prevent duplicate customer creation
import { detectOperator, sendTopup, getOperatorById, getDataBundles, sendDataTopup } from '../providers/reloadly.js';
import {
  initiateCall, getCallRate, searchNumbers, orderNumber, listOwnedNumbers,
  releaseNumber, orderSimCards, listSimCards, activateSimCard, getSimCard,
  sendSms, aiInference, aiTranslate, getTelnyxBalance,
} from '../providers/telnyx.js';

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
    try {
      const { image } = req.body as { image?: string };
      if (!image || typeof image !== 'string') {
        console.log('[PROFILE-PIC] No image data received. Body keys:', Object.keys(req.body || {}));
        res.status(400).json({ error: 'Image data required (base64)' });
        return;
      }
      // Validate it's a data URL (image/png, image/jpeg, image/webp)
      if (!image.startsWith('data:image/')) {
        console.log('[PROFILE-PIC] Invalid format. Starts with:', image.substring(0, 30));
        res.status(400).json({ error: 'Invalid image format' });
        return;
      }
      // Limit to ~2MB base64 (a 1.5MB file becomes ~2MB in base64)
      if (image.length > 2.5 * 1024 * 1024) {
        res.status(400).json({ error: 'Image too large. Max 1.5MB' });
        return;
      }
      db.prepare('UPDATE users SET profile_picture = ?, updated_at = ? WHERE id = ?')
        .run(image, new Date().toISOString(), req.auth!.userId);
      console.log('[PROFILE-PIC] Saved for user', req.auth!.userId, '- size:', (image.length / 1024).toFixed(0), 'KB');
      res.json({ success: true });
    } catch (err) {
      console.error('[PROFILE-PIC] Error:', err);
      res.status(500).json({ error: 'Failed to save profile picture' });
    }
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
    const row = db.prepare('SELECT stripe_customer_id, email, display_name FROM users WHERE id = ?')
      .get(userId) as { stripe_customer_id: string | null; email: string; display_name: string | null } | undefined;

    // 1. If we have a stored customer ID, verify it's still valid and has payment methods
    if (row?.stripe_customer_id) {
      try {
        const existing = await stripeRequest(`/customers/${row.stripe_customer_id}`, null, 'GET');
        if (existing.id && !existing.deleted) {
          return row.stripe_customer_id;
        }
      } catch { /* customer may have been deleted, continue */ }
    }

    // 2. Search Stripe for any existing customer with this user's email (handles duplicates)
    if (row?.email) {
      try {
        const params = new URLSearchParams();
        params.set('email', row.email);
        params.set('limit', '10');
        const searchResult = await stripeRequest('/customers', params, 'GET');
        const customers = (searchResult.data || []) as Array<Record<string, unknown>>;

        // Find the customer that actually has payment methods attached
        let bestCustomer: string | null = null;
        for (const cust of customers) {
          if (cust.deleted) continue;
          const custId = cust.id as string;
          // Check if this customer has cards
          const pmParams = new URLSearchParams();
          pmParams.set('customer', custId);
          pmParams.set('type', 'card');
          pmParams.set('limit', '1');
          const pmResult = await stripeRequest('/payment_methods', pmParams, 'GET');
          const pmData = (pmResult.data || []) as Array<unknown>;
          if (pmData.length > 0) {
            bestCustomer = custId;
            break;
          }
          // If no best yet, use the first non-deleted customer
          if (!bestCustomer) bestCustomer = custId;
        }

        if (bestCustomer) {
          deps.logger.info(`[STRIPE] Found existing customer ${bestCustomer} for user ${userId} (${row.email})`);
          db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(bestCustomer, userId);
          return bestCustomer;
        }
      } catch (e) {
        deps.logger.warn(`[STRIPE] Error searching for existing customer: ${e}`);
      }
    }

    // 3. Create new customer only if none found
    const body = new URLSearchParams();
    body.set('metadata[userId]', userId);
    body.set('metadata[platform]', 'PromptPay');
    if (row?.email) body.set('email', row.email);
    if (row?.display_name) body.set('name', row.display_name);
    const customer = await stripeRequest('/customers', body);
    if (!customer.id) throw new Error('Failed to create Stripe customer');

    deps.logger.info(`[STRIPE] Created new customer ${customer.id} for user ${userId}`);
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

  // ── Paystack Public Key ──
  router.get('/api/config/paystack-key', (_req: Request, res: Response) => {
    const key = CONFIG.paystack.publicKey;
    if (!key) { res.status(503).json({ error: 'Paystack not configured' }); return; }
    res.json({ publicKey: key });
  });

  // ── Fund Wallet via Paystack (verify transaction + credit wallet) ──
  router.post('/api/wallet/fund-paystack', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { reference, amount: expectedAmount } = req.body as { reference: string; amount: number };

      if (!reference) { res.status(400).json({ error: 'Payment reference is required' }); return; }
      if (!CONFIG.paystack.secretKey) { res.status(503).json({ error: 'Paystack not configured' }); return; }

      // Check idempotency — don't credit twice for the same reference
      const existing = db.prepare('SELECT id FROM wallet_transactions WHERE reference = ?').get(reference);
      if (existing) {
        const wallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };
        res.json({ success: true, funded: expectedAmount, balance: wallet.balance, alreadyCredited: true });
        return;
      }

      // Verify the transaction with Paystack
      const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${CONFIG.paystack.secretKey}` },
        signal: AbortSignal.timeout(15000),
      });
      const verifyData = await verifyRes.json() as { status: boolean; data: { status: string; amount: number; currency: string; reference: string } };

      if (!verifyData.status || verifyData.data.status !== 'success') {
        res.status(400).json({ error: 'Payment not verified. Status: ' + (verifyData.data?.status || 'unknown') });
        return;
      }

      // Amount from Paystack is in kobo (smallest unit)
      const amount = verifyData.data.amount / 100;
      const now = new Date().toISOString();
      const txId = uuid();

      // Ensure wallet exists
      db.prepare(`
        INSERT INTO user_wallets (user_id, balance, currency, total_funded, total_spent, total_earned, is_agent, agent_tier, created_at, updated_at)
        VALUES (?, 0, 'NGN', 0, 0, 0, 0, 'starter', ?, ?)
        ON CONFLICT(user_id) DO NOTHING
      `).run(userId, now, now);

      // Credit wallet
      db.prepare(`
        UPDATE user_wallets SET balance = balance + ?, total_funded = total_funded + ?, updated_at = ? WHERE user_id = ?
      `).run(amount, amount, now, userId);

      const walletAfter = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

      // Record transaction
      db.prepare(`
        INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
        VALUES (?, ?, 'fund', ?, ?, ?, ?, ?)
      `).run(txId, userId, amount, walletAfter.balance, reference, `Wallet funding via Paystack`, now);

      deps.logger.info(`Wallet funded via Paystack for user ${userId}: ₦${amount} (ref: ${reference})`);

      res.json({
        success: true,
        funded: amount,
        balance: walletAfter.balance,
        transactionId: txId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Paystack fund error: ${msg}`);
      res.status(500).json({ error: 'Payment verification failed. Please contact support.' });
    }
  });

  // ── Add Payment Method ──
  router.post('/api/user/payment-methods', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { paymentMethodId } = req.body;
      deps.logger.info(`[CARD-ADD] User ${userId} adding payment method: ${paymentMethodId}`);

      if (!paymentMethodId) {
        deps.logger.warn(`[CARD-ADD] User ${userId} — missing paymentMethodId in request body`);
        res.status(400).json({ error: 'paymentMethodId is required' });
        return;
      }

      const customerId = await getOrCreateStripeCustomer(userId);
      deps.logger.info(`[CARD-ADD] User ${userId} — Stripe customer: ${customerId}`);

      // Attach payment method to customer
      const body = new URLSearchParams();
      body.set('customer', customerId);
      const result = await stripeRequest(`/payment_methods/${paymentMethodId}/attach`, body);

      if (result.error) {
        const errMsg = (result.error as Record<string, string>).message || 'Failed to add card';
        deps.logger.error(`[CARD-ADD] User ${userId} — Stripe error: ${errMsg} | Full: ${JSON.stringify(result.error)}`);
        res.status(400).json({ error: errMsg });
        return;
      }

      const card = result.card as Record<string, unknown> | undefined;
      deps.logger.info(`[CARD-ADD] User ${userId} — SUCCESS: ${result.id} ${card?.brand} ...${card?.last4} country=${card?.country}`);
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
      deps.logger.error(`[CARD-ADD] User ${req.auth!.userId} — EXCEPTION: ${msg}`);
      res.status(500).json({ error: 'Failed to add payment method' });
    }
  });

  // ── List Payment Methods ──
  router.get('/api/user/payment-methods', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const row = db.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
        .get(userId) as { stripe_customer_id: string | null } | undefined;

      if (!row?.stripe_customer_id) {
        deps.logger.info(`[CARDS-LIST] User ${userId} — no Stripe customer yet, returning empty`);
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

      deps.logger.info(`[CARDS-LIST] User ${userId} — found ${methods.length} cards: ${methods.map(m => `${m.brand}...${m.last4}`).join(', ') || 'none'}`);
      res.json({ methods });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[CARDS-LIST] User ${req.auth!.userId} — EXCEPTION: ${msg}`);
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

  // ══════════════════════════════════════════════════════════
  // WALLET — Fund & Balance
  // ══════════════════════════════════════════════════════════

  /** Get or create wallet */
  router.get('/api/wallet/balance', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      let wallet = db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;

      if (!wallet) {
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO user_wallets (user_id, balance, currency, total_funded, total_spent, total_earned, is_agent, agent_tier, created_at, updated_at)
          VALUES (?, 0, 'NGN', 0, 0, 0, 0, 'starter', ?, ?)
        `).run(userId, now, now);
        wallet = db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as Record<string, unknown>;
      }

      // Today's POS stats
      const today = new Date().toISOString().slice(0, 10);
      const todayStats = db.prepare(`
        SELECT COUNT(*) as sales_count,
               COALESCE(SUM(face_value), 0) as total_sales,
               COALESCE(SUM(agent_profit), 0) as total_profit
        FROM pos_transactions
        WHERE agent_user_id = ? AND status = 'completed' AND created_at >= ?
      `).get(userId, today + 'T00:00:00') as { sales_count: number; total_sales: number; total_profit: number };

      res.json({
        balance: wallet!.balance,
        currency: wallet!.currency,
        isAgent: wallet!.is_agent === 1,
        agentTier: wallet!.agent_tier,
        totalFunded: wallet!.total_funded,
        totalSpent: wallet!.total_spent,
        totalEarned: wallet!.total_earned,
        today: {
          salesCount: todayStats.sales_count,
          totalSales: todayStats.total_sales,
          totalProfit: todayStats.total_profit,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Wallet balance error: ${msg}`);
      res.status(500).json({ error: 'Failed to get wallet balance' });
    }
  });

  /** Fund wallet via Stripe card charge */
  router.post('/api/wallet/fund', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      deps.logger.info(`[FUND] User ${userId} — request body: ${JSON.stringify(req.body)}`);
      const { amount, paymentMethodId } = req.body as { amount: number; paymentMethodId?: string };

      if (!amount || amount < 100) {
        deps.logger.warn(`[FUND] User ${userId} — rejected: amount=${amount} (min 100)`);
        res.status(400).json({ error: 'Minimum funding amount is ₦100' });
        return;
      }
      if (amount > 5000000) {
        deps.logger.warn(`[FUND] User ${userId} — rejected: amount=${amount} (max 5M)`);
        res.status(400).json({ error: 'Maximum single funding is ₦5,000,000' });
        return;
      }

      deps.logger.info(`[FUND] User ${userId} — amount=${amount} NGN, paymentMethodId=${paymentMethodId || 'NONE'}`);
      const customerId = await getOrCreateStripeCustomer(userId);
      deps.logger.info(`[FUND] User ${userId} — Stripe customer: ${customerId}`);

      // Create payment intent for the wallet funding
      const amountKobo = Math.round(amount * 100); // Stripe uses smallest currency unit
      const piBody = new URLSearchParams();
      piBody.set('amount', String(amountKobo));
      piBody.set('currency', 'ngn');
      piBody.set('customer', customerId);
      piBody.set('description', `PromptPay Wallet Funding - ${amount} NGN`);
      piBody.set('metadata[type]', 'wallet_fund');
      piBody.set('metadata[userId]', userId);

      if (paymentMethodId) {
        piBody.set('payment_method', paymentMethodId);
        piBody.set('confirm', 'true');
        piBody.set('return_url', `${CONFIG.platform.domainUrl || 'https://www.upromptpay.com'}/?wallet_funded=true`);
      } else {
        piBody.set('automatic_payment_methods[enabled]', 'true');
        piBody.set('automatic_payment_methods[allow_redirects]', 'never');
        piBody.set('confirm', 'false');
      }

      deps.logger.info(`[FUND] User ${userId} — creating PaymentIntent: amount=${amountKobo} kobo, currency=ngn, pm=${paymentMethodId || 'auto'}`);
      const pi = await stripeRequest('/payment_intents', piBody);
      deps.logger.info(`[FUND] User ${userId} — PaymentIntent response: id=${pi.id} status=${pi.status} error=${pi.error ? JSON.stringify(pi.error) : 'none'}`);

      if (pi.error) {
        const stripeErr = pi.error as Record<string, unknown>;
        const errMsg = (stripeErr.message as string) || JSON.stringify(pi.error);
        const declineCode = stripeErr.decline_code as string || '';
        const errCode = stripeErr.code as string || '';
        deps.logger.error(`[FUND] User ${userId} — Stripe REJECTED PaymentIntent: ${errMsg} code=${errCode} decline=${declineCode}`);

        // Give user-friendly messages for common decline reasons
        let userMessage = errMsg;
        if (errCode === 'card_declined') {
          if (declineCode === 'insufficient_funds') {
            userMessage = 'Insufficient funds on your card. Please check your balance and try again.';
          } else if (declineCode === 'try_again_later') {
            userMessage = 'Your bank temporarily declined the charge. Please wait a few minutes and try again, or contact your bank to enable online payments.';
          } else {
            userMessage = 'Your card was declined. This may happen with some Nigerian debit cards for international transactions. Please contact your bank to enable online/international payments, or try a different card.';
          }
        } else if (errCode === 'expired_card') {
          userMessage = 'Your card has expired. Please add a new card.';
        } else if (errCode === 'incorrect_cvc') {
          userMessage = 'Card security code (CVC) was incorrect. Please remove this card and add it again.';
        }

        res.status(400).json({ error: userMessage });
        return;
      }

      if (pi.status === 'succeeded') {
        deps.logger.info(`[FUND] User ${userId} — PaymentIntent SUCCEEDED, crediting wallet +${amount} NGN`);
        // Credit wallet immediately
        const now = new Date().toISOString();
        const txId = uuid();

        // Ensure wallet exists
        db.prepare(`
          INSERT INTO user_wallets (user_id, balance, currency, total_funded, total_spent, total_earned, is_agent, agent_tier, created_at, updated_at)
          VALUES (?, 0, 'NGN', 0, 0, 0, 0, 'starter', ?, ?)
          ON CONFLICT(user_id) DO NOTHING
        `).run(userId, now, now);

        db.prepare(`
          UPDATE user_wallets
          SET balance = balance + ?, total_funded = total_funded + ?, updated_at = ?
          WHERE user_id = ?
        `).run(amount, amount, now, userId);

        const walletAfter = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

        db.prepare(`
          INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
          VALUES (?, ?, 'fund', ?, ?, ?, ?, ?)
        `).run(txId, userId, amount, walletAfter.balance, pi.id as string, `Wallet funding via card`, now);

        deps.logger.info(`[FUND] User ${userId} — wallet credited! balance=${walletAfter.balance} txId=${txId}`);
        res.json({
          success: true,
          funded: amount,
          balance: walletAfter.balance,
          transactionId: txId,
          stripePaymentId: pi.id,
        });
      } else if (pi.status === 'requires_action' || pi.status === 'requires_confirmation') {
        deps.logger.info(`[FUND] User ${userId} — PaymentIntent requires 3DS/action: status=${pi.status} pi=${pi.id}`);
        // Return client_secret for frontend confirmation
        res.json({
          success: false,
          requiresAction: true,
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
          status: pi.status,
        });
      } else {
        deps.logger.warn(`[FUND] User ${userId} — unexpected PaymentIntent status: ${pi.status} pi=${pi.id}`);
        res.json({
          success: false,
          requiresAction: true,
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
          status: pi.status,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[FUND] User ${req.auth!.userId} — EXCEPTION: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  /** Confirm wallet funding after 3DS or card action */
  router.post('/api/wallet/fund/confirm', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { paymentIntentId } = req.body as { paymentIntentId: string };
      deps.logger.info(`[FUND-CONFIRM] User ${userId} — confirming pi=${paymentIntentId}`);

      const pi = await stripeRequest(`/payment_intents/${paymentIntentId}`, null, 'GET');
      deps.logger.info(`[FUND-CONFIRM] User ${userId} — PI status=${pi.status} amount=${pi.amount}`);

      if (pi.status !== 'succeeded') {
        deps.logger.warn(`[FUND-CONFIRM] User ${userId} — payment NOT succeeded: status=${pi.status} pi=${paymentIntentId}`);
        res.status(400).json({ error: 'Payment not completed', status: pi.status });
        return;
      }

      // Check if already credited (idempotency)
      const existing = db.prepare('SELECT id FROM wallet_transactions WHERE reference = ?').get(paymentIntentId as string);
      if (existing) {
        const wallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };
        res.json({ success: true, balance: wallet.balance, alreadyCredited: true });
        return;
      }

      const amount = (pi.amount as number) / 100; // Convert from kobo
      const now = new Date().toISOString();
      const txId = uuid();

      db.prepare(`
        INSERT INTO user_wallets (user_id, balance, currency, total_funded, total_spent, total_earned, is_agent, agent_tier, created_at, updated_at)
        VALUES (?, 0, 'NGN', 0, 0, 0, 0, 'starter', ?, ?)
        ON CONFLICT(user_id) DO NOTHING
      `).run(userId, now, now);

      db.prepare(`
        UPDATE user_wallets SET balance = balance + ?, total_funded = total_funded + ?, updated_at = ? WHERE user_id = ?
      `).run(amount, amount, now, userId);

      const walletAfter = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

      db.prepare(`
        INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
        VALUES (?, ?, 'fund', ?, ?, ?, ?, ?)
      `).run(txId, userId, amount, walletAfter.balance, paymentIntentId, 'Wallet funding via card', now);

      res.json({ success: true, funded: amount, balance: walletAfter.balance, transactionId: txId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Wallet confirm error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  /** Wallet transaction history */
  router.get('/api/wallet/transactions', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const limit = parseInt(String(req.query.limit || '50'));
      const txs = db.prepare(
        'SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(userId, limit);
      res.json({ transactions: txs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ══════════════════════════════════════════════════════════
  // POS — Airtime/Data Resale
  // ══════════════════════════════════════════════════════════

  /** POS: Sell airtime — debit wallet, call Reloadly, track profit */
  router.post('/api/pos/sell', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { phoneNumber, amount, countryCode, productType } = req.body as {
        phoneNumber: string;
        amount: number;
        countryCode?: string;
        productType?: 'airtime' | 'data';
      };

      if (!phoneNumber || !amount || amount <= 0) {
        res.status(400).json({ error: 'phoneNumber and positive amount are required' });
        return;
      }

      const country = (countryCode || 'NG').toUpperCase();
      const type = productType || 'airtime';

      if (!CONFIG.reloadly.clientId) {
        res.status(503).json({ error: 'Reloadly not configured' });
        return;
      }

      // 1. Check wallet balance
      const wallet = db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
      if (!wallet || (wallet.balance as number) < amount) {
        res.status(400).json({
          error: 'Insufficient wallet balance',
          balance: wallet?.balance || 0,
          required: amount,
        });
        return;
      }

      // 2. Auto-detect carrier
      let operatorId: number;
      let carrierName: string;
      try {
        const detected = await detectOperator(phoneNumber, country);
        operatorId = detected.operatorId;
        carrierName = detected.name;
      } catch {
        res.status(400).json({ error: 'Could not detect carrier. Check the phone number.' });
        return;
      }

      // 3. Get REAL discount from Reloadly operator data + configurable platform fee
      let discountPercent = 0.03; // fallback 3% if API fails
      try {
        const opData = await getOperatorById(operatorId);
        // Reloadly returns discount as a percentage value (e.g. 5 for 5%)
        const intlDiscount = opData.internationalDiscount as number | undefined;
        const localDiscount = opData.localDiscount as number | undefined;
        const realDiscount = (localDiscount || intlDiscount || 3);
        discountPercent = Math.max(0, Math.min(realDiscount, 50)) / 100; // clamp 0-50%, convert to decimal
      } catch { /* use fallback */ }

      // Read configurable platform fee from DB (default 1%)
      const feeRow = db.prepare("SELECT value FROM platform_settings WHERE key = 'pos_platform_fee_pct'").get() as { value: string } | undefined;
      const platformFeePct = parseFloat(feeRow?.value || '1') / 100;

      const costPrice = Math.round(amount * (1 - discountPercent) * 100) / 100;
      const platformFee = Math.round(amount * platformFeePct * 100) / 100;
      const agentProfit = Math.round((amount - costPrice - platformFee) * 100) / 100;

      const txId = uuid();
      const now = new Date().toISOString();

      // 4. Debit wallet FULL FACE VALUE (agent's profit comes from cash markup they charge customers)
      db.prepare(`
        UPDATE user_wallets SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ? WHERE user_id = ?
      `).run(amount, amount, now, userId);

      const walletAfter = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

      // Record wallet debit
      db.prepare(`
        INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
        VALUES (?, ?, 'debit', ?, ?, ?, ?, ?)
      `).run(uuid(), userId, amount, walletAfter.balance, txId, `POS ${type}: ${carrierName} ₦${amount} to ${phoneNumber}`, now);

      // 5. Insert POS transaction (pending)
      db.prepare(`
        INSERT INTO pos_transactions (id, agent_user_id, customer_phone, carrier, product_type, face_value, cost_price, agent_profit, platform_fee, currency, country, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'NGN', ?, 'pending', ?)
      `).run(txId, userId, phoneNumber, carrierName, type, amount, costPrice, agentProfit, platformFee, country, now);

      // 6. Call Reloadly
      try {
        const result = await sendTopup({ operatorId, amount, phoneNumber, countryCode: country });

        if (result.success) {
          // Mark completed
          db.prepare(`
            UPDATE pos_transactions SET status = 'completed', reloadly_tx_id = ?, reloadly_operator_id = ?, completed_at = ? WHERE id = ?
          `).run(String(result.transactionId), operatorId, now, txId);

          // No wallet credit — agent's profit is the cash markup they charge customers on top
          // Platform profit = face value (debited from wallet) minus Reloadly cost (what we actually pay)

          res.json({
            success: true,
            transactionId: txId,
            carrier: carrierName,
            phoneNumber,
            faceValue: amount,
            walletBalance: walletAfter.balance,
            reloadlyTxId: result.transactionId,
          });
        } else {
          // REFUND — top-up failed
          db.prepare(`UPDATE pos_transactions SET status = 'failed', error_message = ? WHERE id = ?`).run(result.error || 'Unknown error', txId);

          // Refund wallet (full face value, since that's what we debited)
          db.prepare(`UPDATE user_wallets SET balance = balance + ?, total_spent = total_spent - ?, updated_at = ? WHERE user_id = ?`).run(amount, amount, now, userId);

          const refundWallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

          db.prepare(`
            INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
            VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)
          `).run(uuid(), userId, amount, refundWallet.balance, txId, `Refund: failed ${type} to ${phoneNumber}`, now);

          res.status(400).json({
            success: false,
            error: result.error || 'Top-up failed at carrier',
            walletBalance: refundWallet.balance,
            refunded: true,
          });
        }
      } catch (reloadlyErr) {
        // Network error — refund full face value
        const errMsg = reloadlyErr instanceof Error ? reloadlyErr.message : String(reloadlyErr);
        db.prepare(`UPDATE pos_transactions SET status = 'failed', error_message = ? WHERE id = ?`).run(errMsg, txId);
        db.prepare(`UPDATE user_wallets SET balance = balance + ?, total_spent = total_spent - ?, updated_at = ? WHERE user_id = ?`).run(amount, amount, now, userId);

        const refundWallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };
        db.prepare(`
          INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
          VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)
        `).run(uuid(), userId, amount, refundWallet.balance, txId, `Refund: error ${type} to ${phoneNumber}`, now);

        deps.logger.error(`POS Reloadly error: ${errMsg}`);
        res.status(500).json({ success: false, error: errMsg, walletBalance: refundWallet.balance, refunded: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`POS sell error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  /** POS: Dashboard — today's stats, recent sales, wallet */
  router.get('/api/pos/dashboard', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const today = new Date().toISOString().slice(0, 10);

      // Wallet
      const wallet = db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;

      // Today's stats
      const todayStats = db.prepare(`
        SELECT COUNT(*) as count,
               COALESCE(SUM(face_value), 0) as sales,
               COALESCE(SUM(agent_profit), 0) as profit,
               COALESCE(SUM(cost_price), 0) as cost
        FROM pos_transactions
        WHERE agent_user_id = ? AND status = 'completed' AND created_at >= ?
      `).get(userId, today + 'T00:00:00') as Record<string, number>;

      // This week
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const weekStats = db.prepare(`
        SELECT COUNT(*) as count,
               COALESCE(SUM(face_value), 0) as sales,
               COALESCE(SUM(agent_profit), 0) as profit
        FROM pos_transactions
        WHERE agent_user_id = ? AND status = 'completed' AND created_at >= ?
      `).get(userId, weekAgo) as Record<string, number>;

      // All-time
      const allTimeStats = db.prepare(`
        SELECT COUNT(*) as count,
               COALESCE(SUM(face_value), 0) as sales,
               COALESCE(SUM(agent_profit), 0) as profit
        FROM pos_transactions
        WHERE agent_user_id = ? AND status = 'completed'
      `).get(userId) as Record<string, number>;

      // Recent 20 transactions
      const recent = db.prepare(`
        SELECT id, customer_phone, carrier, product_type, face_value, agent_profit, status, created_at
        FROM pos_transactions
        WHERE agent_user_id = ?
        ORDER BY created_at DESC LIMIT 20
      `).all(userId);

      res.json({
        wallet: {
          balance: wallet?.balance || 0,
          currency: wallet?.currency || 'NGN',
          totalFunded: wallet?.total_funded || 0,
          totalSpent: wallet?.total_spent || 0,
          totalEarned: wallet?.total_earned || 0,
          isAgent: wallet?.is_agent === 1,
          agentTier: wallet?.agent_tier || 'starter',
        },
        today: { count: todayStats.count, sales: todayStats.sales, profit: todayStats.profit },
        week: { count: weekStats.count, sales: weekStats.sales, profit: weekStats.profit },
        allTime: { count: allTimeStats.count, sales: allTimeStats.sales, profit: allTimeStats.profit },
        recentSales: recent,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`POS dashboard error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  /** POS: Sales history with filters */
  router.get('/api/pos/sales', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const limit = parseInt(String(req.query.limit || '50'));
      const status = req.query.status as string | undefined;
      const date = req.query.date as string | undefined; // YYYY-MM-DD

      let sql = 'SELECT * FROM pos_transactions WHERE agent_user_id = ?';
      const params: unknown[] = [userId];

      if (status) { sql += ' AND status = ?'; params.push(status); }
      if (date) { sql += ' AND created_at >= ? AND created_at < ?'; params.push(date + 'T00:00:00', date + 'T23:59:59'); }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit);

      const sales = db.prepare(sql).all(...params);
      res.json({ sales });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** POS: Detect carrier from phone number */
  router.get('/api/pos/detect-carrier', authenticate, async (req: Request, res: Response) => {
    try {
      const phone = String(req.query.phone || '');
      const country = String(req.query.country || 'NG').toUpperCase();

      if (!phone || phone.length < 10) {
        res.status(400).json({ error: 'Valid phone number required' });
        return;
      }

      if (!CONFIG.reloadly.clientId) {
        res.status(503).json({ error: 'Reloadly not configured' });
        return;
      }

      const detected = await detectOperator(phone, country);

      // Also fetch real discount for accurate pricing preview
      let discountPct = 3; // fallback
      try {
        const opData = await getOperatorById(detected.operatorId);
        const localDiscount = opData.localDiscount as number | undefined;
        const intlDiscount = opData.internationalDiscount as number | undefined;
        discountPct = Math.max(0, Math.min(localDiscount || intlDiscount || 3, 50));
      } catch { /* use fallback */ }

      const feeRow = db.prepare("SELECT value FROM platform_settings WHERE key = 'pos_platform_fee_pct'").get() as { value: string } | undefined;
      const platformFeePct = parseFloat(feeRow?.value || '1');

      res.json({
        carrier: detected.name,
        operatorId: detected.operatorId,
        discountPct,
        platformFeePct,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: 'Could not detect carrier', details: msg });
    }
  });

  /** POS: List data bundles for a carrier */
  router.get('/api/pos/data-bundles', authenticate, async (req: Request, res: Response) => {
    try {
      const operatorId = parseInt(String(req.query.operatorId || '0'));
      if (!operatorId) {
        res.status(400).json({ error: 'operatorId required — detect carrier first' });
        return;
      }
      const bundles = await getDataBundles(operatorId);
      // Return sorted by price, with useful fields
      const formatted = bundles.map(b => ({
        id: b.id,
        name: b.name || b.description || `${b.dataAmount}${b.dataUnit}`,
        description: b.description,
        price: b.localAmount || b.amount,
        currency: b.localCurrencyCode || b.currencyCode || 'NGN',
        dataAmount: b.dataAmount,
        dataUnit: b.dataUnit,
        validity: b.validity,
        validityUnit: b.validityUnit,
      })).sort((a, b) => ((a.price as number) || 0) - ((b.price as number) || 0));
      res.json({ bundles: formatted, operatorId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: 'Could not load data bundles', details: msg });
    }
  });

  /** POS: Sell data bundle */
  router.post('/api/pos/sell-data', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { phoneNumber, amount, countryCode, operatorId, dataBundleId, bundleName } = req.body as {
        phoneNumber: string;
        amount: number;
        countryCode?: string;
        operatorId: number;
        dataBundleId: number;
        bundleName?: string;
      };

      if (!phoneNumber || !amount || !operatorId) {
        res.status(400).json({ error: 'phoneNumber, amount, and operatorId required' });
        return;
      }

      const country = (countryCode || 'NG').toUpperCase();

      // Check wallet balance (debit full face value)
      const wallet = db.prepare('SELECT * FROM user_wallets WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
      if (!wallet || (wallet.balance as number) < amount) {
        res.status(400).json({ error: 'Insufficient wallet balance', balance: wallet?.balance || 0, required: amount });
        return;
      }

      // Get carrier name
      let carrierName = bundleName || 'Data';
      try {
        const opData = await getOperatorById(operatorId);
        carrierName = (opData.name as string) || carrierName;
      } catch { /* use fallback */ }

      const txId = uuid();
      const now = new Date().toISOString();

      // Read platform fee
      const feeRow = db.prepare("SELECT value FROM platform_settings WHERE key = 'pos_platform_fee_pct'").get() as { value: string } | undefined;
      const platformFeePct = parseFloat(feeRow?.value || '1') / 100;

      // Get real discount
      let discountPercent = 0.03;
      try {
        const opData = await getOperatorById(operatorId);
        const localDiscount = opData.localDiscount as number | undefined;
        const intlDiscount = opData.internationalDiscount as number | undefined;
        discountPercent = Math.max(0, Math.min(localDiscount || intlDiscount || 3, 50)) / 100;
      } catch { /* fallback */ }

      const costPrice = Math.round(amount * (1 - discountPercent) * 100) / 100;
      const platformFee = Math.round(amount * platformFeePct * 100) / 100;
      const agentProfit = Math.round((amount - costPrice - platformFee) * 100) / 100;

      // Debit wallet full face value
      db.prepare(`UPDATE user_wallets SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ? WHERE user_id = ?`).run(amount, amount, now, userId);
      const walletAfter = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

      db.prepare(`
        INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at)
        VALUES (?, ?, 'debit', ?, ?, ?, ?, ?)
      `).run(uuid(), userId, amount, walletAfter.balance, txId, `POS data: ${carrierName} ₦${amount} to ${phoneNumber}`, now);

      // Record POS transaction
      db.prepare(`
        INSERT INTO pos_transactions (id, agent_user_id, customer_phone, carrier, product_type, face_value, cost_price, agent_profit, platform_fee, currency, country, status, created_at)
        VALUES (?, ?, ?, ?, 'data', ?, ?, ?, ?, 'NGN', ?, 'pending', ?)
      `).run(txId, userId, phoneNumber, carrierName, amount, costPrice, agentProfit, platformFee, country, now);

      // Call Reloadly
      try {
        const result = await sendDataTopup({ operatorId, dataBundleId, amount, phoneNumber, countryCode: country });

        if (result.success) {
          db.prepare(`UPDATE pos_transactions SET status = 'completed', reloadly_tx_id = ?, reloadly_operator_id = ?, completed_at = ? WHERE id = ?`)
            .run(String(result.transactionId), operatorId, now, txId);

          res.json({ success: true, transactionId: txId, carrier: carrierName, phoneNumber, faceValue: amount, walletBalance: walletAfter.balance });
        } else {
          // Refund
          db.prepare(`UPDATE pos_transactions SET status = 'failed', error_message = ? WHERE id = ?`).run(result.error || 'Unknown error', txId);
          db.prepare(`UPDATE user_wallets SET balance = balance + ?, total_spent = total_spent - ?, updated_at = ? WHERE user_id = ?`).run(amount, amount, now, userId);
          const refundWallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };
          db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)`)
            .run(uuid(), userId, amount, refundWallet.balance, txId, `Refund: failed data to ${phoneNumber}`, now);
          res.status(400).json({ success: false, error: result.error, walletBalance: refundWallet.balance, refunded: true });
        }
      } catch (reloadlyErr) {
        const errMsg = reloadlyErr instanceof Error ? reloadlyErr.message : String(reloadlyErr);
        db.prepare(`UPDATE pos_transactions SET status = 'failed', error_message = ? WHERE id = ?`).run(errMsg, txId);
        db.prepare(`UPDATE user_wallets SET balance = balance + ?, total_spent = total_spent - ?, updated_at = ? WHERE user_id = ?`).run(amount, amount, now, userId);
        const refundWallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };
        db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at) VALUES (?, ?, 'refund', ?, ?, ?, ?, ?)`)
          .run(uuid(), userId, amount, refundWallet.balance, txId, `Refund: error data to ${phoneNumber}`, now);
        res.status(500).json({ success: false, error: errMsg, walletBalance: refundWallet.balance, refunded: true });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`POS sell-data error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // ══════════════════════════════════════════════════════════
  // INTERNATIONAL CALLING (Telnyx)
  // ══════════════════════════════════════════════════════════

  /** Get rate for a destination number */
  router.get('/api/calls/rate', authenticate, async (req: Request, res: Response) => {
    try {
      const destination = String(req.query.destination || '');
      if (!destination || destination.length < 5) {
        res.status(400).json({ error: 'Valid destination number required (E.164 format)' });
        return;
      }
      const rate = await getCallRate(destination);
      // Convert USD rate to NGN for display (rough rate)
      const usdToNgn = 1600; // approximate
      const rateNgn = parseFloat(rate.rate || '0.15') * usdToNgn;
      res.json({
        destination,
        rate: rate.rate || '0.15',
        country: rate.country || 'International',
        currency: rate.currency || 'USD',
        ratePerMinUsd: parseFloat(rate.rate || '0.15'),
        ratePerMinNgn: Math.round(rateNgn * 100) / 100,
        retailRateNgn: Math.round(rateNgn * 1.5 * 100) / 100, // 50% markup = our sell rate
      });
    } catch (err) {
      res.status(500).json({ error: 'Rate lookup failed' });
    }
  });

  /** Initiate an international call (debits wallet) */
  router.post('/api/calls/dial', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { destination } = req.body as { destination: string };

      if (!destination) {
        res.status(400).json({ error: 'destination number required (E.164 format)' });
        return;
      }

      if (!CONFIG.telnyx.apiKey) {
        res.status(503).json({ error: 'Calling service not configured' });
        return;
      }

      // Get rate
      const rate = await getCallRate(destination);
      const costPerMinUsd = parseFloat(rate.rate || '0.15');
      const usdToNgn = 1600;
      const retailPerMinNgn = Math.round(costPerMinUsd * usdToNgn * 1.5); // 50% markup

      // Check wallet has at least 5 minutes worth
      const minBalance = retailPerMinNgn * 5;
      const wallet = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number } | undefined;
      if (!wallet || wallet.balance < minBalance) {
        res.status(400).json({
          error: `Minimum wallet balance of ₦${minBalance} required (5 min at ₦${retailPerMinNgn}/min)`,
          balance: wallet?.balance || 0,
          required: minBalance,
        });
        return;
      }

      // Detect country from number
      const countryCodes: Record<string, string> = {
        '+234': 'NG', '+233': 'GH', '+254': 'KE', '+27': 'ZA',
        '+255': 'TZ', '+256': 'UG', '+237': 'CM', '+221': 'SN',
        '+251': 'ET', '+1': 'US', '+44': 'UK', '+91': 'IN',
      };
      let destCountry = 'Unknown';
      for (const [prefix, country] of Object.entries(countryCodes)) {
        if (destination.startsWith(prefix)) { destCountry = country; break; }
      }

      const callId = uuid();
      const now = new Date().toISOString();

      // Log the call
      db.prepare(`
        INSERT INTO call_log (id, user_id, direction, destination, destination_country, cost_usd, charge_amount, charge_currency, status, created_at)
        VALUES (?, ?, 'outbound', ?, ?, ?, ?, 'NGN', 'initiated', ?)
      `).run(callId, userId, destination, destCountry, costPerMinUsd, retailPerMinNgn, now);

      // Initiate via Telnyx
      const result = await initiateCall({
        to: destination,
        clientState: JSON.stringify({ callId, userId }),
      });

      if (result.success) {
        db.prepare(`UPDATE call_log SET telnyx_call_id = ?, status = 'ringing' WHERE id = ?`)
          .run(result.callControlId, callId);

        res.json({
          success: true,
          callId,
          callControlId: result.callControlId,
          destination,
          country: destCountry,
          ratePerMinNgn: retailPerMinNgn,
        });
      } else {
        db.prepare(`UPDATE call_log SET status = 'failed' WHERE id = ?`).run(callId);
        res.status(400).json({ success: false, error: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Call dial error: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  /** End a call and charge the user */
  router.post('/api/calls/hangup', authenticate, async (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const { callId } = req.body as { callId: string };

      const call = db.prepare('SELECT * FROM call_log WHERE id = ? AND user_id = ?').get(callId, userId) as Record<string, unknown> | undefined;
      if (!call) { res.status(404).json({ error: 'Call not found' }); return; }

      const now = new Date().toISOString();
      const startedAt = new Date(call.created_at as string).getTime();
      const durationSecs = Math.ceil((Date.now() - startedAt) / 1000);
      const durationMins = Math.ceil(durationSecs / 60);
      const chargePerMin = call.charge_amount as number;
      const totalCharge = durationMins * chargePerMin;

      // Debit wallet
      db.prepare(`UPDATE user_wallets SET balance = balance - ?, total_spent = total_spent + ?, updated_at = ? WHERE user_id = ?`)
        .run(totalCharge, totalCharge, now, userId);
      const walletAfter = db.prepare('SELECT balance FROM user_wallets WHERE user_id = ?').get(userId) as { balance: number };

      db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, reference, description, created_at) VALUES (?, ?, 'debit', ?, ?, ?, ?, ?)`)
        .run(uuid(), userId, totalCharge, walletAfter.balance, callId, `Call to ${call.destination} (${durationMins} min)`, now);

      db.prepare(`UPDATE call_log SET status = 'completed', duration_seconds = ?, ended_at = ? WHERE id = ?`)
        .run(durationSecs, now, callId);

      res.json({
        success: true,
        callId,
        durationSeconds: durationSecs,
        durationMinutes: durationMins,
        charged: totalCharge,
        walletBalance: walletAfter.balance,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** Call history */
  router.get('/api/calls/history', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const calls = db.prepare('SELECT * FROM call_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId);
    res.json({ calls });
  });

  // ══════════════════════════════════════════════════════════
  // IN-APP CHAT (Free — P2P messaging)
  // ══════════════════════════════════════════════════════════

  /** Send a chat message */
  router.post('/api/chat/send', authenticate, (req: Request, res: Response) => {
    try {
      const senderId = req.auth!.userId;
      const { recipientId, message, messageType } = req.body as {
        recipientId: string; message: string; messageType?: string;
      };

      if (!recipientId || !message) {
        res.status(400).json({ error: 'recipientId and message required' });
        return;
      }

      // Verify recipient exists
      const recipient = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(recipientId) as { id: string; display_name: string } | undefined;
      if (!recipient) { res.status(404).json({ error: 'Recipient not found' }); return; }

      const msgId = uuid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO chat_messages (id, sender_id, recipient_id, message, message_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(msgId, senderId, recipientId, message, messageType || 'text', now);

      res.json({ success: true, messageId: msgId, timestamp: now });
    } catch (err) {
      res.status(500).json({ error: 'Failed to send message' });
    }
  });

  /** Get conversation with a user */
  router.get('/api/chat/conversation/:userId', authenticate, (req: Request, res: Response) => {
    const myId = req.auth!.userId;
    const otherId = req.params.userId;
    const limit = parseInt(String(req.query.limit || '50'));

    const messages = db.prepare(`
      SELECT * FROM chat_messages
      WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
      ORDER BY created_at DESC LIMIT ?
    `).all(myId, otherId, otherId, myId, limit);

    // Mark as read
    db.prepare(`UPDATE chat_messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL`)
      .run(new Date().toISOString(), myId, otherId);

    res.json({ messages: (messages as Array<Record<string, unknown>>).reverse() });
  });

  /** List recent conversations */
  router.get('/api/chat/conversations', authenticate, (req: Request, res: Response) => {
    const myId = req.auth!.userId;

    const conversations = db.prepare(`
      SELECT
        CASE WHEN sender_id = ? THEN recipient_id ELSE sender_id END as other_user_id,
        MAX(created_at) as last_message_at,
        COUNT(CASE WHEN recipient_id = ? AND read_at IS NULL THEN 1 END) as unread_count
      FROM chat_messages
      WHERE sender_id = ? OR recipient_id = ?
      GROUP BY other_user_id
      ORDER BY last_message_at DESC
      LIMIT 50
    `).all(myId, myId, myId, myId) as Array<Record<string, unknown>>;

    // Enrich with user info
    const enriched = conversations.map(c => {
      const user = db.prepare('SELECT id, display_name, email, profile_picture FROM users WHERE id = ?')
        .get(c.other_user_id as string) as Record<string, unknown> | undefined;
      const lastMsg = db.prepare(`
        SELECT message, message_type, sender_id, created_at FROM chat_messages
        WHERE (sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?)
        ORDER BY created_at DESC LIMIT 1
      `).get(myId, c.other_user_id as string, c.other_user_id as string, myId) as Record<string, unknown> | undefined;

      return {
        userId: c.other_user_id,
        name: user?.display_name || user?.email || 'Unknown',
        profilePicture: user?.profile_picture,
        lastMessage: lastMsg?.message,
        lastMessageType: lastMsg?.message_type,
        lastMessageAt: c.last_message_at,
        unreadCount: c.unread_count,
        isMine: lastMsg?.sender_id === myId,
      };
    });

    res.json({ conversations: enriched });
  });

  /** Search users (for starting new chats / adding contacts) */
  router.get('/api/users/search', authenticate, (req: Request, res: Response) => {
    const query = String(req.query.q || '').trim();
    if (query.length < 2) { res.json({ users: [] }); return; }

    const users = db.prepare(`
      SELECT id, display_name, email, profile_picture, paytag FROM users
      WHERE (display_name LIKE ? OR email LIKE ? OR paytag LIKE ?) AND id != ?
      LIMIT 20
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, req.auth!.userId) as Array<Record<string, unknown>>;

    res.json({
      users: users.map(u => ({
        id: u.id,
        name: u.display_name,
        email: u.email,
        profilePicture: u.profile_picture,
        paytag: u.paytag,
      })),
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TELNYX SERVICES — Virtual Numbers, SIMs, SMS, AI
  // ═══════════════════════════════════════════════════════════════

  // ── Virtual Numbers ──

  /** Search available numbers */
  router.get('/api/numbers/search', authenticate, async (req: Request, res: Response) => {
    try {
      const countryCode = String(req.query.country || 'US');
      const numberType = (req.query.type as string) || undefined;
      const limit = parseInt(String(req.query.limit || '10'));
      const result = await searchNumbers({ countryCode, numberType: numberType as 'local' | 'toll_free', limit });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Failed to search numbers' });
    }
  });

  /** Purchase a number */
  router.post('/api/numbers/buy', authenticate, async (req: Request, res: Response) => {
    try {
      const { phoneNumber, countryCode } = req.body;
      if (!phoneNumber) { res.status(400).json({ error: 'Phone number is required' }); return; }

      // Charge user's wallet $2 for a virtual number (platform markup)
      const numberFeeUsd = 2.00;
      const wallet = db.prepare(`SELECT balance FROM wallet WHERE user_id = ?`).get(req.auth!.userId) as Record<string, unknown> | undefined;
      const balance = parseFloat(String(wallet?.balance || '0'));
      if (balance < numberFeeUsd) {
        res.status(400).json({
          error: `Insufficient wallet balance. Virtual numbers cost $${numberFeeUsd.toFixed(2)}/mo. Your balance: $${balance.toFixed(2)}. Fund your wallet first.`,
          required: numberFeeUsd,
          balance,
        });
        return;
      }

      // Order from Telnyx
      const result = await orderNumber({ phoneNumber });
      if (!result.success) {
        res.status(400).json({ error: result.error || 'Telnyx could not provision this number. Try a different one.' });
        return;
      }

      // Debit wallet
      db.prepare(`UPDATE wallet SET balance = balance - ? WHERE user_id = ?`).run(numberFeeUsd, req.auth!.userId);
      db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, description, created_at) VALUES (?, ?, 'debit', ?, ?, datetime('now'))`)
        .run(crypto.randomUUID(), req.auth!.userId, numberFeeUsd, `Virtual number: ${phoneNumber}`);

      // Record in DB
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO virtual_numbers (id, user_id, phone_number, telnyx_order_id, country_code, number_type, status, monthly_cost_usd, purchased_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'local', 'active', ?, datetime('now'), datetime('now'))
      `).run(id, req.auth!.userId, phoneNumber, result.orderId, countryCode || 'US', numberFeeUsd);

      res.json({ success: true, numberId: id, phoneNumber, orderId: result.orderId, charged: numberFeeUsd });
    } catch (e) {
      res.status(500).json({ error: 'Failed to purchase number. Please try again.' });
    }
  });

  /** List my virtual numbers */
  router.get('/api/numbers/mine', authenticate, (req: Request, res: Response) => {
    const numbers = db.prepare(`
      SELECT * FROM virtual_numbers WHERE user_id = ? AND status != 'released'
      ORDER BY created_at DESC
    `).all(req.auth!.userId);
    res.json({ numbers });
  });

  /** Release a number */
  router.delete('/api/numbers/:id', authenticate, async (req: Request, res: Response) => {
    const number = db.prepare(`SELECT * FROM virtual_numbers WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.auth!.userId) as Record<string, unknown> | undefined;
    if (!number) { res.status(404).json({ error: 'Number not found' }); return; }

    if (number.telnyx_number_id) {
      await releaseNumber(number.telnyx_number_id as string);
    }
    db.prepare(`UPDATE virtual_numbers SET status = 'released' WHERE id = ?`).run(req.params.id);
    res.json({ success: true });
  });

  // ── SIM Cards / eSIMs ──

  /** Order eSIM or physical SIM — currently requires Telnyx account upgrade */
  router.post('/api/sims/order', authenticate, async (_req: Request, res: Response) => {
    // Telnyx requires an upgraded account for SIM ordering.
    // This will be enabled once the Telnyx account is upgraded from free tier.
    res.status(400).json({
      error: 'eSIM/SIM ordering is coming soon. This feature requires a Telnyx account upgrade which is in progress. Check back shortly!',
      status: 'coming_soon',
    });
  });

  /** List my SIM orders */
  router.get('/api/sims/orders', authenticate, (req: Request, res: Response) => {
    const orders = db.prepare(`
      SELECT * FROM sim_card_orders WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.auth!.userId);
    res.json({ orders });
  });

  /** List active SIMs on Telnyx account */
  router.get('/api/sims/active', authenticate, async (req: Request, res: Response) => {
    try {
      const result = await listSimCards({ status: 'active' });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Failed to list SIMs' });
    }
  });

  /** Activate a SIM */
  router.post('/api/sims/:simId/activate', authenticate, async (req: Request, res: Response) => {
    try {
      const result = await activateSimCard(String(req.params.simId));
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Failed to activate SIM' });
    }
  });

  /** Get SIM details */
  router.get('/api/sims/:simId', authenticate, async (req: Request, res: Response) => {
    try {
      const sim = await getSimCard(String(req.params.simId));
      res.json({ sim });
    } catch (e) {
      res.status(500).json({ error: 'Failed to get SIM details' });
    }
  });

  // ── SMS / MMS Messaging ──

  /** Send SMS */
  router.post('/api/sms/send', authenticate, async (req: Request, res: Response) => {
    try {
      const { to, from, text, mediaUrls } = req.body;
      if (!to || !text) { res.status(400).json({ error: 'Enter a recipient phone number and message text' }); return; }
      if (!to.startsWith('+')) { res.status(400).json({ error: 'Phone number must be in international format (+1234567890)' }); return; }

      // Check user has a virtual number
      let fromNumber = from;
      if (!fromNumber) {
        const myNumber = db.prepare(`
          SELECT phone_number FROM virtual_numbers WHERE user_id = ? AND status = 'active' LIMIT 1
        `).get(req.auth!.userId) as Record<string, unknown> | undefined;
        fromNumber = myNumber?.phone_number as string;
        if (!fromNumber) {
          res.status(400).json({ error: 'You need a virtual number to send SMS. Go to Services → Virtual Numbers to buy one (costs $2).' });
          return;
        }
      }

      // Charge wallet $0.05 per SMS (platform markup over Telnyx ~$0.004 cost)
      const smsFeeUsd = 0.05;
      const wallet = db.prepare(`SELECT balance FROM wallet WHERE user_id = ?`).get(req.auth!.userId) as Record<string, unknown> | undefined;
      const balance = parseFloat(String(wallet?.balance || '0'));
      if (balance < smsFeeUsd) {
        res.status(400).json({
          error: `Insufficient wallet balance. SMS costs $${smsFeeUsd.toFixed(2)} each. Your balance: $${balance.toFixed(2)}. Fund your wallet first.`,
          required: smsFeeUsd,
          balance,
        });
        return;
      }

      const result = await sendSms({ to, from: fromNumber, text, mediaUrls });
      if (!result.success) { res.status(400).json({ error: result.error || 'SMS delivery failed. Check the recipient number.' }); return; }

      // Debit wallet
      db.prepare(`UPDATE wallet SET balance = balance - ? WHERE user_id = ?`).run(smsFeeUsd, req.auth!.userId);
      db.prepare(`INSERT INTO wallet_transactions (id, user_id, type, amount, description, created_at) VALUES (?, ?, 'debit', ?, ?, datetime('now'))`)
        .run(crypto.randomUUID(), req.auth!.userId, smsFeeUsd, `SMS to ${to}`);

      // Record message
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO sms_messages (id, user_id, telnyx_message_id, direction, from_number, to_number, body, media_urls, status, cost_usd, created_at)
        VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, 'sent', ?, datetime('now'))
      `).run(id, req.auth!.userId, result.messageId, fromNumber, to, text, JSON.stringify(mediaUrls || []), smsFeeUsd);

      res.json({ success: true, messageId: id, telnyxId: result.messageId, charged: smsFeeUsd });
    } catch (e) {
      res.status(500).json({ error: 'Failed to send SMS. Please try again.' });
    }
  });

  /** List sent/received SMS */
  router.get('/api/sms/history', authenticate, (req: Request, res: Response) => {
    const messages = db.prepare(`
      SELECT * FROM sms_messages WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
    `).all(req.auth!.userId);
    res.json({ messages });
  });

  // ── Telnyx AI (Free LLM Inference) ──

  /** AI Chat — send message and get reply */
  router.post('/api/telnyx-ai/chat', authenticate, async (req: Request, res: Response) => {
    try {
      const { message, sessionId } = req.body;
      if (!message) { res.status(400).json({ error: 'message required' }); return; }

      // Load or create session
      let session: Record<string, unknown> | undefined;
      let messages: Array<{ role: string; content: string }> = [];

      if (sessionId) {
        session = db.prepare(`SELECT * FROM ai_chat_sessions WHERE id = ? AND user_id = ?`)
          .get(sessionId, req.auth!.userId) as Record<string, unknown> | undefined;
        if (session) {
          messages = JSON.parse(session.messages as string || '[]');
        }
      }

      // Add user message
      messages.push({ role: 'user', content: message });

      // Keep last 20 messages for context
      const contextMessages = messages.slice(-20);

      // Add system prompt
      const fullMessages = [
        { role: 'system', content: 'You are PromptPay AI, a helpful assistant for financial services, airtime, data bundles, international calling, and general questions. Be concise and helpful.' },
        ...contextMessages,
      ];

      const result = await aiInference({ messages: fullMessages });

      if (result.error) {
        res.status(500).json({ error: result.error });
        return;
      }

      // Add assistant reply
      messages.push({ role: 'assistant', content: result.reply || '' });

      // Save session
      const sessId = session?.id as string || crypto.randomUUID();
      if (session) {
        db.prepare(`UPDATE ai_chat_sessions SET messages = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(JSON.stringify(messages), sessId);
      } else {
        // Title from first user message
        const title = message.slice(0, 50) + (message.length > 50 ? '...' : '');
        db.prepare(`
          INSERT INTO ai_chat_sessions (id, user_id, title, messages, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `).run(sessId, req.auth!.userId, title, JSON.stringify(messages));
      }

      res.json({ reply: result.reply, sessionId: sessId, usage: result.usage });
    } catch (e) {
      res.status(500).json({ error: 'AI inference failed' });
    }
  });

  /** AI Translate */
  router.post('/api/telnyx-ai/translate', authenticate, async (req: Request, res: Response) => {
    try {
      const { text, targetLanguage, sourceLanguage } = req.body;
      if (!text || !targetLanguage) { res.status(400).json({ error: 'text and targetLanguage required' }); return; }
      const result = await aiTranslate({ text, targetLanguage, sourceLanguage });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: 'Translation failed' });
    }
  });

  /** List AI chat sessions */
  router.get('/api/telnyx-ai/sessions', authenticate, (req: Request, res: Response) => {
    const sessions = db.prepare(`
      SELECT id, title, created_at, updated_at FROM ai_chat_sessions
      WHERE user_id = ? ORDER BY updated_at DESC LIMIT 20
    `).all(req.auth!.userId);
    res.json({ sessions });
  });

  /** Get AI chat session messages */
  router.get('/api/telnyx-ai/sessions/:id', authenticate, (req: Request, res: Response) => {
    const session = db.prepare(`SELECT * FROM ai_chat_sessions WHERE id = ? AND user_id = ?`)
      .get(req.params.id, req.auth!.userId) as Record<string, unknown> | undefined;
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    res.json({ session: { ...session, messages: JSON.parse(session.messages as string || '[]') } });
  });

  /** Telnyx account balance (admin/diagnostic) */
  router.get('/api/telnyx/balance', authenticate, async (req: Request, res: Response) => {
    try {
      const balance = await getTelnyxBalance();
      res.json(balance);
    } catch (e) {
      res.status(500).json({ error: 'Failed to get balance' });
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
