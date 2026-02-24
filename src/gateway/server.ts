// ═══════════════════════════════════════════════════════════════
// PromptPay :: Gateway Server
// Express 5 + WebSocket — API gateway for all operations
// ═══════════════════════════════════════════════════════════════

import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, type WebSocket } from 'ws';
import { createServer, type Server } from 'http';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import type { Orchestrator } from '../core/orchestrator.js';
import { TaskSchema } from '../core/types.js';

export interface GatewayDependencies {
  orchestrator: Orchestrator;
  logger: LoggerHandle;
}

export function createGateway(deps: GatewayDependencies): { app: express.Application; server: Server; wss: WebSocketServer } {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(express.json({ limit: '10mb' }));

  // ── Request logging ──
  app.use((req: Request, _res: Response, next: NextFunction) => {
    deps.logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // ── Auth middleware ──
  const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (token !== CONFIG.gateway.secret && CONFIG.gateway.secret !== 'promptpay-local') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };

  // ── Health ──
  app.get('/health', (_req: Request, res: Response) => {
    const state = deps.orchestrator.getState();
    res.json({
      status: 'healthy',
      platform: 'PromptPay',
      version: '1.0.0',
      uptime: process.uptime(),
      orchestrator: state,
    });
  });

  // ── Task submission ──
  app.post('/api/task', authMiddleware, async (req: Request, res: Response) => {
    try {
      const parsed = TaskSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid task', details: parsed.error.format() });
        return;
      }

      const { type, priority, title, description, payload } = parsed.data;
      const task = deps.orchestrator.createTask(type, priority, title, description || '', payload);
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

  // ── State queries ──
  app.get('/api/state', authMiddleware, (_req: Request, res: Response) => {
    res.json(deps.orchestrator.getState());
  });

  app.get('/api/agents', authMiddleware, (_req: Request, res: Response) => {
    res.json(deps.orchestrator.getAgents());
  });

  app.get('/api/tasks', authMiddleware, (_req: Request, res: Response) => {
    res.json(deps.orchestrator.getTasks());
  });

  app.get('/api/events', authMiddleware, (req: Request, res: Response) => {
    const limit = parseInt(String(req.query.limit || '100'));
    res.json(deps.orchestrator.getExecutionLog(limit));
  });

  // ── WebSocket handling ──
  wss.on('connection', (ws: WebSocket) => {
    const clientId = uuid();
    deps.logger.info(`WS client connected: ${clientId}`);

    ws.send(JSON.stringify({ type: 'connected', clientId, platform: 'PromptPay' }));

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
