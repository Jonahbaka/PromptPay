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
  // ── AI Models (tiered) ──
  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL', 'claude-opus-4-6'),
    maxTokens: 16384,
    temperature: 0.3,
    // Tiered models: cheap model for users, powerful model for admin/orchestrator
    userModel: env('ANTHROPIC_USER_MODEL', 'claude-haiku-4-5-20251001'),
    userMaxTokens: parseInt(env('ANTHROPIC_USER_MAX_TOKENS', '4096')),
    adminModel: env('ANTHROPIC_ADMIN_MODEL', 'claude-opus-4-6'),
  },

  // ── DeepSeek (Executive AI Board — non-agentic advisory) ──
  deepseek: {
    apiKey: env('DEEPSEEK_API_KEY', ''),
    model: env('DEEPSEEK_MODEL', 'deepseek-chat'),
    baseUrl: 'https://api.deepseek.com',
    maxTokens: 4096,
    temperature: 0.4,
  },

  // ── Rate Limits ──
  rateLimits: {
    freeMessagesPerDay: parseInt(env('RATE_LIMIT_FREE_MSGS', '50')),
    premiumMessagesPerDay: parseInt(env('RATE_LIMIT_PREMIUM_MSGS', '500')),
    channelMessagesPerDay: parseInt(env('RATE_LIMIT_CHANNEL_MSGS', '30')),
  },

  // ── Transaction Fees ──
  fees: {
    p2pFreeThresholdUsd: parseFloat(env('FEE_P2P_FREE_THRESHOLD', '50')),
    p2pPercent: parseFloat(env('FEE_P2P_PERCENT', '1.0')),
    topupPercent: parseFloat(env('FEE_TOPUP_PERCENT', '1.5')),
    withdrawPercent: parseFloat(env('FEE_WITHDRAW_PERCENT', '1.0')),
    withdrawFlatUsd: parseFloat(env('FEE_WITHDRAW_FLAT', '0.25')),
    billPayPercent: parseFloat(env('FEE_BILL_PAY_PERCENT', '1.5')),
    paymentPercent: parseFloat(env('FEE_PAYMENT_PERCENT', '2.5')),
    crossBorderPercent: parseFloat(env('FEE_CROSS_BORDER_PERCENT', '3.0')),
    loyaltyDiscountEnabled: env('FEE_LOYALTY_DISCOUNT', 'true') === 'true',
  },

  // ── Platform ──
  platform: {
    domain: env('DOMAIN', 'upromptpay.com'),
    domainUrl: env('DOMAIN_URL', 'https://www.upromptpay.com'),
    contactEmail: env('CONTACT_EMAIL', 'info@upromptpay.com'),
    name: 'PromptPay',
    version: '1.5.0',
  },

  promptpay: {
    apiUrl: env('PROMPTPAY_API_URL', 'https://www.upromptpay.com/api'),
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

  // ── Reloadly (Mercury — Airtime/Data) ──
  reloadly: {
    clientId: env('RELOADLY_CLIENT_ID', ''),
    clientSecret: env('RELOADLY_CLIENT_SECRET', ''),
    environment: env('RELOADLY_ENV', 'sandbox') as 'sandbox' | 'production',
  },

  // ── Wise (Janus — Cross-Border) ──
  wise: {
    apiKey: env('WISE_API_KEY', ''),
    profileId: env('WISE_PROFILE_ID', ''),
    environment: env('WISE_ENV', 'sandbox') as 'sandbox' | 'production',
  },

  // ── Circle USDC (Janus — Stablecoin Rails) ──
  circle: {
    apiKey: env('CIRCLE_API_KEY', ''),
    environment: env('CIRCLE_ENV', 'sandbox') as 'sandbox' | 'production',
  },

  // ── Agent Network (Nexus — Africa Cash-In/Cash-Out) ──
  agentNetwork: {
    enabled: env('AGENT_NETWORK_ENABLED', 'true') === 'true',
    commissionPercent: parseFloat(env('AGENT_COMMISSION_PERCENT', '0.75')),
    maxFloatUsd: parseFloat(env('AGENT_MAX_FLOAT', '10000')),
    minFloatUsd: parseFloat(env('AGENT_MIN_FLOAT', '50')),
  },

  // ── PayTag (Virality) ──
  paytag: {
    enabled: env('PAYTAG_ENABLED', 'true') === 'true',
    minLength: 3,
    maxLength: 20,
    linkBaseUrl: env('PAYTAG_LINK_URL', 'https://upromptpay.com/pay'),
  },

  // ── Wallet & PromptPay (Nexus) ──
  wallet: {
    maxBalanceUsd: parseFloat(env('WALLET_MAX_BALANCE_USD', '50000')),
    maxTransferUsd: parseFloat(env('WALLET_MAX_TRANSFER_USD', '10000')),
    maxBillAmountUsd: parseFloat(env('WALLET_MAX_BILL_USD', '25000')),
    p2pEnabled: env('WALLET_P2P_ENABLED', 'true') === 'true',
    payForwardEnabled: env('WALLET_PAY_FORWARD_ENABLED', 'true') === 'true',
  },

  // ── Auth ──
  auth: {
    jwtSecret: env('AUTH_SECRET', env('GATEWAY_SECRET', 'promptpay-local')),
    tokenExpiryMs: parseInt(env('AUTH_TOKEN_EXPIRY_MS', '86400000')),
    ownerEmail: env('OWNER_EMAIL', 'info@upromptpay.com'),
    ownerPassword: env('OWNER_PASSWORD', 'admin'),
    ownerDisplayName: env('OWNER_DISPLAY_NAME', 'PromptPay Admin'),
  },

  // ── Secret Admin Panel ──
  admin: {
    secretPath: env('ADMIN_SECRET_PATH', 'cpanel-0a1e97aa2be2774809b4f988'),
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
