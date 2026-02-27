// ═══════════════════════════════════════════════════════════════
// PromptPay :: Developer API Portal
// Full REST API for third-party developers to integrate
// payments, airtime, SMS, calls, AI, and wallet services.
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { randomBytes, createHash, createHmac } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { authenticate } from '../auth/middleware.js';
import { CONFIG } from '../core/config.js';
import type { MemoryStore } from '../memory/store.js';
import type { Orchestrator } from '../core/orchestrator.js';
import type { LoggerHandle } from '../core/types.js';

export interface DeveloperRouteDependencies {
  memory: MemoryStore;
  orchestrator: Orchestrator;
  logger: LoggerHandle;
}

function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function createDeveloperRoutes(deps: DeveloperRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // ════════════════════════════════════════════════════════════
  // KEY MANAGEMENT (authenticated via Bearer token)
  // ════════════════════════════════════════════════════════════

  // ── Generate Developer API Key ──
  router.post('/api/developer/keys', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const { name, aiProvider, aiApiKey, environment } = req.body as {
      name?: string; aiProvider?: string; aiApiKey?: string; environment?: string;
    };

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const env = environment === 'production' ? 'production' : 'sandbox';
    const keyPrefix = env === 'production' ? 'upp_live_' : 'upp_test_';
    const rawKey = `${keyPrefix}${randomBytes(24).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const prefix = rawKey.slice(0, 12) + '...';
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO developer_keys (id, user_id, name, api_key_hash, api_key_prefix, ai_provider, ai_api_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, `${name} (${env})`, keyHash, prefix, aiProvider || 'platform', aiApiKey || null, now);

    deps.logger.info(`[DevPortal] Key created: ${prefix} env=${env} by ${userId}`);

    res.json({
      id,
      apiKey: rawKey,
      prefix,
      name,
      environment: env,
      aiProvider: aiProvider || 'platform',
      hasCustomAiKey: !!aiApiKey,
      rateLimit: 100,
      message: 'Save this API key — it will not be shown again.',
    });
  });

  // ── List Developer Keys ──
  router.get('/api/developer/keys', authenticate, (req: Request, res: Response) => {
    const keys = db.prepare(`
      SELECT id, name, api_key_prefix, ai_provider, rate_limit, requests_today, status, created_at, last_request_at
      FROM developer_keys WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.auth!.userId) as Array<Record<string, unknown>>;

    res.json({
      keys: keys.map(k => ({
        ...k,
        environment: (k.api_key_prefix as string)?.startsWith('upp_test') ? 'sandbox' : 'production',
      })),
    });
  });

  // ── Revoke Developer Key ──
  router.delete('/api/developer/keys/:id', authenticate, (req: Request, res: Response) => {
    const result = db.prepare(`
      UPDATE developer_keys SET status = 'revoked' WHERE id = ? AND user_id = ?
    `).run(req.params.id, req.auth!.userId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    res.json({ success: true });
  });

  // ── API Usage Analytics ──
  router.get('/api/developer/analytics', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const days = Math.min(Number(req.query.days) || 30, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString();

    // Per-key summary
    const keys = db.prepare(`
      SELECT id, name, api_key_prefix, requests_today, rate_limit, status, last_request_at
      FROM developer_keys WHERE user_id = ? ORDER BY created_at DESC
    `).all(userId) as Array<Record<string, unknown>>;

    // Request logs over time
    const dailyStats = db.prepare(`
      SELECT DATE(created_at) as date,
        COUNT(*) as total_requests,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed,
        AVG(response_time_ms) as avg_response_ms
      FROM developer_api_logs
      WHERE user_id = ? AND created_at >= ?
      GROUP BY DATE(created_at) ORDER BY date DESC
    `).all(userId, since) as Array<Record<string, unknown>>;

    // Endpoint breakdown
    const endpoints = db.prepare(`
      SELECT endpoint, method, COUNT(*) as count,
        AVG(response_time_ms) as avg_ms,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
      FROM developer_api_logs
      WHERE user_id = ? AND created_at >= ?
      GROUP BY endpoint, method ORDER BY count DESC LIMIT 20
    `).all(userId, since) as Array<Record<string, unknown>>;

    // Totals
    const totals = db.prepare(`
      SELECT COUNT(*) as total_requests,
        SUM(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as failed
      FROM developer_api_logs
      WHERE user_id = ? AND created_at >= ?
    `).get(userId, since) as Record<string, unknown>;

    res.json({ keys, dailyStats, endpoints, totals, period: `${days} days` });
  });

  // ── API Request Logs ──
  router.get('/api/developer/logs', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const keyId = req.query.keyId as string;
    const status = req.query.status as string; // 'success' | 'error'

    let query = `SELECT * FROM developer_api_logs WHERE user_id = ?`;
    const params: unknown[] = [userId];

    if (keyId) {
      query += ` AND api_key_id = ?`;
      params.push(keyId);
    }
    if (status === 'error') {
      query += ` AND status_code >= 400`;
    } else if (status === 'success') {
      query += ` AND status_code < 400`;
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const logs = db.prepare(query).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as count FROM developer_api_logs WHERE user_id = ?`).get(userId) as { count: number };

    res.json({ logs, total: total.count, limit, offset });
  });

  // ── Webhook Configuration ──
  router.post('/api/developer/webhooks', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const { apiKeyId, url, events } = req.body as {
      apiKeyId: string; url: string; events?: string[];
    };

    if (!apiKeyId || !url) {
      res.status(400).json({ error: 'apiKeyId and url are required' });
      return;
    }

    // Verify the key belongs to this user
    const key = db.prepare('SELECT id FROM developer_keys WHERE id = ? AND user_id = ?').get(apiKeyId, userId);
    if (!key) {
      res.status(404).json({ error: 'API key not found' });
      return;
    }

    const id = randomBytes(16).toString('hex');
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    const eventList = events || ['payment.completed', 'airtime.completed', 'sms.sent', 'transfer.completed'];

    db.prepare(`
      INSERT INTO developer_webhooks (id, user_id, api_key_id, url, secret, events, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, apiKeyId, url, secret, JSON.stringify(eventList), new Date().toISOString());

    res.json({
      id,
      url,
      secret,
      events: eventList,
      message: 'Save the webhook secret — it will not be shown again.',
    });
  });

  router.get('/api/developer/webhooks', authenticate, (req: Request, res: Response) => {
    const webhooks = db.prepare(`
      SELECT w.id, w.api_key_id, w.url, w.events, w.status, w.failures, w.last_triggered_at, w.created_at,
             k.name as key_name, k.api_key_prefix
      FROM developer_webhooks w
      JOIN developer_keys k ON k.id = w.api_key_id
      WHERE w.user_id = ?
      ORDER BY w.created_at DESC
    `).all(req.auth!.userId);
    res.json({ webhooks });
  });

  router.delete('/api/developer/webhooks/:id', authenticate, (req: Request, res: Response) => {
    const result = db.prepare('DELETE FROM developer_webhooks WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.auth!.userId);
    if (result.changes === 0) {
      res.status(404).json({ error: 'Webhook not found' });
      return;
    }
    res.json({ success: true });
  });

  // ════════════════════════════════════════════════════════════
  // DEVELOPER API KEY AUTH MIDDLEWARE
  // ════════════════════════════════════════════════════════════

  function devAuth(req: Request, res: Response, next: () => void): void {
    const apiKey = (req.headers['x-api-key'] as string) || (req.headers.authorization?.replace('Bearer ', '') || '');
    if (!apiKey || (!apiKey.startsWith('upp_live_') && !apiKey.startsWith('upp_test_'))) {
      res.status(401).json({
        error: 'Missing or invalid API key',
        hint: 'Include your API key in the X-API-Key header or as Bearer token',
      });
      return;
    }

    const keyHash = hashApiKey(apiKey);
    const record = db.prepare(`
      SELECT * FROM developer_keys WHERE api_key_hash = ? AND status = 'active'
    `).get(keyHash) as Record<string, unknown> | undefined;

    if (!record) {
      res.status(401).json({ error: 'Invalid or revoked API key' });
      return;
    }

    // Sandbox mode check
    const isSandbox = apiKey.startsWith('upp_test_');
    (req as unknown as Record<string, unknown>).isSandbox = isSandbox;

    // Rate limiting
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = (record.last_request_at as string || '').slice(0, 10);
    let requestsToday = record.requests_today as number;

    if (lastDate !== today) {
      requestsToday = 0;
    }

    if (requestsToday >= (record.rate_limit as number)) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        limit: record.rate_limit,
        resetAt: `${today}T00:00:00Z (next day)`,
        hint: 'Contact us for higher rate limits.',
      });
      return;
    }

    db.prepare(`
      UPDATE developer_keys SET requests_today = ?, last_request_at = ? WHERE id = ?
    `).run(requestsToday + 1, new Date().toISOString(), record.id);

    (req as unknown as Record<string, unknown>).devKey = record;
    next();
  }

  // Log API request
  function logApiRequest(
    req: Request, statusCode: number, startTime: number, errorMessage?: string
  ): void {
    try {
      const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
      if (!devKey) return;
      db.prepare(`
        INSERT INTO developer_api_logs (id, api_key_id, user_id, endpoint, method, status_code, response_time_ms, ip_address, user_agent, error_message, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomBytes(16).toString('hex'),
        devKey.id, devKey.user_id,
        req.path, req.method, statusCode,
        Date.now() - startTime,
        req.ip || req.headers['x-forwarded-for'] || '',
        (req.headers['user-agent'] || '').slice(0, 200),
        errorMessage || null,
        new Date().toISOString(),
      );
    } catch { /* don't let logging failures break API */ }
  }

  // ════════════════════════════════════════════════════════════
  // PUBLIC DEVELOPER API v1 ENDPOINTS
  // ════════════════════════════════════════════════════════════

  // ── API Key Info ──
  router.get('/api/v1/me', devAuth, (req: Request, res: Response) => {
    const start = Date.now();
    const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
    const data = {
      keyId: devKey.id,
      name: devKey.name,
      aiProvider: devKey.ai_provider,
      hasCustomAiKey: !!(devKey.ai_api_key),
      rateLimit: devKey.rate_limit,
      requestsToday: devKey.requests_today,
      status: devKey.status,
      sandbox: (req as unknown as Record<string, unknown>).isSandbox,
    };
    res.json(data);
    logApiRequest(req, 200, start);
  });

  // ── Chat Completion ──
  router.post('/api/v1/chat', devAuth, async (req: Request, res: Response) => {
    const start = Date.now();
    try {
      const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
      const { messages, model, maxTokens, temperature, system } = req.body as {
        messages: Array<{ role: string; content: string }>;
        model?: string; maxTokens?: number; temperature?: number; system?: string;
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages array is required' });
        logApiRequest(req, 400, start, 'Missing messages');
        return;
      }

      const aiKey = (devKey.ai_api_key as string) || CONFIG.anthropic.apiKey;
      const client = new Anthropic({ apiKey: aiKey });

      const response = await client.messages.create({
        model: model || CONFIG.anthropic.model,
        max_tokens: Math.min(maxTokens || 4096, CONFIG.anthropic.maxTokens),
        temperature: temperature ?? 0.7,
        system: system || 'You are a helpful AI assistant powered by PromptPay.',
        messages: messages as Anthropic.MessageParam[],
      });

      const outputTokens = response.usage?.output_tokens || 0;
      const inputTokens = response.usage?.input_tokens || 0;

      res.json({
        id: response.id,
        model: response.model,
        content: response.content,
        usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
        stop_reason: response.stop_reason,
      });
      logApiRequest(req, 200, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[DevAPI] Chat error: ${message}`);
      if (message.includes('authentication') || message.includes('api_key')) {
        res.status(401).json({ error: 'Invalid AI API key' });
        logApiRequest(req, 401, start, message);
      } else {
        res.status(500).json({ error: message });
        logApiRequest(req, 500, start, message);
      }
    }
  });

  // ── Task Execution ──
  router.post('/api/v1/task', devAuth, async (req: Request, res: Response) => {
    const start = Date.now();
    try {
      const { type, title, description, payload } = req.body as {
        type?: string; title?: string; description?: string; payload?: Record<string, unknown>;
      };

      if (!title) {
        res.status(400).json({ error: 'title is required' });
        logApiRequest(req, 400, start, 'Missing title');
        return;
      }

      const task = deps.orchestrator.createTask(
        (type || 'custom') as Parameters<typeof deps.orchestrator.createTask>[0],
        'medium', title, description || '', payload || {},
      );
      const result = await deps.orchestrator.executeTask(task);

      res.json({ taskId: task.id, result });
      logApiRequest(req, 200, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
      logApiRequest(req, 500, start, message);
    }
  });

  // ── Wallet Balance ──
  router.get('/api/v1/wallet/balance', devAuth, (req: Request, res: Response) => {
    const start = Date.now();
    const isSandbox = (req as unknown as Record<string, unknown>).isSandbox;
    if (isSandbox) {
      res.json({ balance: 1000.00, currency: 'USD', sandbox: true });
      logApiRequest(req, 200, start);
      return;
    }

    const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
    const userId = devKey.user_id as string;
    const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as { balance: number } | undefined;
    res.json({ balance: row?.balance || 0, currency: 'USD' });
    logApiRequest(req, 200, start);
  });

  // ── Wallet Transactions ──
  router.get('/api/v1/wallet/transactions', devAuth, (req: Request, res: Response) => {
    const start = Date.now();
    const isSandbox = (req as unknown as Record<string, unknown>).isSandbox;
    if (isSandbox) {
      res.json({
        transactions: [
          { id: 'txn_test_1', type: 'credit', amount: 50.00, currency: 'USD', description: 'Test deposit', created_at: new Date().toISOString() },
          { id: 'txn_test_2', type: 'debit', amount: 10.00, currency: 'USD', description: 'Test purchase', created_at: new Date().toISOString() },
        ],
        sandbox: true,
      });
      logApiRequest(req, 200, start);
      return;
    }

    const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Number(req.query.offset) || 0;
    const transactions = db.prepare(`
      SELECT id, type, amount, currency, description, reference, status, created_at
      FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(devKey.user_id, limit, offset);
    res.json({ transactions, limit, offset });
    logApiRequest(req, 200, start);
  });

  // ── Send Airtime ──
  router.post('/api/v1/airtime/send', devAuth, async (req: Request, res: Response) => {
    const start = Date.now();
    const isSandbox = (req as unknown as Record<string, unknown>).isSandbox;
    const { phone, amount, country } = req.body as {
      phone?: string; amount?: number; country?: string;
    };

    if (!phone || !amount) {
      res.status(400).json({ error: 'phone and amount are required' });
      logApiRequest(req, 400, start, 'Missing phone/amount');
      return;
    }

    if (isSandbox) {
      res.json({
        id: `air_test_${randomBytes(8).toString('hex')}`,
        phone, amount, country: country || 'NG',
        status: 'completed',
        sandbox: true,
        message: 'Sandbox: airtime simulated successfully',
      });
      logApiRequest(req, 200, start);
      return;
    }

    // Use orchestrator to execute airtime top-up
    try {
      const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
      const task = deps.orchestrator.createTask(
        'custom', 'high', 'API Airtime Top-up',
        `Send ${amount} airtime to ${phone} in ${country || 'NG'}`,
        { tool: 'sell_airtime', phone, amount, countryCode: country || 'NG', userId: devKey.user_id },
      );
      const result = await deps.orchestrator.executeTask(task);
      res.json({
        id: `air_${randomBytes(8).toString('hex')}`,
        phone, amount, country: country || 'NG',
        status: 'completed',
        result,
      });
      logApiRequest(req, 200, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
      logApiRequest(req, 500, start, message);
    }
  });

  // ── Send SMS ──
  router.post('/api/v1/sms/send', devAuth, async (req: Request, res: Response) => {
    const start = Date.now();
    const isSandbox = (req as unknown as Record<string, unknown>).isSandbox;
    const { to, from, body } = req.body as {
      to?: string; from?: string; body?: string;
    };

    if (!to || !body) {
      res.status(400).json({ error: 'to and body are required' });
      logApiRequest(req, 400, start, 'Missing to/body');
      return;
    }

    if (isSandbox) {
      res.json({
        id: `sms_test_${randomBytes(8).toString('hex')}`,
        to, from: from || '+15555555555',
        body,
        status: 'delivered',
        sandbox: true,
      });
      logApiRequest(req, 200, start);
      return;
    }

    try {
      // Use Telnyx to send SMS
      const telnyxKey = CONFIG.telnyx?.apiKey || process.env.TELNYX_API_KEY;
      if (!telnyxKey) {
        res.status(503).json({ error: 'SMS service not configured' });
        logApiRequest(req, 503, start, 'No Telnyx key');
        return;
      }

      const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
      // Get user's number or use provided 'from'
      let fromNumber = from;
      if (!fromNumber) {
        const num = db.prepare('SELECT phone_number FROM virtual_numbers WHERE user_id = ? AND status = ? LIMIT 1')
          .get(devKey.user_id, 'active') as { phone_number: string } | undefined;
        fromNumber = num?.phone_number;
      }

      if (!fromNumber) {
        res.status(400).json({ error: 'No from number available. Provide a "from" number or buy a virtual number first.' });
        logApiRequest(req, 400, start, 'No from number');
        return;
      }

      const smsRes = await fetch('https://api.telnyx.com/v2/messages', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${telnyxKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromNumber, to, text: body }),
      });

      const smsData = await smsRes.json() as Record<string, unknown>;

      if (!smsRes.ok) {
        const errMsg = JSON.stringify(smsData);
        res.status(400).json({ error: 'SMS send failed', details: smsData });
        logApiRequest(req, 400, start, errMsg);
        return;
      }

      res.json({
        id: (smsData.data as Record<string, unknown>)?.id || `sms_${randomBytes(8).toString('hex')}`,
        to, from: fromNumber,
        status: 'sent',
      });
      logApiRequest(req, 200, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
      logApiRequest(req, 500, start, message);
    }
  });

  // ── Call Rates ──
  router.get('/api/v1/calls/rates', devAuth, async (req: Request, res: Response) => {
    const start = Date.now();
    const country = (req.query.country as string || 'NG').toUpperCase();

    // Return rate info
    const rates: Record<string, { perMinute: number; currency: string }> = {
      US: { perMinute: 0.01, currency: 'USD' },
      NG: { perMinute: 0.03, currency: 'USD' },
      GH: { perMinute: 0.05, currency: 'USD' },
      GB: { perMinute: 0.02, currency: 'USD' },
      KE: { perMinute: 0.04, currency: 'USD' },
    };

    res.json({
      country,
      rate: rates[country] || { perMinute: 0.05, currency: 'USD' },
      billingIncrement: 60,
      note: 'Rates are per minute, billed in 60-second increments',
    });
    logApiRequest(req, 200, start);
  });

  // ── Virtual Numbers ──
  router.get('/api/v1/numbers', devAuth, (req: Request, res: Response) => {
    const start = Date.now();
    const isSandbox = (req as unknown as Record<string, unknown>).isSandbox;

    if (isSandbox) {
      res.json({
        numbers: [
          { id: 'num_test_1', phone: '+15551234567', country: 'US', status: 'active', monthlyRate: 2.00 },
        ],
        sandbox: true,
      });
      logApiRequest(req, 200, start);
      return;
    }

    const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
    const numbers = db.prepare(`
      SELECT id, phone_number as phone, country_code as country, status, created_at
      FROM virtual_numbers WHERE user_id = ? ORDER BY created_at DESC
    `).all(devKey.user_id);
    res.json({ numbers });
    logApiRequest(req, 200, start);
  });

  // ── Search Available Numbers ──
  router.get('/api/v1/numbers/search', devAuth, async (req: Request, res: Response) => {
    const start = Date.now();
    const country = (req.query.country as string || 'US').toUpperCase();
    const isSandbox = (req as unknown as Record<string, unknown>).isSandbox;

    if (isSandbox) {
      res.json({
        available: [
          { phone: '+15559876543', country: 'US', monthlyRate: 2.00, features: ['sms', 'voice'] },
          { phone: '+15559876544', country: 'US', monthlyRate: 2.00, features: ['sms', 'voice'] },
        ],
        sandbox: true,
      });
      logApiRequest(req, 200, start);
      return;
    }

    try {
      const telnyxKey = CONFIG.telnyx?.apiKey || process.env.TELNYX_API_KEY;
      if (!telnyxKey) {
        res.status(503).json({ error: 'Number service not configured' });
        logApiRequest(req, 503, start);
        return;
      }

      const searchRes = await fetch(
        `https://api.telnyx.com/v2/available_phone_numbers?filter[country_code]=${country}&filter[limit]=10`,
        { headers: { 'Authorization': `Bearer ${telnyxKey}` } },
      );
      const data = await searchRes.json() as { data?: Array<Record<string, unknown>> };

      res.json({
        available: (data.data || []).map((n: Record<string, unknown>) => ({
          phone: n.phone_number,
          country,
          monthlyRate: 2.00,
          features: n.features || ['sms', 'voice'],
        })),
      });
      logApiRequest(req, 200, start);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
      logApiRequest(req, 500, start, message);
    }
  });

  // ── API Documentation endpoint ──
  router.get('/api/v1/docs', (_req: Request, res: Response) => {
    res.json({
      name: 'PromptPay Developer API',
      version: 'v1',
      baseUrl: 'https://www.upromptpay.com/api/v1',
      authentication: {
        type: 'API Key',
        header: 'X-API-Key',
        format: 'upp_live_xxx (production) or upp_test_xxx (sandbox)',
      },
      endpoints: [
        { method: 'GET', path: '/api/v1/me', description: 'Get API key info and usage' },
        { method: 'POST', path: '/api/v1/chat', description: 'AI chat completion', body: { messages: '[{role, content}]', model: 'optional', maxTokens: 'optional' } },
        { method: 'POST', path: '/api/v1/task', description: 'Execute an AI task', body: { title: 'required', description: 'optional', type: 'optional' } },
        { method: 'GET', path: '/api/v1/wallet/balance', description: 'Get wallet balance' },
        { method: 'GET', path: '/api/v1/wallet/transactions', description: 'List transactions', query: { limit: 'optional', offset: 'optional' } },
        { method: 'POST', path: '/api/v1/airtime/send', description: 'Send airtime top-up', body: { phone: 'required', amount: 'required', country: 'optional (default: NG)' } },
        { method: 'POST', path: '/api/v1/sms/send', description: 'Send SMS', body: { to: 'required', body: 'required', from: 'optional' } },
        { method: 'GET', path: '/api/v1/calls/rates', description: 'Get call rates', query: { country: 'optional (default: NG)' } },
        { method: 'GET', path: '/api/v1/numbers', description: 'List your virtual numbers' },
        { method: 'GET', path: '/api/v1/numbers/search', description: 'Search available numbers', query: { country: 'optional (default: US)' } },
      ],
      sandbox: {
        description: 'Use test keys (upp_test_xxx) for sandbox mode. All operations are simulated with mock data.',
        testKey: 'Generate at https://www.upromptpay.com → Developer Portal',
      },
      rateLimit: {
        default: '100 requests/day',
        header: 'X-RateLimit-Remaining (coming soon)',
      },
      webhooks: {
        events: ['payment.completed', 'airtime.completed', 'sms.sent', 'sms.received', 'call.completed', 'transfer.completed'],
        setup: 'POST /api/developer/webhooks',
        verification: 'HMAC-SHA256 signature in X-Webhook-Signature header',
      },
      errors: {
        400: 'Bad Request — invalid parameters',
        401: 'Unauthorized — invalid or missing API key',
        403: 'Forbidden — insufficient permissions',
        429: 'Rate Limited — too many requests',
        500: 'Internal Error — contact support',
      },
    });
  });

  return router;
}
