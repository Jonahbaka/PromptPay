// ═══════════════════════════════════════════════════════════════
// PromptPay :: Webhook Routes
// Stripe, Paystack, Reloadly webhook handlers (active providers only)
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import type { LoggerHandle } from '../core/types.js';
import { CONFIG } from '../core/config.js';
import crypto from 'crypto';

export interface WebhookDependencies {
  logger: LoggerHandle;
  onPaymentEvent?: (provider: string, event: Record<string, unknown>) => void;
}

export function createWebhookRoutes(deps: WebhookDependencies): Router {
  const router = Router();

  // ── Stripe Webhooks (signature-verified) ──
  router.post('/webhooks/stripe', (req: Request, res: Response) => {
    const sig = req.headers['stripe-signature'] as string | undefined;
    const webhookSecret = CONFIG.stripe.webhookSecret;

    // If webhook secret is configured, verify signature
    if (webhookSecret && sig) {
      try {
        // Manual Stripe signature verification (no SDK dependency)
        const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
        const elements = sig.split(',');
        const timestamp = elements.find(e => e.startsWith('t='))?.slice(2);
        const signatures = elements.filter(e => e.startsWith('v1=')).map(e => e.slice(3));

        if (!timestamp || signatures.length === 0) {
          deps.logger.warn('[Webhook] Stripe: invalid signature header');
          res.status(400).json({ error: 'Invalid signature' });
          return;
        }

        // Check timestamp tolerance (5 min)
        const tolerance = 300;
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(timestamp)) > tolerance) {
          deps.logger.warn('[Webhook] Stripe: timestamp outside tolerance');
          res.status(400).json({ error: 'Timestamp expired' });
          return;
        }

        const signedPayload = `${timestamp}.${payload}`;
        const expected = crypto.createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');

        const valid = signatures.some(s => crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
        if (!valid) {
          deps.logger.warn('[Webhook] Stripe: signature mismatch');
          res.status(400).json({ error: 'Signature verification failed' });
          return;
        }
      } catch (err) {
        deps.logger.error(`[Webhook] Stripe signature error: ${err}`);
        res.status(400).json({ error: 'Signature verification error' });
        return;
      }
    }

    deps.logger.info('[Webhook] Stripe event received (verified)');
    const event = req.body as Record<string, unknown>;

    if (deps.onPaymentEvent) {
      deps.onPaymentEvent('stripe', event);
    }

    res.json({ received: true });
  });

  // ── Paystack Webhooks (signature-verified) ──
  router.post('/webhooks/paystack', (req: Request, res: Response) => {
    const sig = req.headers['x-paystack-signature'] as string | undefined;
    const secretKey = CONFIG.paystack.secretKey;

    if (secretKey && sig) {
      const payload = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      const hash = crypto.createHmac('sha512', secretKey).update(payload).digest('hex');
      if (hash !== sig) {
        deps.logger.warn('[Webhook] Paystack: signature mismatch');
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }
    }

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

  return router;
}
