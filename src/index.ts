// ═══════════════════════════════════════════════════════════════
// uPromptPay v1.4 :: Entry Point
// Multi-tenant fintech platform — 5 agents, 59 tools, 9 hooks
// PWA + Pay by Phone + Fees + Cross-Border + Agent Network + Virality
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
import { HookEngine } from './hooks/engine.js';
import { FeeEngine } from './hooks/fees.js';
import { DaemonLoop } from './daemon/loop.js';
import { hashPassword } from './auth/tokens.js';

// Import agent tools
import { walletTools } from './agents/wallet/index.js';
import { usPaymentTools } from './agents/us-payment/index.js';
import { paymentTools } from './agents/payment/index.js';
import { bankingTools } from './agents/banking/index.js';
import { financialTools } from './agents/financial/index.js';

async function main(): Promise<void> {
  const logger = createLogger('promptpay');
  logger.info('═══════════════════════════════════════════');
  logger.info(' uPromptPay v1.4 — Starting...');
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

  // ── 7. Fee Engine ──
  const feeEngine = new FeeEngine(db, logger);
  logger.info('Fee engine initialized');

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
    channelManager: null as unknown as Parameters<typeof createAdminRoutes>[0]['channelManager'],
    daemon: null as unknown as DaemonLoop,
    feeEngine,
    config: CONFIG, logger,
  });
  app.use(adminRouter);

  // ── 9. Daemon ──
  const daemon = new DaemonLoop({ orchestrator, db, auditTrail, hookEngine, logger });

  // ── 10. Start everything ──
  orchestrator.start();
  daemon.start();

  server.listen(CONFIG.gateway.port, CONFIG.gateway.host, () => {
    logger.info('═══════════════════════════════════════════');
    logger.info(` uPromptPay v1.4 ONLINE`);
    logger.info(` Local:  http://${CONFIG.gateway.host}:${CONFIG.gateway.port}`);
    logger.info(` Domain: ${CONFIG.platform.domainUrl}`);
    logger.info(` Tools: ${orchestrator.getState().toolCount}`);
    logger.info(` Hooks: 9 modules + Fee Engine`);
    logger.info(` PWA: Installable (Add to Home Screen)`);
    logger.info(` Dev API: /api/v1/chat, /api/v1/task`);
    logger.info(` Auth: Multi-tenant (Owner + Partner + User + Developer)`);
    logger.info(` Admin: /${CONFIG.admin.secretPath}`);
    logger.info(` Owner: ${CONFIG.auth.ownerEmail}`);
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
