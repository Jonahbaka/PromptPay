// ═══════════════════════════════════════════════════════════════
// PromptPay :: Gateway Server
// Express 5 + WebSocket — API gateway for all operations
// ═══════════════════════════════════════════════════════════════

import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { v4 as uuid } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { TaskSchema } from '../core/types.js';
import { authenticate } from '../auth/middleware.js';
import type { MemoryStore } from '../memory/store.js';

export interface GatewayDependencies {
  orchestrator: Orchestrator;
  memory: MemoryStore;
  logger: LoggerHandle;
}

export function createGateway(deps: GatewayDependencies): { app: express.Application; server: Server; wss: WebSocketServer } {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json({ limit: '10mb' }));

  // ── Serve static frontend ──
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.resolve(__dirname, '..', '..', 'public');

  // Block direct access to admin.html — it's only served at the secret path
  app.get('/admin.html', (_req: Request, res: Response) => {
    res.status(404).send('Not found');
  });

  // Serve admin dashboard at secret path only (no-cache to prevent stale JS)
  const secretAdminPath = `/${CONFIG.admin.secretPath}`;
  app.get(secretAdminPath, (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(path.join(publicDir, 'admin.html'));
  });

  // Serve index.html with no-cache as well
  app.get('/', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(express.static(publicDir));

  // ── Request logging ──
  app.use((req: Request, _res: Response, next: NextFunction) => {
    deps.logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // ── Health (public) ──
  app.get('/health', (_req: Request, res: Response) => {
    const state = deps.orchestrator.getState();
    res.json({
      status: 'healthy',
      platform: CONFIG.platform.name,
      version: CONFIG.platform.version,
      domain: CONFIG.platform.domainUrl,
      uptime: process.uptime(),
      orchestrator: state,
    });
  });

  // ── Task submission (authenticated) ──
  app.post('/api/task', authenticate, async (req: Request, res: Response) => {
    try {
      const parsed = TaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid task', details: parsed.error.format() });
        return;
      }

      const { type, priority, title, description, payload } = parsed.data;

      // Rate limit for non-owner users
      const userId = req.auth?.userId || 'anonymous';
      const role = req.auth?.role || 'user';
      if (role === 'user') {
        const today = new Date().toISOString().slice(0, 10);
        const row = deps.memory.getDb().prepare(
          'SELECT messages_used FROM usage_tracking WHERE user_id = ? AND date = ?'
        ).get(userId, today) as { messages_used: number } | undefined;
        const used = row?.messages_used || 0;
        if (used >= CONFIG.rateLimits.freeMessagesPerDay) {
          res.status(429).json({
            error: 'Daily message limit reached',
            limit: CONFIG.rateLimits.freeMessagesPerDay,
            used,
            resetsAt: today + 'T00:00:00Z (next day)',
          });
          return;
        }
        deps.memory.getDb().prepare(`
          INSERT INTO usage_tracking (user_id, date, messages_used)
          VALUES (?, ?, 1)
          ON CONFLICT(user_id, date) DO UPDATE SET messages_used = messages_used + 1
        `).run(userId, today);
      }

      // Mark user tasks so orchestrator uses Haiku
      const taskPayload = { ...payload, userInitiated: role === 'user' };
      const task = deps.orchestrator.createTask(type, priority, title, description || '', taskPayload);
      const result = await deps.orchestrator.executeTask(task);

      // Broadcast via WebSocket
      broadcastWs(wss, { type: 'task:result', taskId: task.id, result });

      res.json({ taskId: task.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger.error(`Task execution error: ${message}`);
      res.status(500).json({ error: message });
    }
  });

  // ── Usage / rate limit info ──
  app.get('/api/usage', authenticate, (req: Request, res: Response) => {
    const userId = req.auth!.userId;
    const role = req.auth!.role;
    const today = new Date().toISOString().slice(0, 10);
    const row = deps.memory.getDb().prepare(
      'SELECT messages_used, tokens_used, channel_messages_used FROM usage_tracking WHERE user_id = ? AND date = ?'
    ).get(userId, today) as Record<string, number> | undefined;

    const limit = role === 'owner' ? Infinity : CONFIG.rateLimits.freeMessagesPerDay;
    res.json({
      messagesUsed: row?.messages_used || 0,
      messagesLimit: limit === Infinity ? 'unlimited' : limit,
      tokensUsed: row?.tokens_used || 0,
      channelMessagesUsed: row?.channel_messages_used || 0,
      channelMessagesLimit: CONFIG.rateLimits.channelMessagesPerDay,
      date: today,
      plan: role === 'owner' ? 'owner' : 'free',
    });
  });

  // ── State queries (authenticated) ──
  app.get('/api/state', authenticate, (_req: Request, res: Response) => {
    res.json(deps.orchestrator.getState());
  });

  app.get('/api/agents', authenticate, (_req: Request, res: Response) => {
    res.json(deps.orchestrator.getAgents());
  });

  app.get('/api/tasks', authenticate, (_req: Request, res: Response) => {
    res.json(deps.orchestrator.getTasks());
  });

  app.get('/api/events', authenticate, (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit || '100'));
    res.json(deps.orchestrator.getExecutionLog(limit));
  });

  // ── WebSocket handling ──
  wss.on('connection', (ws: WebSocket) => {
    const clientId = uuid();
    deps.logger.info(`WS client connected: ${clientId}`);

    ws.send(JSON.stringify({ type: 'connected', clientId, platform: CONFIG.platform.name }));

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'task') {
          const parsed = TaskSchema.safeParse(message.payload);
          if (parsed.success) {
            const task = deps.orchestrator.createTask(
              parsed.data.type, parsed.data.priority,
              parsed.data.title, parsed.data.description || '', parsed.data.payload
            );
            const result = await deps.orchestrator.executeTask(task);
            ws.send(JSON.stringify({ type: 'task:result', taskId: task.id, result }));
          }
        }
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }));
      }
    });

    ws.on('close', () => {
      deps.logger.info(`WS client disconnected: ${clientId}`);
    });
  });

  return { app, server, wss };
}

function broadcastWs(wss: WebSocketServer, data: Record<string, unknown>): void {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}
