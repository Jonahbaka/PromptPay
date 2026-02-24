// ═══════════════════════════════════════════════════════════════
// PromptPay v1.0 :: Entry Point
// Standalone fintech platform — 5 agents, 45 tools, 9 hooks
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
import { ChannelManager } from './channels/manager.js';
import { TelegramChannel } from './channels/telegram.js';
import { SmsChannel } from './channels/sms.js';
import { HookEngine } from './hooks/engine.js';
import { DaemonLoop } from './daemon/loop.js';

// Import agent tools
import { walletTools } from './agents/wallet/index.js';
import { usPaymentTools } from './agents/us-payment/index.js';
import { paymentTools } from './agents/payment/index.js';
import { bankingTools } from './agents/banking/index.js';
import { financialTools } from './agents/financial/index.js';

async function main(): Promise<void> {
  const logger = createLogger('promptpay');
  logger.info('═══════════════════════════════════════════');
  logger.info(' PromptPay v1.0 — Starting...');
  logger.info('═══════════════════════════════════════════');

  // ── 1. Memory Store ──
  const memory = new MemoryStore(logger);
  const db = memory.getDb();
  logger.info('Memory store initialized');

  // Seed data
  memory.seedAchievements();
  memory.seedDefaultCashbackRules();

  // ── 2. Audit Trail ──
  const auditTrail = new AuditTrail(db, logger);
  auditTrail.record('system', 'boot', 'promptpay', { version: '1.0.0' });

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
  channelManager.register(new TelegramChannel(logger));
  channelManager.register(new SmsChannel(logger));

  // ── 8. Gateway ──
  const { app, server } = createGateway({ orchestrator, logger });

  // Webhook routes
  const webhookRouter = createWebhookRoutes({
    logger,
    onPaymentEvent: (provider, event) => {
      auditTrail.record('webhook', `${provider}_event`, provider, event);
      // Trigger hook engine for completed payments
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

  // Admin routes
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

  server.listen(CONFIG.gateway.port, CONFIG.gateway.host, () => {
    logger.info('═══════════════════════════════════════════');
    logger.info(` PromptPay v1.0 ONLINE`);
    logger.info(` http://${CONFIG.gateway.host}:${CONFIG.gateway.port}`);
    logger.info(` Tools: ${orchestrator.getState().toolCount}`);
    logger.info(` Hooks: 9 modules active`);
    logger.info(` Admin: /admin/dashboard`);
    logger.info('═══════════════════════════════════════════');

    auditTrail.record('system', 'online', 'promptpay', {
      port: CONFIG.gateway.port,
      tools: orchestrator.getState().toolCount,
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
