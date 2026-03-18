// ═══════════════════════════════════════════════════════════════
// PromptPay :: Fintech Routes
// Transaction lifecycle, commission, providers, routing, ledger,
// webhooks, reconciliation, settlements, payouts
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { authenticate, requireRole } from '../auth/middleware.js';
import type { FintechCore } from '../fintech/init.js';
import type { WebhookPayload } from '../fintech/providers/index.js';

export function createFintechRoutes(fintechCore: FintechCore): Router {
  const router = Router();
  const { providers, routing, commission, transactions, ledger } = fintechCore;

  // ═══════════════════════════════════════════════
  // TRANSACTIONS
  // ═══════════════════════════════════════════════

  // ── Create a new transaction ──
  router.post('/api/fintech/transactions', authenticate, async (req: Request, res: Response) => {
    try {
      const {
        transactionType, productType, amountMinor, currency,
        customerFeeMinor, providerFeeMinor, idempotencyKey, metadata,
        region,
      } = req.body;

      if (!transactionType || amountMinor == null) {
        res.status(400).json({ error: 'transactionType and amountMinor are required' });
        return;
      }

      const userId = req.auth!.userId;
      const tenantId = req.auth!.tenantId || undefined;

      // 1. Create transaction via lifecycle engine
      const tx = transactions.create({
        tenantId,
        userId,
        transactionType,
        productType: productType || undefined,
        amountMinor: Number(amountMinor),
        currency: currency || 'NGN',
        customerFeeMinor: Number(customerFeeMinor || 0),
        providerFeeMinor: Number(providerFeeMinor || 0),
        idempotencyKey: idempotencyKey || undefined,
        metadata: metadata || {},
      });

      // 2. Route to a provider via routing engine
      const routingDecision = routing.resolve(
        {
          transactionType,
          productType: productType || undefined,
          tenantId,
          region: region || undefined,
        },
        tx.id,
      );

      // Update transaction with chosen provider
      transactions.transition(tx.id, 'pending_provider', userId, 'api', `Routed to ${routingDecision.providerId}`);

      // 3. Calculate commission via commission engine
      const commissionBreakdown = commission.calculateAndStore({
        transactionId: tx.id,
        transactionType,
        productType: productType || undefined,
        providerId: routingDecision.providerId,
        grossAmountMinor: Number(amountMinor),
        providerFeeMinor: Number(providerFeeMinor || 0),
        currency: currency || 'NGN',
        tenantId,
        region: region || undefined,
      });

      // 4. Post ledger entries via ledger engine
      try {
        const platformAccount = ledger.ensureAccount('PLATFORM_REVENUE', 'platform', null, 'Platform Revenue', currency || 'NGN');
        const providerAccount = ledger.ensureAccount('PROVIDER_RECEIVABLE', 'provider', routingDecision.providerId, `${routingDecision.providerId} Receivable`, currency || 'NGN');

        const entries = [
          { accountId: providerAccount, entryType: 'debit' as const, amountMinor: Number(amountMinor), currency: currency || 'NGN' },
          { accountId: platformAccount, entryType: 'credit' as const, amountMinor: Number(amountMinor), currency: currency || 'NGN' },
        ];

        ledger.postJournal({
          referenceType: 'transaction',
          referenceId: tx.id,
          description: `Transaction ${tx.id} — ${transactionType} via ${routingDecision.providerId}`,
          postedBy: userId,
          entries,
        });
      } catch {
        // Ledger posting is best-effort; transaction still valid
      }

      // 5. Return full transaction + commission breakdown
      const updated = transactions.getById(tx.id);
      res.status(201).json({
        transaction: updated,
        routing: routingDecision,
        commission: commissionBreakdown,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── List transactions with filters ──
  router.get('/api/fintech/transactions', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const role = req.auth!.role;
      const tenantId = req.auth!.tenantId || undefined;

      const filters: Record<string, any> = {
        status: req.query.status as string || undefined,
        transactionType: req.query.transactionType as string || undefined,
        limit: Number(req.query.limit) || 50,
        offset: Number(req.query.offset) || 0,
      };

      // Non-owner/partner_admin users can only see their own
      if (role !== 'owner' && role !== 'partner_admin') {
        filters.userId = userId;
      } else if (req.query.userId) {
        filters.userId = req.query.userId as string;
      }

      // Tenant scoping for partner_admin
      if (role === 'partner_admin' && tenantId) {
        filters.tenantId = tenantId;
      } else if (req.query.tenantId) {
        filters.tenantId = req.query.tenantId as string;
      }

      const results = transactions.query(filters);
      res.json({ transactions: results, count: results.length, ...filters });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Get transaction by ID ──
  router.get('/api/fintech/transactions/:id', authenticate, (req: Request, res: Response) => {
    try {
      const tx = transactions.getById(String(req.params.id));
      if (!tx) {
        res.status(404).json({ error: 'Transaction not found' });
        return;
      }
      res.json(tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Transition transaction status ──
  router.post('/api/fintech/transactions/:id/transition', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    try {
      const { toStatus, reason } = req.body;
      if (!toStatus) {
        res.status(400).json({ error: 'toStatus is required' });
        return;
      }

      const tx = transactions.transition(
        String(req.params.id),
        toStatus,
        req.auth!.userId,
        'api',
        reason || undefined,
      );
      res.json(tx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not found')) {
        res.status(404).json({ error: msg });
      } else if (msg.includes('Invalid transition') || msg.includes('terminal status')) {
        res.status(400).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  // ── Get state history for a transaction ──
  router.get('/api/fintech/transactions/:id/history', authenticate, (req: Request, res: Response) => {
    try {
      const history = transactions.getHistory(String(req.params.id));
      res.json({ history });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════
  // COMMISSION
  // ═══════════════════════════════════════════════

  // ── Preview commission for a hypothetical transaction ──
  router.get('/api/fintech/commission/preview', authenticate, (req: Request, res: Response) => {
    try {
      const { transactionType, productType, providerId, grossAmountMinor, providerFeeMinor, currency, tenantId, region, agentId } = req.query;

      if (!transactionType || !grossAmountMinor) {
        res.status(400).json({ error: 'transactionType and grossAmountMinor are required' });
        return;
      }

      const breakdown = commission.calculate({
        transactionId: 'preview',
        transactionType: transactionType as string,
        productType: productType as string || undefined,
        providerId: (providerId as string) || 'paystack',
        grossAmountMinor: Number(grossAmountMinor),
        providerFeeMinor: Number(providerFeeMinor || 0),
        currency: (currency as string) || 'NGN',
        tenantId: tenantId as string || undefined,
        region: region as string || undefined,
        agentId: agentId as string || undefined,
      });

      res.json({ preview: true, breakdown });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── List commission rules ──
  router.get('/api/fintech/commission/rules', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const db = (commission as any).db;
      const rules = db.prepare(
        'SELECT * FROM commission_rules WHERE is_active = 1 ORDER BY priority ASC LIMIT ? OFFSET ?'
      ).all(limit, offset);
      res.json({ rules });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Create commission rule ──
  router.post('/api/fintech/commission/rules', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    try {
      const {
        name, priority, scopeType, scopeId, transactionType, productType, providerId,
        platformShareBps, agentShareBps, supervisorShareBps, tenantShareBps,
        regionalShareBps, reserveHoldbackBps, flatFeeMinor, capAmountMinor, floorAmountMinor,
        minNetRevenueMinor, effectiveFrom, effectiveTo,
      } = req.body;

      if (!name || platformShareBps == null || agentShareBps == null) {
        res.status(400).json({ error: 'name, platformShareBps, and agentShareBps are required' });
        return;
      }

      const db = (commission as any).db;
      db.prepare(`
        INSERT INTO commission_rules (
          id, name, priority, scope_type, scope_id, transaction_type, product_type, provider_id,
          platform_share_bps, agent_share_bps, supervisor_share_bps, tenant_share_bps,
          regional_share_bps, reserve_holdback_bps, flat_fee_minor, cap_amount_minor, floor_amount_minor,
          min_net_revenue_minor, effective_from, effective_to, is_active, version
        ) VALUES (
          lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, 1, 1
        )
      `).run(
        name,
        Number(priority || 500),
        scopeType || 'system',
        scopeId || null,
        transactionType || null,
        productType || null,
        providerId || null,
        Number(platformShareBps),
        Number(agentShareBps),
        Number(supervisorShareBps || 0),
        Number(tenantShareBps || 0),
        Number(regionalShareBps || 0),
        Number(reserveHoldbackBps || 0),
        Number(flatFeeMinor || 0),
        capAmountMinor != null ? Number(capAmountMinor) : null,
        floorAmountMinor != null ? Number(floorAmountMinor) : null,
        minNetRevenueMinor != null ? Number(minNetRevenueMinor) : null,
        effectiveFrom || new Date().toISOString(),
        effectiveTo || null,
      );

      res.status(201).json({ success: true, message: 'Commission rule created' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════
  // PROVIDERS
  // ═══════════════════════════════════════════════

  // ── List registered providers + health ──
  router.get('/api/fintech/providers', authenticate, requireRole('owner', 'partner_admin'), async (_req: Request, res: Response) => {
    try {
      const allProviders = providers.listAll();
      const providerList = allProviders.map(p => ({
        slug: p.slug,
        displayName: p.displayName,
        providerType: p.providerType,
        capabilities: p.getCapabilities(),
      }));
      res.json({ providers: providerList, count: providerList.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Run health check on all providers ──
  router.post('/api/fintech/providers/health', authenticate, requireRole('owner'), async (_req: Request, res: Response) => {
    try {
      const healthMap = await providers.healthCheckAll();
      const results: Record<string, unknown> = {};
      for (const [slug, health] of healthMap) {
        results[slug] = health;
      }
      res.json({ health: results });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════
  // ROUTING
  // ═══════════════════════════════════════════════

  // ── List routing rules ──
  router.get('/api/fintech/routing/rules', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const db = (routing as any).db;
      const rules = db.prepare(
        'SELECT * FROM routing_rules WHERE is_active = 1 ORDER BY priority ASC LIMIT ? OFFSET ?'
      ).all(limit, offset);
      res.json({ rules });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Create routing rule ──
  router.post('/api/fintech/routing/rules', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    try {
      const {
        name, priority, providerId, fallbackProviderId,
        transactionType, productType, tenantId, region,
        weight, effectiveFrom, effectiveTo,
      } = req.body;

      if (!name || !providerId) {
        res.status(400).json({ error: 'name and providerId are required' });
        return;
      }

      const db = (routing as any).db;
      db.prepare(`
        INSERT INTO routing_rules (
          id, name, priority, provider_id, fallback_provider_id,
          transaction_type, product_type, tenant_id, region,
          weight, effective_from, effective_to, is_active
        ) VALUES (
          lower(hex(randomblob(16))), ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, 1
        )
      `).run(
        name,
        Number(priority || 500),
        providerId,
        fallbackProviderId || null,
        transactionType || null,
        productType || null,
        tenantId || null,
        region || null,
        Number(weight || 100),
        effectiveFrom || new Date().toISOString(),
        effectiveTo || null,
      );

      res.status(201).json({ success: true, message: 'Routing rule created' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════
  // LEDGER
  // ═══════════════════════════════════════════════

  // ── List ledger accounts for current user/tenant ──
  router.get('/api/fintech/ledger/accounts', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const role = req.auth!.role;
      const tenantId = req.auth!.tenantId || undefined;

      let ownerType: string;
      let ownerId: string;

      if (role === 'owner') {
        // Owner can query any owner type
        ownerType = (req.query.ownerType as string) || 'platform';
        ownerId = (req.query.ownerId as string) || userId;
      } else if (role === 'partner_admin' && tenantId) {
        ownerType = 'tenant';
        ownerId = tenantId;
      } else {
        ownerType = 'agent';
        ownerId = userId;
      }

      const accounts = ledger.getAccountsForOwner(ownerType as any, ownerId);
      res.json({ accounts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Get entries for a ledger account ──
  router.get('/api/fintech/ledger/accounts/:id/entries', authenticate, (req: Request, res: Response) => {
    try {
      const accountId = String(req.params.id);
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const db = (ledger as any).db;
      const entries = db.prepare(
        'SELECT le.*, lj.description as journal_description, lj.posted_at FROM ledger_entries le JOIN ledger_journals lj ON le.journal_id = lj.id WHERE le.account_id = ? ORDER BY le.created_at DESC LIMIT ? OFFSET ?'
      ).all(accountId, limit, offset);
      res.json({ entries });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ── Get journal entries for a reference ──
  router.get('/api/fintech/ledger/journals/:refType/:refId', authenticate, (req: Request, res: Response) => {
    try {
      const entries = ledger.getEntriesForReference(String(req.params.refType) as any, String(req.params.refId));
      res.json({ entries });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════
  // WEBHOOKS (NO AUTH — uses provider signature verification)
  // ═══════════════════════════════════════════════

  router.post('/api/fintech/webhooks/:provider', async (req: Request, res: Response) => {
    try {
      const providerSlug = String(req.params.provider);
      const plugin = providers.get(providerSlug);

      if (!plugin) {
        res.status(404).json({ error: `Unknown provider: ${providerSlug}` });
        return;
      }

      const webhookPayload: WebhookPayload = {
        headers: req.headers as Record<string, string>,
        body: req.body,
        rawBody: typeof req.body === 'string' ? req.body : JSON.stringify(req.body),
      };

      // Verify signature
      if (plugin.verifyWebhookSignature && !plugin.verifyWebhookSignature(webhookPayload)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }

      // Handle the event
      if (!plugin.handleWebhookEvent) {
        res.status(200).json({ received: true, message: 'Provider does not handle webhook events' });
        return;
      }

      const result = await plugin.handleWebhookEvent(webhookPayload);

      if (!result.valid) {
        res.status(400).json({ error: 'Invalid webhook payload', result });
        return;
      }

      // Find matching transaction by external ID and transition
      if (result.externalId) {
        const db = (transactions as any).db;
        const tx = db.prepare('SELECT * FROM transactions WHERE external_id = ?').get(result.externalId) as any;

        if (tx && result.internalStatus && tx.status !== result.internalStatus) {
          try {
            transactions.transition(
              tx.id,
              result.internalStatus,
              'webhook',
              `${providerSlug}_webhook`,
              `Webhook event: ${result.eventType}`,
              result.metadata,
            );
          } catch {
            // Transition may fail if status is invalid — log but don't fail webhook
          }
        }
      }

      res.status(200).json({ received: true, eventType: result.eventType });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ═══════════════════════════════════════════════
  // RECONCILIATION
  // ═══════════════════════════════════════════════

  router.get('/api/fintech/reconciliation/runs', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const db = (transactions as any).db;
      const runs = db.prepare(
        'SELECT * FROM reconciliation_runs ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(limit, offset);
      res.json({ runs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Table might not exist yet — return empty
      res.json({ runs: [] });
    }
  });

  // ═══════════════════════════════════════════════
  // SETTLEMENTS
  // ═══════════════════════════════════════════════

  router.get('/api/fintech/settlements', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    try {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const db = (transactions as any).db;
      const settlements = db.prepare(
        'SELECT * FROM settlement_batches ORDER BY created_at DESC LIMIT ? OFFSET ?'
      ).all(limit, offset);
      res.json({ settlements });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Table might not exist yet — return empty
      res.json({ settlements: [] });
    }
  });

  // ═══════════════════════════════════════════════
  // PAYOUTS
  // ═══════════════════════════════════════════════

  router.get('/api/fintech/payouts', authenticate, (req: Request, res: Response) => {
    try {
      const userId = req.auth!.userId;
      const role = req.auth!.role;
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      const db = (transactions as any).db;

      let query: string;
      let params: any[];

      if (role === 'owner' || role === 'partner_admin') {
        query = 'SELECT * FROM payout_records ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params = [limit, offset];
      } else {
        query = 'SELECT * FROM payout_records WHERE recipient_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params = [userId, limit, offset];
      }

      const payouts = db.prepare(query).all(...params);
      res.json({ payouts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Table might not exist yet — return empty
      res.json({ payouts: [] });
    }
  });

  return router;
}
