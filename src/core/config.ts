// ═══════════════════════════════════════════════════════════════
// PromptPay :: System Configuration
// ═══════════════════════════════════════════════════════════════

import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (!v && fallback === undefined) throw new Error(`Missing env: ${key}`);
  return v || fallback || '';
}

export const CONFIG = {
  // ── AI Model ──
  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL', 'claude-opus-4-6'),
    maxTokens: 16384,
    temperature: 0.3,
  },

  // ── Platform ──
  promptpay: {
    apiUrl: env('PROMPTPAY_API_URL', 'https://promptpay.app/api'),
    webhookSecret: env('PROMPTPAY_WEBHOOK_SECRET', ''),
  },

  // ── Gateway ──
  gateway: {
    port: parseInt(env('GATEWAY_PORT', '19000')),
    host: env('GATEWAY_HOST', '127.0.0.1'),
    secret: env('GATEWAY_SECRET', 'promptpay-local'),
  },

  // ── Database ──
  database: {
    path: env('SQLITE_PATH', path.join(process.cwd(), 'data', 'promptpay.db')),
  },

  // ── Daemon ──
  daemon: {
    cycleIntervalMs: parseInt(env('DAEMON_CYCLE_INTERVAL_MS', '3600000')),
    selfEvalIntervalMs: parseInt(env('SELF_EVAL_INTERVAL_MS', '86400000')),
  },

  // ── Logging ──
  logging: {
    level: env('LOG_LEVEL', 'info') as 'debug' | 'info' | 'warn' | 'error',
    dir: env('LOG_DIR', path.join(process.cwd(), 'logs')),
  },

  // ── System Prompt ──
  systemPrompt: {
    path: path.join(process.cwd(), 'config', 'system-prompt.md'),
  },

  // ── Healing ──
  healing: {
    healthCheckIntervalMs: parseInt(env('HEALTH_CHECK_INTERVAL_MS', '30000')),
    circuitBreakerThreshold: parseInt(env('CIRCUIT_BREAKER_THRESHOLD', '5')),
    circuitBreakerCooldownMs: parseInt(env('CIRCUIT_BREAKER_COOLDOWN_MS', '300000')),
  },

  // ── Messaging Channels ──
  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN', ''),
    webhookUrl: env('TELEGRAM_WEBHOOK_URL', ''),
  },
  sms: {
    twilioAccountSid: env('TWILIO_ACCOUNT_SID', ''),
    twilioAuthToken: env('TWILIO_AUTH_TOKEN', ''),
    twilioPhoneNumber: env('TWILIO_PHONE_NUMBER', ''),
  },

  // ══════════════════════════════════════════════════════════
  // PAYMENT PROVIDERS
  // ══════════════════════════════════════════════════════════

  // ── Stripe (Janus + Nexus) ──
  stripe: {
    secretKey: env('STRIPE_SECRET_KEY', ''),
    publishableKey: env('STRIPE_PUBLISHABLE_KEY', ''),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
    connectEnabled: env('STRIPE_CONNECT_ENABLED', 'false') === 'true',
  },

  // ── M-Pesa (Mercury) ──
  mpesa: {
    consumerKey: env('MPESA_CONSUMER_KEY', ''),
    consumerSecret: env('MPESA_CONSUMER_SECRET', ''),
    shortcode: env('MPESA_SHORTCODE', ''),
    passkey: env('MPESA_PASSKEY', ''),
    environment: env('MPESA_ENVIRONMENT', 'sandbox') as 'sandbox' | 'production',
  },

  // ── MTN Mobile Money (Mercury) ──
  mtnMomo: {
    subscriptionKey: env('MTN_MOMO_SUBSCRIPTION_KEY', ''),
    apiUser: env('MTN_MOMO_API_USER', ''),
    apiKey: env('MTN_MOMO_API_KEY', ''),
    environment: env('MTN_MOMO_ENVIRONMENT', 'sandbox') as 'sandbox' | 'production',
  },

  // ── Flutterwave (Mercury) ──
  flutterwave: {
    publicKey: env('FLUTTERWAVE_PUBLIC_KEY', ''),
    secretKey: env('FLUTTERWAVE_SECRET_KEY', ''),
    encryptionKey: env('FLUTTERWAVE_ENCRYPTION_KEY', ''),
  },

  // ── Paystack (Mercury) ──
  paystack: {
    secretKey: env('PAYSTACK_SECRET_KEY', ''),
    publicKey: env('PAYSTACK_PUBLIC_KEY', ''),
  },

  // ── Razorpay (Mercury) ──
  razorpay: {
    keyId: env('RAZORPAY_KEY_ID', ''),
    keySecret: env('RAZORPAY_KEY_SECRET', ''),
  },

  // ── Mono (Plutus) ──
  mono: {
    secretKey: env('MONO_SECRET_KEY', ''),
  },

  // ── Stitch (Plutus) ──
  stitch: {
    clientId: env('STITCH_CLIENT_ID', ''),
    clientSecret: env('STITCH_CLIENT_SECRET', ''),
  },

  // ── Wallet & uPromptPay (Nexus) ──
  wallet: {
    maxBalanceUsd: parseFloat(env('WALLET_MAX_BALANCE_USD', '50000')),
    maxTransferUsd: parseFloat(env('WALLET_MAX_TRANSFER_USD', '10000')),
    maxBillAmountUsd: parseFloat(env('WALLET_MAX_BILL_USD', '25000')),
    p2pEnabled: env('WALLET_P2P_ENABLED', 'true') === 'true',
    payForwardEnabled: env('WALLET_PAY_FORWARD_ENABLED', 'true') === 'true',
  },

  // ══════════════════════════════════════════════════════════
  // ENGAGEMENT HOOKS
  // ══════════════════════════════════════════════════════════

  hooks: {
    streakResetHour: parseInt(env('HOOKS_STREAK_RESET_HOUR', '0')),
    cashbackMaxDailyUsd: parseFloat(env('HOOKS_CASHBACK_MAX_DAILY_USD', '50')),
    referralBonusUsd: parseFloat(env('HOOKS_REFERRAL_BONUS_USD', '10')),
    referralTiers: parseInt(env('HOOKS_REFERRAL_TIERS', '2')),
    loyaltyPointsPerDollar: parseInt(env('HOOKS_LOYALTY_POINTS_PER_DOLLAR', '10')),
    insightsFrequency: env('HOOKS_INSIGHTS_FREQUENCY', 'weekly') as 'daily' | 'weekly' | 'monthly',
    roundUpEnabled: env('HOOKS_ROUND_UP_ENABLED', 'true') === 'true',
    reminderLeadTimeHours: parseInt(env('HOOKS_REMINDER_LEAD_TIME_HOURS', '24')),
  },
} as const;

export type Config = typeof CONFIG;
