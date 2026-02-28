// ═══════════════════════════════════════════════════════════════
// PromptPay v2.0 :: Entry Point
// Agentic-first platform — 9 agents (4 agentic + 5 payment), ~93 tools
// Aria (Shopping) + Sage (Advisor) + Quant (Trading) + Otto (Assistant)
// + Nexus + Janus + Mercury + Plutus + Atlas
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
import { createPosRoutes } from './gateway/pos-routes.js';
import { createHrRoutes } from './gateway/hr-routes.js';
import { createCalendarRoutes } from './gateway/calendar-routes.js';
import { HookEngine } from './hooks/engine.js';
import { FeeEngine } from './hooks/fees.js';
import { DaemonLoop } from './daemon/loop.js';
import { hashPassword } from './auth/tokens.js';
import { ChannelManager } from './channels/manager.js';
import { EmailChannel, EmailTemplates } from './channels/email.js';
import { PushChannel } from './channels/push.js';
import { TelegramChannel } from './channels/telegram.js';

// Import agentic agent tools (primary)
import { shoppingTools } from './agents/shopping/index.js';
import { assistantTools } from './agents/assistant/index.js';

// Import payment infrastructure agent tools
import { walletTools } from './agents/wallet/index.js';
import { usPaymentTools } from './agents/us-payment/index.js';
import { paymentTools } from './agents/payment/index.js';
import { bankingTools } from './agents/banking/index.js';
import { financialTools } from './agents/financial/index.js';

async function main(): Promise<void> {
  const logger = createLogger('promptpay');
  logger.info('═══════════════════════════════════════════');
  logger.info(' PromptPay v2.0 — Starting...');
  logger.info(' Agentic-First Platform');
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
  memory.seedRoles();

  // ── 2. Audit Trail ──
  const auditTrail = new AuditTrail(db, logger);
  auditTrail.record('system', 'boot', 'upromptpay', { version: CONFIG.platform.version, domain: CONFIG.platform.domainUrl });

  // ── 3. Circuit Breakers ──
  const circuitBreakers = new CircuitBreakerRegistry(CONFIG.healing, logger);

  // ── 4. Orchestrator ──
  const orchestrator = new Orchestrator(logger);
  const memoryHandle = memory.createMemoryHandle('orchestrator');
  orchestrator.setMemoryHandle(memoryHandle);

  // ── 5. Register Tools (~93 across 9 agents) ──

  // Agentic agents (primary)
  orchestrator.registerTools(shoppingTools);
  logger.info(`Aria (shopping): ${shoppingTools.length} tools`);

  orchestrator.registerTools(assistantTools);
  logger.info(`Otto (assistant): ${assistantTools.length} tools`);

  // Payment infrastructure agents
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

  // ── 7b. Channel Manager (Email + Push) ──
  const channelManager = new ChannelManager(logger);
  const emailChannel = new EmailChannel(logger);
  const pushChannel = new PushChannel(logger, db);
  channelManager.register(emailChannel);
  channelManager.register(pushChannel);
  await channelManager.startAll();

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
          const txAmount = Number(event.amount || 0) / 100;
          const txCurrency = String(event.currency || 'usd');
          hookEngine.onTransactionCompleted(userId, {
            id: String(event.id || ''),
            userId,
            amount: txAmount,
            currency: txCurrency,
            type: 'payment',
            merchant: provider,
            category: 'payment',
          });

          // Send transaction notifications (fire-and-forget)
          const txUser = db.prepare('SELECT email, display_name FROM users WHERE id = ?')
            .get(userId) as { email: string; display_name: string } | undefined;
          if (txUser?.email) {
            const { subject, html } = EmailTemplates.transactionConfirmation({
              type: 'payment', amount: txAmount, currency: txCurrency, merchant: provider,
            });
            emailChannel.sendEmail(txUser.email, subject, html).catch(() => {});
            pushChannel.sendMessage(userId, JSON.stringify({
              title: 'Payment Confirmed',
              body: `${txCurrency.toUpperCase()} ${txAmount.toFixed(2)} payment processed`,
              url: '/',
            })).catch(() => {});
          }
        }
      }
    },
  });
  app.use(webhookRouter);

  // User routes (auth, settings, API key management)
  const userRouter = createUserRoutes({ memory, logger, emailChannel, pushChannel });
  app.use(userRouter);

  // Developer API routes (API key management + /api/v1/chat, /api/v1/task)
  const devRouter = createDeveloperRoutes({ memory, orchestrator, logger });
  app.use(devRouter);

  // Partner routes (bank partnership management)
  const partnerRouter = createPartnerRoutes({ memory, auditTrail, hookEngine, logger });
  app.use(partnerRouter);

  // POS agent routes (PromptPay Points)
  const posRouter = createPosRoutes({ memory, auditTrail, logger });
  app.use(posRouter);

  // HR & Hiring routes (careers + admin pipeline)
  const hrRouter = createHrRoutes({ memory, auditTrail, logger });
  app.use(hrRouter);

  // Calendar AI routes (Chrono agent — admin + partner paid feature)
  const calendarRouter = createCalendarRoutes({ memory, auditTrail, logger });
  app.use(calendarRouter);

  // Admin routes (dashboard, hooks, providers, audit)
  const adminRouter = createAdminRoutes({
    orchestrator: orchestrator as unknown as Parameters<typeof createAdminRoutes>[0]['orchestrator'],
    memory, auditTrail, hookEngine, circuitBreakers,
    channelManager: channelManager as unknown as Parameters<typeof createAdminRoutes>[0]['channelManager'],
    daemon: null as unknown as DaemonLoop,
    feeEngine,
    config: CONFIG, logger,
  });
  app.use(adminRouter);

  // ── 9. Telegram Channel + Daemon ──
  const telegram = new TelegramChannel(logger);
  channelManager.register(telegram);
  await telegram.start();

  const daemon = new DaemonLoop({ orchestrator, db, auditTrail, hookEngine, telegram, feeEngine, logger });

  // ── 10. Start everything ──
  orchestrator.start();
  daemon.start();

  server.listen(CONFIG.gateway.port, CONFIG.gateway.host, () => {
    logger.info('═══════════════════════════════════════════');
    logger.info(` PromptPay v2.0 ONLINE — Agentic-First`);
    logger.info(` Local:  http://${CONFIG.gateway.host}:${CONFIG.gateway.port}`);
    logger.info(` Domain: ${CONFIG.platform.domainUrl}`);
    logger.info(` Agents: 7 (Aria, Otto + Nexus, Janus, Mercury, Plutus, Atlas)`);
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
