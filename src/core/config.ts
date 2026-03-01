// ═══════════════════════════════════════════════════════════════
// PromptPay :: System Configuration — CLEANED (Zero Vaporware)
// Only features with working API keys / real implementations
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
  // ── AI Models ──
  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY', ''),
    model: env('ANTHROPIC_MODEL', 'claude-opus-4-6'),
    maxTokens: 16384,
    temperature: 0.3,
    userModel: env('ANTHROPIC_USER_MODEL', 'claude-haiku-4-5-20251001'),
    userMaxTokens: parseInt(env('ANTHROPIC_USER_MAX_TOKENS', '4096')),
    adminModel: env('ANTHROPIC_ADMIN_MODEL', 'claude-opus-4-6'),
  },

  ollama: {
    baseUrl: env('OLLAMA_BASE_URL', 'https://ollama.com'),
    apiKey: env('OLLAMA_API_KEY', ''),
    model: env('OLLAMA_MODEL', 'qwen3.5:397b'),
    codeModel: env('OLLAMA_CODE_MODEL', 'qwen3-coder:480b'),
    maxTokens: parseInt(env('OLLAMA_MAX_TOKENS', '16384')),
    temperature: 0.3,
  },

  // ── Model Routing ──
  modelRouting: {
    defaultProvider: env('MODEL_DEFAULT_PROVIDER', 'ollama') as 'ollama' | 'anthropic',
    premiumProvider: env('MODEL_PREMIUM_PROVIDER', 'anthropic') as 'anthropic',
    confidenceThreshold: parseFloat(env('MODEL_CONFIDENCE_THRESHOLD', '0.85')),
    maxHistoryTokens: parseInt(env('MODEL_MAX_HISTORY_TOKENS', '4000')),
    maxHistoryMessages: parseInt(env('MODEL_MAX_HISTORY_MESSAGES', '10')),
    structuredOutputEnabled: env('MODEL_STRUCTURED_OUTPUT', 'true') === 'true',
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
  },

  // ── Platform ──
  platform: {
    domain: env('DOMAIN', 'upromptpay.com'),
    domainUrl: env('DOMAIN_URL', 'https://www.upromptpay.com'),
    contactEmail: env('CONTACT_EMAIL', 'info@upromptpay.com'),
    name: 'PromptPay',
    version: '2.1.0',
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

  // ══════════════════════════════════════════════════════════
  // COMMUNICATION CHANNELS (working only)
  // ══════════════════════════════════════════════════════════

  telegram: {
    botToken: env('TELEGRAM_BOT_TOKEN', ''),
    webhookUrl: env('TELEGRAM_WEBHOOK_URL', ''),
    ownerChatId: env('TELEGRAM_OWNER_CHAT_ID', ''),
    briefingHourUtc: parseInt(env('TELEGRAM_BRIEFING_HOUR_UTC', '6'), 10),
  },

  // Email kept as console.log fallback when no key
  email: {
    resendApiKey: env('RESEND_API_KEY', ''),
    fromAddress: env('EMAIL_FROM', 'onboarding@resend.dev'),
    fromName: env('EMAIL_FROM_NAME', 'PromptPay'),
  },

  // ══════════════════════════════════════════════════════════
  // PAYMENT PROVIDERS (working only)
  // ══════════════════════════════════════════════════════════

  stripe: {
    secretKey: env('STRIPE_SECRET_KEY', ''),
    publishableKey: env('STRIPE_PUBLISHABLE_KEY', ''),
    webhookSecret: env('STRIPE_WEBHOOK_SECRET', ''),
    connectEnabled: env('STRIPE_CONNECT_ENABLED', 'false') === 'true',
  },

  // Paystack — Nigeria (ready for when keys are added)
  paystack: {
    secretKey: env('PAYSTACK_SECRET_KEY', ''),
    publicKey: env('PAYSTACK_PUBLIC_KEY', ''),
  },

  // Reloadly — Airtime/Data top-up (has partial credentials)
  reloadly: {
    clientId: env('RELOADLY_CLIENT_ID', ''),
    clientSecret: env('RELOADLY_CLIENT_SECRET', ''),
    environment: env('RELOADLY_ENV', 'sandbox') as 'sandbox' | 'production',
  },

  // Telnyx — International voice calls
  telnyx: {
    apiKey: env('TELNYX_API_KEY', ''),
    apiSecret: env('TELNYX_API_SECRET', ''),
    sipConnectionId: env('TELNYX_SIP_CONNECTION_ID', ''),
    callerIdNumber: env('TELNYX_CALLER_ID', ''),
    get baseUrl(): string { return 'https://api.telnyx.com/v2'; },
  },

  // ── Agent Network (POS) ──
  agentNetwork: {
    enabled: env('AGENT_NETWORK_ENABLED', 'true') === 'true',
    commissionPercent: parseFloat(env('AGENT_COMMISSION_PERCENT', '0.75')),
    maxFloatUsd: parseFloat(env('AGENT_MAX_FLOAT', '10000')),
    minFloatUsd: parseFloat(env('AGENT_MIN_FLOAT', '50')),
  },

  // ── PayTag ──
  paytag: {
    enabled: env('PAYTAG_ENABLED', 'true') === 'true',
    minLength: 3,
    maxLength: 20,
    linkBaseUrl: env('PAYTAG_LINK_URL', 'https://upromptpay.com/pay'),
  },

  // ── Wallet ──
  wallet: {
    maxBalanceUsd: parseFloat(env('WALLET_MAX_BALANCE_USD', '50000')),
    maxTransferUsd: parseFloat(env('WALLET_MAX_TRANSFER_USD', '10000')),
    maxBillAmountUsd: parseFloat(env('WALLET_MAX_BILL_USD', '25000')),
    p2pEnabled: env('WALLET_P2P_ENABLED', 'true') === 'true',
    payForwardEnabled: env('WALLET_PAY_FORWARD_ENABLED', 'true') === 'true',
  },

  // ── Country Config (Nigeria + US only — expansion later) ──
  countryConfig: {
    NG: {
      name: 'Nigeria',
      currency: 'NGN',
      currencySymbol: '\u20A6',
      kycRequirements: {
        tier1: ['bvn_or_nin', 'phone'],
        tier2: ['bvn', 'nin', 'selfie'],
        tier3: ['bvn', 'nin', 'selfie', 'proof_of_address', 'photo_id'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 50000, maxBalance: 300000, label: 'Basic' },
        2: { dailySend: 200000, maxBalance: 500000, label: 'Standard' },
        3: { dailySend: 5000000, maxBalance: 50000000, label: 'Full' },
      },
      providers: ['paystack'],
      mobileMoneyProviders: [],
      bankTransferProvider: 'paystack',
      supportedBanks: true,
    },
    US: {
      name: 'United States',
      currency: 'USD',
      currencySymbol: '$',
      kycRequirements: {
        tier1: ['email', 'phone'],
        tier2: ['ssn_last4', 'dob', 'address'],
        tier3: ['ssn', 'photo_id', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 500, maxBalance: 5000, label: 'Basic' },
        2: { dailySend: 5000, maxBalance: 25000, label: 'Standard' },
        3: { dailySend: 50000, maxBalance: 250000, label: 'Full' },
      },
      providers: ['stripe'],
      mobileMoneyProviders: [],
      bankTransferProvider: 'stripe',
      supportedBanks: true,
    },
  } as Record<string, {
    name: string;
    currency: string;
    currencySymbol: string;
    kycRequirements: Record<string, string[]>;
    tierLimits: Record<number, { dailySend: number; maxBalance: number; label: string }>;
    providers: string[];
    mobileMoneyProviders: string[];
    bankTransferProvider: string | null;
    supportedBanks: boolean;
  }>,

  // ── Bank Lists (Nigeria + US only) ──
  bankLists: {
    NG: [
      { code: '044', name: 'Access Bank' },
      { code: '023', name: 'Citibank Nigeria' },
      { code: '050', name: 'Ecobank Nigeria' },
      { code: '070', name: 'Fidelity Bank' },
      { code: '011', name: 'First Bank of Nigeria' },
      { code: '214', name: 'First City Monument Bank' },
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '030', name: 'Heritage Bank' },
      { code: '082', name: 'Keystone Bank' },
      { code: '526', name: 'Kuda Bank' },
      { code: '999', name: 'OPay' },
      { code: '998', name: 'PalmPay' },
      { code: '076', name: 'Polaris Bank' },
      { code: '221', name: 'Stanbic IBTC Bank' },
      { code: '232', name: 'Sterling Bank' },
      { code: '032', name: 'Union Bank of Nigeria' },
      { code: '033', name: 'United Bank for Africa' },
      { code: '215', name: 'Unity Bank' },
      { code: '035', name: 'Wema Bank' },
      { code: '057', name: 'Zenith Bank' },
    ],
    US: [
      { code: 'chase', name: 'Chase' },
      { code: 'bofa', name: 'Bank of America' },
      { code: 'wells', name: 'Wells Fargo' },
      { code: 'citi', name: 'Citi' },
      { code: 'usbank', name: 'US Bank' },
      { code: 'capitalone', name: 'Capital One' },
      { code: 'pnc', name: 'PNC Bank' },
      { code: 'td', name: 'TD Bank' },
      { code: 'truist', name: 'Truist' },
      { code: 'ally', name: 'Ally Bank' },
    ],
  } as Record<string, Array<{ code: string; name: string }>>,

  // ── Agents ──
  shopping: {
    enabled: env('SHOPPING_ENABLED', 'true') === 'true',
    maxBudgetUsd: parseFloat(env('SHOPPING_MAX_BUDGET_USD', '10000')),
    priceComparisonProvider: 'internal',
  },

  assistant: {
    enabled: env('ASSISTANT_ENABLED', 'true') === 'true',
    subscriptionScanEnabled: env('ASSISTANT_SUB_SCAN', 'true') === 'true',
    priceAlertCheckIntervalMs: parseInt(env('ASSISTANT_PRICE_ALERT_INTERVAL_MS', '3600000')),
    maxDocumentSizeMb: parseInt(env('ASSISTANT_MAX_DOC_SIZE_MB', '10')),
  },

  // ── Auth ──
  auth: {
    jwtSecret: env('AUTH_SECRET', env('GATEWAY_SECRET', 'promptpay-local')),
    tokenExpiryMs: parseInt(env('AUTH_TOKEN_EXPIRY_MS', '86400000')),
    ownerEmail: env('OWNER_EMAIL', 'info@upromptpay.com'),
    ownerPassword: env('OWNER_PASSWORD', 'admin'),
    ownerDisplayName: env('OWNER_DISPLAY_NAME', 'PromptPay Admin'),
  },

  // ── Admin Panel ──
  admin: {
    secretPath: env('ADMIN_SECRET_PATH', 'cpanel-0a1e97aa2be2774809b4f988'),
  },
} as const;

export type Config = typeof CONFIG;
