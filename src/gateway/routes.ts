// ═══════════════════════════════════════════════════════════════
// PromptPay :: Webhook Routes
// Stripe, M-Pesa, Flutterwave, Paystack, Reloadly, Wise webhook handlers
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import type { LoggerHandle } from '../core/types.js';

export interface WebhookDependencies {
  logger: LoggerHandle;
  onPaymentEvent?: (provider: string, event: Record<string, unknown>) => void;
}

export function createWebhookRoutes(deps: WebhookDependencies): Router {
  const router = Router();

  // ── Stripe Webhooks ──
  router.post('/webhooks/stripe', (req: Request, res: Response) => {
    deps.logger.info('[Webhook] Stripe event received');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('stripe', event);
    }

    res.json({ received: true });
  });

  // ── M-Pesa Callbacks ──
  router.post('/webhooks/mpesa', (req: Request, res: Response) => {
    deps.logger.info('[Webhook] M-Pesa callback received');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('mpesa', event);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  });

  // ── Flutterwave Webhooks ──
  router.post('/webhooks/flutterwave', (req: Request, res: Response) => {
    deps.logger.info('[Webhook] Flutterwave event received');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('flutterwave', event);
    }

    res.json({ status: 'success' });
  });

  // ── Paystack Webhooks ──
  router.post('/webhooks/paystack', (req: Request, res: Response) => {
    deps.logger.info('[Webhook] Paystack event received');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('paystack', event);
    }

    res.json({ status: 'ok' });
  });

  // ── Reloadly Webhooks (Airtime status) ──
  router.post('/webhooks/reloadly', (req: Request, res: Response) => {
    deps.logger.info('[Webhook] Reloadly event received');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('reloadly', event);
    }

    res.json({ status: 'ok' });
  });

  // ── Wise Webhooks (Transfer status) ──
  router.post('/webhooks/wise', (req: Request, res: Response) => {
    deps.logger.info('[Webhook] Wise event received');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('wise', event);
    }

    res.json({ status: 'ok' });
  });

  return router;
}
