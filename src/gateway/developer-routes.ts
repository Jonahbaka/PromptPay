// ═══════════════════════════════════════════════════════════════
// PromptPay :: Developer API Routes
// Developers can use their own AI model keys via our API
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { randomBytes, createHash } from 'crypto';
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

  // ── Generate Developer API Key ──
  router.post('/api/developer/keys', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const { name, aiProvider, aiApiKey } = req.body as {
      name?: string; aiProvider?: string; aiApiKey?: string;
    };

    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    // Generate a unique API key: upp_live_<random>
    const rawKey = `upp_live_${randomBytes(24).toString('hex')}`;
    const keyHash = hashApiKey(rawKey);
    const prefix = rawKey.slice(0, 12) + '...';
    const id = randomBytes(16).toString('hex');
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO developer_keys (id, user_id, name, api_key_hash, api_key_prefix, ai_provider, ai_api_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, name, keyHash, prefix, aiProvider || 'platform', aiApiKey || null, now);

    deps.logger.info(`Developer key created: ${prefix} by ${userId}`);

    // Return the full key ONCE — never shown again
    res.json({
      id,
      apiKey: rawKey,
      prefix,
      name,
      aiProvider: aiProvider || 'platform',
      hasCustomAiKey: !!aiApiKey,
      rateLimit: 100,
      message: 'Save this API key — it will not be shown again.',
    });
  });

  // ── List Developer Keys ──
  router.get('/api/developer/keys', authenticate, (req: Request, res: Response) => {
    const keys = db.prepare(`
      SELECT id, name, api_key_prefix, ai_provider, rate_limit, requests_today, status, created_at
      FROM developer_keys WHERE user_id = ? ORDER BY created_at DESC
    `).all(req.auth!.userId);

    res.json({ keys });
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

  // ════════════════════════════════════════════════════════════
  // PUBLIC DEVELOPER API — authenticated via X-API-Key header
  // ════════════════════════════════════════════════════════════

  // Middleware: validate developer API key
  function devAuth(req: Request, res: Response, next: () => void): void {
    const apiKey = req.headers['x-api-key'] as string;
    if (!apiKey) {
      res.status(401).json({ error: 'Missing X-API-Key header' });
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

    // Rate limiting
    const today = new Date().toISOString().slice(0, 10);
    const lastDate = (record.last_request_at as string || '').slice(0, 10);
    let requestsToday = record.requests_today as number;

    if (lastDate !== today) {
      requestsToday = 0; // Reset daily counter
    }

    if (requestsToday >= (record.rate_limit as number)) {
      res.status(429).json({ error: 'Rate limit exceeded. Upgrade your plan for higher limits.' });
      return;
    }

    // Update counter
    db.prepare(`
      UPDATE developer_keys SET requests_today = ?, last_request_at = ? WHERE id = ?
    `).run(requestsToday + 1, new Date().toISOString(), record.id);

    // Attach dev context
    (req as unknown as Record<string, unknown>).devKey = record;
    next();
  }

  // ── Chat Completion (Developer API) ──
  router.post('/api/v1/chat', devAuth, async (req: Request, res: Response) => {
    try {
      const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
      const { messages, model, maxTokens, temperature, system } = req.body as {
        messages: Array<{ role: string; content: string }>;
        model?: string;
        maxTokens?: number;
        temperature?: number;
        system?: string;
      };

      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages array is required' });
        return;
      }

      // Use developer's AI key if they provided one, otherwise use platform key
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

      deps.logger.info(`[DevAPI] Chat: ${devKey.api_key_prefix} tokens=${inputTokens + outputTokens}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[DevAPI] Chat error: ${message}`);

      if (message.includes('authentication') || message.includes('api_key')) {
        res.status(401).json({ error: 'Invalid AI API key. Check your key configuration.' });
      } else {
        res.status(500).json({ error: message });
      }
    }
  });

  // ── Task Execution (Developer API) ──
  router.post('/api/v1/task', devAuth, async (req: Request, res: Response) => {
    try {
      const { type, title, description, payload } = req.body as {
        type?: string; title?: string; description?: string; payload?: Record<string, unknown>;
      };

      if (!title) {
        res.status(400).json({ error: 'title is required' });
        return;
      }

      const task = deps.orchestrator.createTask(
        (type || 'custom') as Parameters<typeof deps.orchestrator.createTask>[0],
        'medium',
        title,
        description || '',
        payload || {},
      );
      const result = await deps.orchestrator.executeTask(task);

      res.json({ taskId: task.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ── API Key Info ──
  router.get('/api/v1/me', devAuth, (req: Request, res: Response) => {
    const devKey = (req as unknown as Record<string, unknown>).devKey as Record<string, unknown>;
    res.json({
      keyId: devKey.id,
      name: devKey.name,
      aiProvider: devKey.ai_provider,
      hasCustomAiKey: !!(devKey.ai_api_key),
      rateLimit: devKey.rate_limit,
      requestsToday: devKey.requests_today,
      status: devKey.status,
    });
  });

  return router;
}
