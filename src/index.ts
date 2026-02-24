// ═══════════════════════════════════════════════════════════════
// uPromptPay v1.2 :: Entry Point
// Multi-tenant fintech platform — 5 agents, 45 tools, 9 hooks
// Bank partnerships + Developer API + WhatsApp & Telegram
// https://www.upromptpay.com
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from './core/config.js';
import { createLogger } from './core/logger.js';
import { Orchestrator } from './core/orchestrator.js';
import { MemoryStore } from './memory/store.js';
import { AuditTrail } from './protocols/audit-trail.js';
import { CircuitBreakerRegistry } from './healing/circuit-breaker.js';
import { createGateway } from './gateway/server.js';
import { createWebhookRoutes } from './gateway/routes.js';
import { createAdminRoutes } from './gateway/admin-routes.js';
import { createUserRoutes } from './gateway/user-routes.js';
import { createPartnerRoutes } from './gateway/partner-routes.js';
import { createDeveloperRoutes } from './gateway/developer-routes.js';
import { ChannelManager } from './channels/manager.js';
import { TelegramChannel } from './channels/telegram.js';
import { SmsChannel } from './channels/sms.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { HookEngine } from './hooks/engine.js';
import { DaemonLoop } from './daemon/loop.js';
import { hashPassword } from './auth/tokens.js';
import type { ChannelMessage } from './core/types.js';

// Import agent tools
import { walletTools } from './agents/wallet/index.js';
import { usPaymentTools } from './agents/us-payment/index.js';
import { paymentTools } from './agents/payment/index.js';
import { bankingTools } from './agents/banking/index.js';
import { financialTools } from './agents/financial/index.js';

async function main(): Promise<void> {
  const logger = createLogger('promptpay');
  logger.info('═══════════════════════════════════════════');
  logger.info(' uPromptPay v1.2 — Starting...');
  logger.info(` Domain: ${CONFIG.platform.domainUrl}`);
  logger.info('═══════════════════════════════════════════');

  // ── 1. Memory Store ──
  const memory = new MemoryStore(logger);
  const db = memory.getDb();
  logger.info('Memory store initialized');

  // Seed data
  memory.seedAchievements();
  memory.seedDefaultCashbackRules();
  memory.seedOwnerAccount(hashPassword);

  // ── 2. Audit Trail ──
  const auditTrail = new AuditTrail(db, logger);
  auditTrail.record('system', 'boot', 'upromptpay', { version: CONFIG.platform.version, domain: CONFIG.platform.domainUrl });

  // ── 3. Circuit Breakers ──
  const circuitBreakers = new CircuitBreakerRegistry(CONFIG.healing, logger);

  // ── 4. Orchestrator ──
  const orchestrator = new Orchestrator(logger);
  const memoryHandle = memory.createMemoryHandle('orchestrator');
  orchestrator.setMemoryHandle(memoryHandle);

  // ── 5. Register Tools (45 across 5 agents) ──
  orchestrator.registerTools(walletTools);
  logger.info(`Nexus (wallet): ${walletTools.length} tools`);

  orchestrator.registerTools(usPaymentTools);
  logger.info(`Janus (us-payment): ${usPaymentTools.length} tools`);

  orchestrator.registerTools(paymentTools);
  logger.info(`Mercury (payment): ${paymentTools.length} tools`);

  orchestrator.registerTools(bankingTools);
  logger.info(`Plutus (banking): ${bankingTools.length} tools`);

  orchestrator.registerTools(financialTools);
  logger.info(`Atlas (financial): ${financialTools.length} tools`);

  // ── 6. Hook Engine ──
  const hookEngine = new HookEngine(db, logger);
  logger.info('Hook engine initialized (9 modules)');

  // ── 7. Channels ──
  const channelManager = new ChannelManager(logger);
  const telegramChannel = new TelegramChannel(logger);
  const whatsappChannel = new WhatsAppChannel(logger);
  channelManager.register(telegramChannel);
  channelManager.register(new SmsChannel(logger));
  channelManager.register(whatsappChannel);

  // ── 7b. Inbound Message Bridge ──
  // Route inbound Telegram/WhatsApp messages to the AI orchestrator
  channelManager.on('message', async (msg: ChannelMessage) => {
    if (msg.direction !== 'inbound') return;

    logger.info(`[Channel] Inbound ${msg.channelType} from ${msg.senderId}: ${msg.content.slice(0, 50)}`);
    auditTrail.record('channel', 'message_in', msg.channelType, {
      senderId: msg.senderId, contentLength: msg.content.length,
    });

    try {
      // Look up or create a channel session
      const sessionKey = `${msg.channelType}:${msg.senderId}`;
      let session = db.prepare(
        'SELECT * FROM channel_sessions WHERE channel_type = ? AND channel_user_id = ?'
      ).get(msg.channelType, msg.senderId) as Record<string, unknown> | undefined;

      let history: Array<{ role: string; content: string }> = [];
      if (session) {
        try { history = JSON.parse(session.conversation as string || '[]'); } catch { history = []; }
      }

      // Keep last 20 messages for context
      history.push({ role: 'user', content: msg.content });
      if (history.length > 20) history = history.slice(-20);

      // Execute through orchestrator as a task
      const task = orchestrator.createTask('custom', 'medium',
        `${msg.channelType} message from ${msg.senderId}`,
        msg.content,
        { channelType: msg.channelType, senderId: msg.senderId, history },
      );
      const result = await orchestrator.executeTask(task);

      // Extract response text
      const responseText = typeof result.output === 'string'
        ? result.output
        : (result.output ? JSON.stringify(result.output) : 'I received your message. How can I help you?');

      // Send reply back through the same channel
      await channelManager.sendMessage(msg.channelType, msg.senderId, responseText);

      // Update conversation history
      history.push({ role: 'assistant', content: responseText });
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO channel_sessions (channel_type, channel_user_id, conversation, last_message_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(channel_type, channel_user_id) DO UPDATE SET
          conversation = ?, last_message_at = ?
      `).run(msg.channelType, msg.senderId, JSON.stringify(history), now, now,
        JSON.stringify(history), now);

      logger.info(`[Channel] Reply sent to ${msg.senderId} via ${msg.channelType}`);
    } catch (err) {
      logger.error(`[Channel] Error processing inbound message: ${err}`);
      // Try to send error message back
      try {
        await channelManager.sendMessage(msg.channelType, msg.senderId,
          'Sorry, I encountered an error. Please try again.');
      } catch { /* silent */ }
    }
  });

  // ── 8. Gateway ──
  const { app, server } = createGateway({ orchestrator, memory, logger });

  // Webhook routes
  const webhookRouter = createWebhookRoutes({
    logger,
    onPaymentEvent: (provider, event) => {
      auditTrail.record('webhook', `${provider}_event`, provider, event);
      const eventType = event.type as string || '';
      if (eventType.includes('succeeded') || eventType.includes('completed')) {
        const userId = (event.metadata as Record<string, string>)?.userId;
        if (userId) {
          hookEngine.onTransactionCompleted(userId, {
            id: String(event.id || ''),
            userId,
            amount: Number(event.amount || 0) / 100,
            currency: String(event.currency || 'usd'),
            type: 'payment',
            merchant: provider,
            category: 'payment',
          });
        }
      }
    },
  });
  app.use(webhookRouter);

  // WhatsApp inbound webhook (Twilio sends POST to this URL)
  app.post('/webhooks/whatsapp', (req, res) => {
    const { From, Body, ProfileName } = req.body as Record<string, string>;
    if (From && Body) {
      whatsappChannel.handleInbound(From, Body, ProfileName);
    }
    // Twilio expects 200 OK with empty TwiML
    res.type('text/xml').send('<Response></Response>');
  });

  // User routes (auth, settings, API key management)
  const userRouter = createUserRoutes({ memory, logger });
  app.use(userRouter);

  // Developer API routes (API key management + /api/v1/chat, /api/v1/task)
  const devRouter = createDeveloperRoutes({ memory, orchestrator, logger });
  app.use(devRouter);

  // Partner routes (bank partnership management)
  const partnerRouter = createPartnerRoutes({ memory, auditTrail, hookEngine, logger });
  app.use(partnerRouter);

  // Admin routes (dashboard, hooks, providers, audit)
  const adminRouter = createAdminRoutes({
    orchestrator: orchestrator as unknown as Parameters<typeof createAdminRoutes>[0]['orchestrator'],
    memory, auditTrail, hookEngine, circuitBreakers,
    channelManager, daemon: null as unknown as DaemonLoop,
    config: CONFIG, logger,
  });
  app.use(adminRouter);

  // ── 9. Daemon ──
  const daemon = new DaemonLoop({ orchestrator, db, auditTrail, hookEngine, logger });

  // ── 10. Start everything ──
  orchestrator.start();
  await channelManager.startAll();
  daemon.start();

  const channelStatus = channelManager.getStatus();
  const activeChannels = channelStatus.filter(c => c.active).map(c => c.channel);

  server.listen(CONFIG.gateway.port, CONFIG.gateway.host, () => {
    logger.info('═══════════════════════════════════════════');
    logger.info(` uPromptPay v1.2 ONLINE`);
    logger.info(` Local:  http://${CONFIG.gateway.host}:${CONFIG.gateway.port}`);
    logger.info(` Domain: ${CONFIG.platform.domainUrl}`);
    logger.info(` Tools: ${orchestrator.getState().toolCount}`);
    logger.info(` Hooks: 9 modules active`);
    logger.info(` Channels: ${activeChannels.length > 0 ? activeChannels.join(', ') : 'none (configure tokens in .env)'}`);
    logger.info(` Dev API: /api/v1/chat, /api/v1/task`);
    logger.info(` Auth: Multi-tenant (Owner + Partner + User + Developer)`);
    logger.info(` Admin: /${CONFIG.admin.secretPath}`);
    logger.info(` Owner: ${CONFIG.auth.ownerEmail}`);
    logger.info('═══════════════════════════════════════════');

    auditTrail.record('system', 'online', 'promptpay', {
      port: CONFIG.gateway.port,
      tools: orchestrator.getState().toolCount,
      channels: activeChannels,
    });
  });

  // ── Graceful shutdown ──
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down PromptPay...');
    daemon.stop();
    await channelManager.stopAll();
    orchestrator.stop();
    server.close();
    auditTrail.record('system', 'shutdown', 'promptpay', {});
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
