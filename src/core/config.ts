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

  // ── Ollama Cloud ($20/mo unlimited GPU inference) ──
  ollama: {
    baseUrl: env('OLLAMA_BASE_URL', 'https://ollama.com'),
    apiKey: env('OLLAMA_API_KEY', ''),
    model: env('OLLAMA_MODEL', 'qwen3.5:397b'),
    codeModel: env('OLLAMA_CODE_MODEL', 'qwen3-coder:480b'),
    maxTokens: parseInt(env('OLLAMA_MAX_TOKENS', '16384')),
    temperature: 0.3,
  },

  // ── DeepSeek (Fallback cheap model — intent detection, entity extraction) ──
  deepseek: {
    apiKey: env('DEEPSEEK_API_KEY', ''),
    model: env('DEEPSEEK_MODEL', 'deepseek-chat'),
    baseUrl: 'https://api.deepseek.com',
    maxTokens: parseInt(env('DEEPSEEK_MAX_TOKENS', '2048')),
    temperature: 0.3,
  },

  // ── OpenAI (Premium model — escalation target) ──
  openai: {
    apiKey: env('OPENAI_API_KEY', ''),
    model: env('OPENAI_MODEL', 'gpt-4o'),
    baseUrl: 'https://api.openai.com/v1',
    maxTokens: parseInt(env('OPENAI_MAX_TOKENS', '4096')),
    temperature: 0.3,
  },

  // ── Google Gemini (Premium model — escalation target) ──
  gemini: {
    apiKey: env('GEMINI_API_KEY', ''),
    model: env('GEMINI_MODEL', 'gemini-2.0-flash'),
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    maxTokens: parseInt(env('GEMINI_MAX_TOKENS', '4096')),
    temperature: 0.3,
  },

  // ── Model Routing Strategy ──
  modelRouting: {
    // Default model for all conversational interactions (ollama = free)
    defaultProvider: env('MODEL_DEFAULT_PROVIDER', 'ollama') as 'ollama' | 'deepseek' | 'anthropic' | 'openai' | 'google',
    // Premium escalation target (Claude, OpenAI, or Gemini)
    premiumProvider: env('MODEL_PREMIUM_PROVIDER', 'anthropic') as 'anthropic' | 'openai' | 'google',
    // Confidence threshold — below this, escalate or clarify
    confidenceThreshold: parseFloat(env('MODEL_CONFIDENCE_THRESHOLD', '0.85')),
    // Max conversation history tokens before compression
    maxHistoryTokens: parseInt(env('MODEL_MAX_HISTORY_TOKENS', '4000')),
    // Max messages to keep in conversation window
    maxHistoryMessages: parseInt(env('MODEL_MAX_HISTORY_MESSAGES', '10')),
    // Enable structured JSON output for transactions
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
    loyaltyDiscountEnabled: env('FEE_LOYALTY_DISCOUNT', 'true') === 'true',
  },

  // ── Platform ──
  platform: {
    domain: env('DOMAIN', 'upromptpay.com'),
    domainUrl: env('DOMAIN_URL', 'https://www.upromptpay.com'),
    contactEmail: env('CONTACT_EMAIL', 'info@upromptpay.com'),
    name: 'PromptPay',
    version: '2.0.0',
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

  // ── Email (Resend) ──
  email: {
    resendApiKey: env('RESEND_API_KEY', ''),
    fromAddress: env('EMAIL_FROM', 'onboarding@resend.dev'),
    fromName: env('EMAIL_FROM_NAME', 'PromptPay'),
  },

  // ── Web Push (VAPID) ──
  push: {
    vapidPublicKey: env('VAPID_PUBLIC_KEY', ''),
    vapidPrivateKey: env('VAPID_PRIVATE_KEY', ''),
    vapidSubject: env('VAPID_SUBJECT', 'mailto:info@upromptpay.com'),
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

  // ── pawaPay (Cross-Border — Mobile Money to Africa) ──
  pawapay: {
    apiToken: env('PAWAPAY_API_TOKEN', ''),
    environment: env('PAWAPAY_ENV', 'sandbox') as 'sandbox' | 'production',
    get baseUrl(): string {
      return this.environment === 'production'
        ? 'https://api.pawapay.io'
        : 'https://api.sandbox.pawapay.io';
    },
    webhookIps: ['18.192.208.15', '18.195.113.136', '3.72.212.107', '54.73.125.42', '54.155.38.214', '54.73.130.113'],
  },

  // ── Fincra (Cross-Border — Bank Transfers to Africa) ──
  fincra: {
    secretKey: env('FINCRA_SECRET_KEY', ''),
    publicKey: env('FINCRA_PUBLIC_KEY', ''),
    businessId: env('FINCRA_BUSINESS_ID', ''),
    webhookSecret: env('FINCRA_WEBHOOK_SECRET', ''),
    environment: env('FINCRA_ENV', 'sandbox') as 'sandbox' | 'production',
    get baseUrl(): string {
      return this.environment === 'production'
        ? 'https://api.fincra.com'
        : 'https://sandboxapi.fincra.com';
    },
  },

  // ── Korapay (Cross-Border — Nigeria + Pan-African Payouts) ──
  korapay: {
    secretKey: env('KORAPAY_SECRET_KEY', ''),
    publicKey: env('KORAPAY_PUBLIC_KEY', ''),
    environment: env('KORAPAY_ENV', 'sandbox') as 'sandbox' | 'production',
    get baseUrl(): string {
      return this.environment === 'production'
        ? 'https://api.korapay.com'
        : 'https://api.korapay.com';
    },
  },

  // ── Telnyx (International Calling) ──
  telnyx: {
    apiKey: env('TELNYX_API_KEY', ''),
    apiSecret: env('TELNYX_API_SECRET', ''),
    sipConnectionId: env('TELNYX_SIP_CONNECTION_ID', ''),
    callerIdNumber: env('TELNYX_CALLER_ID', ''),
    get baseUrl(): string { return 'https://api.telnyx.com/v2'; },
  },

  // ── Termii (Virtual Numbers + SMS) ──
  termii: {
    apiKey: env('TERMII_API_KEY', ''),
    senderId: env('TERMII_SENDER_ID', 'PromptPay'),
    get baseUrl(): string { return 'https://api.ng.termii.com/api'; },
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

  // ── Country-Specific KYC & Limits ──
  countryConfig: {
    NG: {
      name: 'Nigeria',
      currency: 'NGN',
      currencySymbol: '₦',
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
      providers: ['flutterwave', 'paystack'],
      mobileMoneyProviders: [],
      bankTransferProvider: 'flutterwave',
      supportedBanks: true,
    },
    GH: {
      name: 'Ghana',
      currency: 'GHS',
      currencySymbol: 'GH₵',
      kycRequirements: {
        tier1: ['ghana_card', 'phone'],
        tier2: ['ghana_card', 'phone', 'source_of_funds', 'next_of_kin'],
        tier3: ['ghana_card', 'phone', 'source_of_funds', 'next_of_kin', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 3000, maxBalance: 5000, label: 'Minimum' },
        2: { dailySend: 15000, maxBalance: 40000, label: 'Medium' },
        3: { dailySend: 25000, maxBalance: 75000, label: 'Enhanced' },
      },
      providers: ['mtn_momo', 'flutterwave'],
      mobileMoneyProviders: ['mtn', 'vodafone', 'airteltigo'],
      bankTransferProvider: 'flutterwave',
      supportedBanks: true,
    },
    KE: {
      name: 'Kenya',
      currency: 'KES',
      currencySymbol: 'KSh',
      kycRequirements: {
        tier1: ['national_id', 'phone'],
        tier2: [],
        tier3: [],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 500000, maxBalance: 500000, label: 'Verified' },
        2: { dailySend: 500000, maxBalance: 500000, label: 'Verified' },
        3: { dailySend: 500000, maxBalance: 500000, label: 'Verified' },
      },
      providers: ['mpesa'],
      mobileMoneyProviders: ['mpesa'],
      bankTransferProvider: null,
      supportedBanks: false,
    },
    UG: {
      name: 'Uganda',
      currency: 'UGX',
      currencySymbol: 'USh',
      kycRequirements: {
        tier1: ['national_id', 'phone'],
        tier2: ['national_id', 'phone', 'selfie'],
        tier3: ['national_id', 'phone', 'selfie', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 5000000, maxBalance: 10000000, label: 'Basic' },
        2: { dailySend: 15000000, maxBalance: 30000000, label: 'Standard' },
        3: { dailySend: 50000000, maxBalance: 100000000, label: 'Full' },
      },
      providers: ['mtn_momo', 'flutterwave'],
      mobileMoneyProviders: ['mtn', 'airtel'],
      bankTransferProvider: 'flutterwave',
      supportedBanks: true,
    },
    ZA: {
      name: 'South Africa',
      currency: 'ZAR',
      currencySymbol: 'R',
      kycRequirements: {
        tier1: ['sa_id', 'phone'],
        tier2: ['sa_id', 'phone', 'selfie', 'proof_of_address'],
        tier3: ['sa_id', 'phone', 'selfie', 'proof_of_address', 'bank_statement'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 5000, maxBalance: 25000, label: 'Basic' },
        2: { dailySend: 25000, maxBalance: 100000, label: 'Standard' },
        3: { dailySend: 100000, maxBalance: 500000, label: 'Full' },
      },
      providers: ['paystack'],
      mobileMoneyProviders: [],
      bankTransferProvider: 'paystack',
      supportedBanks: true,
    },
    TZ: {
      name: 'Tanzania',
      currency: 'TZS',
      currencySymbol: 'TSh',
      kycRequirements: {
        tier1: ['national_id', 'phone'],
        tier2: ['national_id', 'phone', 'selfie'],
        tier3: ['national_id', 'phone', 'selfie', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 3000000, maxBalance: 10000000, label: 'Basic' },
        2: { dailySend: 10000000, maxBalance: 30000000, label: 'Standard' },
        3: { dailySend: 30000000, maxBalance: 100000000, label: 'Full' },
      },
      providers: ['flutterwave'],
      mobileMoneyProviders: ['mpesa', 'vodacom', 'tigo', 'airtel'],
      bankTransferProvider: 'flutterwave',
      supportedBanks: true,
    },
    CM: {
      name: 'Cameroon',
      currency: 'XAF',
      currencySymbol: 'FCFA',
      kycRequirements: {
        tier1: ['national_id', 'phone'],
        tier2: ['national_id', 'phone', 'selfie'],
        tier3: ['national_id', 'phone', 'selfie', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 500000, maxBalance: 2000000, label: 'Basic' },
        2: { dailySend: 2000000, maxBalance: 10000000, label: 'Standard' },
        3: { dailySend: 10000000, maxBalance: 50000000, label: 'Full' },
      },
      providers: ['mtn_momo', 'flutterwave'],
      mobileMoneyProviders: ['mtn', 'orange'],
      bankTransferProvider: 'flutterwave',
      supportedBanks: true,
    },
    SN: {
      name: 'Senegal',
      currency: 'XOF',
      currencySymbol: 'CFA',
      kycRequirements: {
        tier1: ['national_id', 'phone'],
        tier2: ['national_id', 'phone', 'selfie'],
        tier3: ['national_id', 'phone', 'selfie', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 500000, maxBalance: 2000000, label: 'Basic' },
        2: { dailySend: 2000000, maxBalance: 10000000, label: 'Standard' },
        3: { dailySend: 10000000, maxBalance: 50000000, label: 'Full' },
      },
      providers: ['flutterwave'],
      mobileMoneyProviders: ['orange', 'wave'],
      bankTransferProvider: 'flutterwave',
      supportedBanks: true,
    },
    ET: {
      name: 'Ethiopia',
      currency: 'ETB',
      currencySymbol: 'Br',
      kycRequirements: {
        tier1: ['national_id', 'phone'],
        tier2: ['national_id', 'phone', 'selfie'],
        tier3: ['national_id', 'phone', 'selfie', 'proof_of_address'],
      },
      tierLimits: {
        0: { dailySend: 0, maxBalance: 0, label: 'Unverified' },
        1: { dailySend: 50000, maxBalance: 200000, label: 'Basic' },
        2: { dailySend: 200000, maxBalance: 1000000, label: 'Standard' },
        3: { dailySend: 1000000, maxBalance: 5000000, label: 'Full' },
      },
      providers: ['flutterwave'],
      mobileMoneyProviders: ['telebirr'],
      bankTransferProvider: 'flutterwave',
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

  // ── Bank Lists by Country ──
  bankLists: {
    NG: [
      { code: '044', name: 'Access Bank' },
      { code: '023', name: 'Citibank Nigeria' },
      { code: '063', name: 'Diamond Bank' },
      { code: '050', name: 'Ecobank Nigeria' },
      { code: '084', name: 'Enterprise Bank' },
      { code: '070', name: 'Fidelity Bank' },
      { code: '011', name: 'First Bank of Nigeria' },
      { code: '214', name: 'First City Monument Bank' },
      { code: '058', name: 'Guaranty Trust Bank' },
      { code: '030', name: 'Heritage Bank' },
      { code: '301', name: 'Jaiz Bank' },
      { code: '082', name: 'Keystone Bank' },
      { code: '526', name: 'Kuda Bank' },
      { code: '999', name: 'OPay' },
      { code: '998', name: 'PalmPay' },
      { code: '076', name: 'Polaris Bank' },
      { code: '101', name: 'Providus Bank' },
      { code: '221', name: 'Stanbic IBTC Bank' },
      { code: '068', name: 'Standard Chartered Bank' },
      { code: '232', name: 'Sterling Bank' },
      { code: '100', name: 'Suntrust Bank' },
      { code: '032', name: 'Union Bank of Nigeria' },
      { code: '033', name: 'United Bank for Africa' },
      { code: '215', name: 'Unity Bank' },
      { code: '035', name: 'Wema Bank' },
      { code: '057', name: 'Zenith Bank' },
    ],
    GH: [
      { code: 'absa', name: 'Absa Bank Ghana' },
      { code: 'access', name: 'Access Bank Ghana' },
      { code: 'cal', name: 'CalBank' },
      { code: 'ecobank', name: 'Ecobank Ghana' },
      { code: 'fidelity', name: 'Fidelity Bank Ghana' },
      { code: 'fnb', name: 'First National Bank Ghana' },
      { code: 'gcb', name: 'GCB Bank' },
      { code: 'gtbank', name: 'GTBank Ghana' },
      { code: 'republic', name: 'Republic Bank Ghana' },
      { code: 'sbg', name: 'Stanbic Bank Ghana' },
      { code: 'scb', name: 'Standard Chartered Ghana' },
      { code: 'uba', name: 'UBA Ghana' },
      { code: 'zenith', name: 'Zenith Bank Ghana' },
    ],
    KE: [
      { code: 'kcb', name: 'KCB Bank' },
      { code: 'equity', name: 'Equity Bank' },
      { code: 'coop', name: 'Co-operative Bank' },
      { code: 'ncba', name: 'NCBA Bank' },
      { code: 'absa', name: 'Absa Bank Kenya' },
      { code: 'stanbic', name: 'Stanbic Bank Kenya' },
      { code: 'scb', name: 'Standard Chartered Kenya' },
      { code: 'dtb', name: 'Diamond Trust Bank' },
      { code: 'im', name: 'I&M Bank' },
      { code: 'family', name: 'Family Bank' },
    ],
    UG: [
      { code: 'stanbic', name: 'Stanbic Bank Uganda' },
      { code: 'centenary', name: 'Centenary Bank' },
      { code: 'dfcu', name: 'dfcu Bank' },
      { code: 'equity', name: 'Equity Bank Uganda' },
      { code: 'absa', name: 'Absa Bank Uganda' },
      { code: 'boa', name: 'Bank of Africa Uganda' },
      { code: 'cairo', name: 'Cairo International Bank' },
      { code: 'housing', name: 'Housing Finance Bank' },
    ],
    ZA: [
      { code: 'absa', name: 'ABSA Bank' },
      { code: 'fnb', name: 'First National Bank' },
      { code: 'standard', name: 'Standard Bank' },
      { code: 'nedbank', name: 'Nedbank' },
      { code: 'capitec', name: 'Capitec Bank' },
      { code: 'investec', name: 'Investec' },
      { code: 'tymebank', name: 'TymeBank' },
      { code: 'discovery', name: 'Discovery Bank' },
      { code: 'african', name: 'African Bank' },
      { code: 'bidvest', name: 'Bidvest Bank' },
    ],
    TZ: [
      { code: 'crdb', name: 'CRDB Bank' },
      { code: 'nmb', name: 'NMB Bank' },
      { code: 'nbc', name: 'NBC Bank' },
      { code: 'stanbic', name: 'Stanbic Bank Tanzania' },
      { code: 'equity', name: 'Equity Bank Tanzania' },
      { code: 'kcb', name: 'KCB Bank Tanzania' },
      { code: 'dtb', name: 'Diamond Trust Bank Tanzania' },
      { code: 'exim', name: 'Exim Bank Tanzania' },
    ],
    CM: [
      { code: 'afriland', name: 'Afriland First Bank' },
      { code: 'sgc', name: 'Société Générale Cameroun' },
      { code: 'bicec', name: 'BICEC' },
      { code: 'ecobank', name: 'Ecobank Cameroon' },
      { code: 'cbc', name: 'Commercial Bank Cameroon' },
      { code: 'uba', name: 'UBA Cameroon' },
      { code: 'scb', name: 'SCB Cameroon' },
    ],
    SN: [
      { code: 'cbao', name: 'CBAO Groupe Attijariwafa' },
      { code: 'sgbs', name: 'Société Générale Sénégal' },
      { code: 'bicis', name: 'BICIS (BNP Paribas)' },
      { code: 'ecobank', name: 'Ecobank Sénégal' },
      { code: 'boa', name: 'Bank of Africa Sénégal' },
      { code: 'bhs', name: 'Banque de l\'Habitat du Sénégal' },
      { code: 'uba', name: 'UBA Sénégal' },
    ],
    ET: [
      { code: 'cbe', name: 'Commercial Bank of Ethiopia' },
      { code: 'awash', name: 'Awash Bank' },
      { code: 'dashen', name: 'Dashen Bank' },
      { code: 'abyssinia', name: 'Bank of Abyssinia' },
      { code: 'wegagen', name: 'Wegagen Bank' },
      { code: 'united', name: 'United Bank' },
      { code: 'nib', name: 'Nib International Bank' },
      { code: 'oromia', name: 'Cooperative Bank of Oromia' },
      { code: 'zemen', name: 'Zemen Bank' },
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

  // ══════════════════════════════════════════════════════════
  // AGENTIC AGENTS
  // ══════════════════════════════════════════════════════════

  // ── Shopping (Aria) ──
  shopping: {
    enabled: env('SHOPPING_ENABLED', 'true') === 'true',
    maxBudgetUsd: parseFloat(env('SHOPPING_MAX_BUDGET_USD', '10000')),
    priceComparisonProvider: env('SHOPPING_PRICE_PROVIDER', 'internal'),
    priceComparisonApiKey: env('SHOPPING_PRICE_API_KEY', ''),
  },

  // ── Life Assistant (Otto) ──
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
