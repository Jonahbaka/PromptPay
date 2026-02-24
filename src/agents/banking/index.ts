// ═══════════════════════════════════════════════════════════════
// Agent: Plutus — Fintech Open Banking (Plug-and-Play)
// 6 tools: Mono (Nigeria) link/data/debit, Stitch (South Africa)
//          link/data, provider status
// ═══════════════════════════════════════════════════════════════

import { z } from 'zod';
import { ToolDefinition } from '../../core/types.js';
import { CONFIG } from '../../core/config.js';

// ── Schemas ─────────────────────────────────────────────────

const monoLinkSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  scope: z.enum(['auth', 'accounts', 'transactions', 'identity', 'income', 'balance']).optional().default('auth'),
  reference: z.string().optional(),
});

const monoAccountDataSchema = z.object({
  accountId: z.string().min(1),
  dataType: z.enum(['identity', 'balance', 'transactions', 'income', 'statement']),
  period: z.string().optional().describe('For transactions/statement: "last7days", "last30days", "last90days"'),
});

const monoDebitSchema = z.object({
  accountId: z.string().min(1),
  amount: z.number().positive().describe('Amount in kobo (NGN)'),
  narration: z.string().min(1),
  reference: z.string().min(1),
});

const stitchLinkSchema = z.object({
  userIdentifier: z.string().min(1),
  bankId: z.string().optional().describe('Specific bank ID, or omit for user selection'),
  scopes: z.array(z.enum(['accounts', 'balances', 'transactions'])).optional().default(['accounts', 'balances', 'transactions']),
});

const stitchAccountDataSchema = z.object({
  accountId: z.string().min(1),
  dataType: z.enum(['balance', 'transactions', 'account_holders']),
  fromDate: z.string().optional().describe('ISO 8601 date for transaction filter'),
  toDate: z.string().optional(),
});

const bankingProviderStatusSchema = z.object({
  providers: z.array(z.enum(['mono', 'stitch'])).optional(),
});

// ── Stitch GraphQL Helper ───────────────────────────────────

async function stitchGetToken(): Promise<string> {
  const resp = await fetch('https://secure.stitch.money/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CONFIG.stitch.clientId,
      client_secret: CONFIG.stitch.clientSecret,
      scope: 'client_paymentrequest',
    }).toString(),
    signal: AbortSignal.timeout(10000),
  });
  const data = await resp.json() as Record<string, string>;
  return data.access_token;
}

async function stitchGraphQL(query: string, variables: Record<string, unknown>, token: string): Promise<Record<string, unknown>> {
  const resp = await fetch('https://api.stitch.money/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15000),
  });
  return await resp.json() as Record<string, unknown>;
}

// ── Tool Implementations ────────────────────────────────────

export const bankingTools: ToolDefinition[] = [
  // ─── 1. Mono Link Account ────────────────────────────────
  {
    name: 'mono_link_account',
    description: 'Generate a Mono Connect widget URL to link a Nigerian bank account. Plug-and-play for fintech — customer authorizes via their bank.',
    category: 'banking',
    inputSchema: monoLinkSchema,
    requiresApproval: false,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = monoLinkSchema.parse(input);
      ctx.logger.info(`[Plutus] Mono link account: ${params.customerEmail}`);

      if (!CONFIG.mono.secretKey) {
        return { success: false, data: null, error: 'Mono not configured — set MONO_SECRET_KEY' };
      }

      try {
        const resp = await fetch('https://api.withmono.com/v2/auth/session', {
          method: 'POST',
          headers: {
            'mono-sec-key': CONFIG.mono.secretKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            customer: {
              name: params.customerName,
              email: params.customerEmail,
            },
            scope: params.scope,
            reference: params.reference || `promptpay-${Date.now()}`,
            redirect_url: `${CONFIG.promptpay.apiUrl}/webhooks/mono`,
          }),
          signal: AbortSignal.timeout(10000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (resp.ok) {
          return {
            success: true,
            data: {
              provider: 'mono',
              sessionId: data.id,
              widgetUrl: `https://connect.mono.co/?key=${CONFIG.mono.secretKey}&session=${data.id}`,
              status: 'awaiting_customer',
              message: 'Send the widget URL to the customer to link their bank account.',
            },
            metadata: { country: 'NG', currency: 'NGN' },
          };
        }

        return { success: false, data, error: `Mono session error: ${JSON.stringify(data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Mono link failed: ${err}` };
      }
    },
  },

  // ─── 2. Mono Get Account Data ─────────────────────────────
  {
    name: 'mono_get_account_data',
    description: 'Fetch linked Nigerian bank account data via Mono: identity, balance, transactions, income, or statement.',
    category: 'banking',
    inputSchema: monoAccountDataSchema,
    requiresApproval: false,
    riskLevel: 'medium',
    execute: async (input, ctx) => {
      const params = monoAccountDataSchema.parse(input);
      ctx.logger.info(`[Plutus] Mono ${params.dataType}: account=${params.accountId}`);

      if (!CONFIG.mono.secretKey) {
        return { success: false, data: null, error: 'Mono not configured — set MONO_SECRET_KEY' };
      }

      try {
        let endpoint: string;

        switch (params.dataType) {
          case 'identity':
            endpoint = `https://api.withmono.com/v2/accounts/${params.accountId}/identity`;
            break;
          case 'balance':
            endpoint = `https://api.withmono.com/v2/accounts/${params.accountId}/balance`;
            break;
          case 'transactions':
            endpoint = `https://api.withmono.com/v2/accounts/${params.accountId}/transactions?type=debit,credit`;
            if (params.period) endpoint += `&period=${params.period}`;
            break;
          case 'income':
            endpoint = `https://api.withmono.com/v2/accounts/${params.accountId}/income`;
            break;
          case 'statement':
            endpoint = `https://api.withmono.com/v2/accounts/${params.accountId}/statement?period=${params.period || 'last30days'}`;
            break;
        }

        const resp = await fetch(endpoint, {
          headers: { 'mono-sec-key': CONFIG.mono.secretKey },
          signal: AbortSignal.timeout(15000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (resp.ok) {
          return {
            success: true,
            data: { provider: 'mono', dataType: params.dataType, accountId: params.accountId, result: data.data || data },
            metadata: { country: 'NG' },
          };
        }

        return { success: false, data, error: `Mono data error: ${JSON.stringify(data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Mono data fetch failed: ${err}` };
      }
    },
  },

  // ─── 3. Mono Initiate Debit ───────────────────────────────
  {
    name: 'mono_initiate_debit',
    description: 'Direct debit from a linked Nigerian bank account via Mono. Amount in kobo. Requires approval.',
    category: 'banking',
    inputSchema: monoDebitSchema,
    requiresApproval: true,
    riskLevel: 'critical',
    execute: async (input, ctx) => {
      const params = monoDebitSchema.parse(input);
      ctx.logger.info(`[Plutus] Mono debit: account=${params.accountId} amount=${params.amount} kobo`);

      if (!CONFIG.mono.secretKey) {
        return { success: false, data: null, error: 'Mono not configured — set MONO_SECRET_KEY' };
      }

      try {
        const resp = await fetch('https://api.withmono.com/v2/payments/initiate', {
          method: 'POST',
          headers: {
            'mono-sec-key': CONFIG.mono.secretKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            account: params.accountId,
            amount: params.amount,
            narration: params.narration,
            reference: params.reference,
            type: 'onetime-debit',
          }),
          signal: AbortSignal.timeout(15000),
        });

        const data = await resp.json() as Record<string, unknown>;

        if (resp.ok) {
          return {
            success: true,
            data: {
              provider: 'mono',
              debitId: (data.data as Record<string, unknown>)?.id || data.id,
              reference: params.reference,
              amount: params.amount,
              status: 'processing',
              message: 'Debit initiated. Status will update via webhook.',
            },
            metadata: { country: 'NG', currency: 'NGN' },
          };
        }

        return { success: false, data, error: `Mono debit error: ${JSON.stringify(data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Mono debit failed: ${err}` };
      }
    },
  },

  // ─── 4. Stitch Link Account ───────────────────────────────
  {
    name: 'stitch_link_account',
    description: 'Generate a Stitch account linking URL for South African bank accounts. OAuth2 + GraphQL. Plug-and-play for fintech.',
    category: 'banking',
    inputSchema: stitchLinkSchema,
    requiresApproval: false,
    riskLevel: 'high',
    execute: async (input, ctx) => {
      const params = stitchLinkSchema.parse(input);
      ctx.logger.info(`[Plutus] Stitch link account: ${params.userIdentifier}`);

      if (!CONFIG.stitch.clientId) {
        return { success: false, data: null, error: 'Stitch not configured — set STITCH_CLIENT_ID/CLIENT_SECRET' };
      }

      try {
        const token = await stitchGetToken();

        const query = `
          mutation CreateAccountLinkingRequest($input: CreateAccountLinkingRequestInput!) {
            clientAccountLinkingRequestCreate(input: $input) {
              url
              id
            }
          }
        `;

        const variables = {
          input: {
            userIdentifier: params.userIdentifier,
            bankId: params.bankId || undefined,
            accountTypes: ['current', 'savings'],
          },
        };

        const data = await stitchGraphQL(query, variables, token);
        const result = data.data as Record<string, Record<string, unknown>> | undefined;
        const linkData = result?.clientAccountLinkingRequestCreate;

        if (linkData?.url) {
          return {
            success: true,
            data: {
              provider: 'stitch',
              linkingUrl: linkData.url,
              requestId: linkData.id,
              status: 'awaiting_customer',
              message: 'Send the linking URL to the customer to authorize bank access.',
            },
            metadata: { country: 'ZA', currency: 'ZAR' },
          };
        }

        return { success: false, data, error: `Stitch linking error: ${JSON.stringify(data.errors || data)}` };
      } catch (err) {
        return { success: false, data: null, error: `Stitch link failed: ${err}` };
      }
    },
  },

  // ─── 5. Stitch Get Account Data ───────────────────────────
  {
    name: 'stitch_get_account_data',
    description: 'Fetch linked South African bank account data via Stitch GraphQL API: balance, transactions, or account holders.',
    category: 'banking',
    inputSchema: stitchAccountDataSchema,
    requiresApproval: false,
    riskLevel: 'medium',
    execute: async (input, ctx) => {
      const params = stitchAccountDataSchema.parse(input);
      ctx.logger.info(`[Plutus] Stitch ${params.dataType}: account=${params.accountId}`);

      if (!CONFIG.stitch.clientId) {
        return { success: false, data: null, error: 'Stitch not configured — set STITCH_CLIENT_ID/CLIENT_SECRET' };
      }

      try {
        const token = await stitchGetToken();
        let query: string;
        let variables: Record<string, unknown>;

        switch (params.dataType) {
          case 'balance':
            query = `
              query GetBalance($accountId: ID!) {
                node(id: $accountId) {
                  ... on BankAccount {
                    currentBalance
                    availableBalance
                    currency
                    name
                    bankId
                    accountType
                  }
                }
              }
            `;
            variables = { accountId: params.accountId };
            break;

          case 'transactions':
            query = `
              query GetTransactions($accountId: ID!, $first: Int, $filter: TransactionFilterInput) {
                node(id: $accountId) {
                  ... on BankAccount {
                    transactions(first: $first, filter: $filter) {
                      edges {
                        node {
                          id
                          amount
                          description
                          date
                          runningBalance
                          reference
                        }
                      }
                    }
                  }
                }
              }
            `;
            variables = {
              accountId: params.accountId,
              first: 50,
              filter: {
                ...(params.fromDate ? { fromDate: params.fromDate } : {}),
                ...(params.toDate ? { toDate: params.toDate } : {}),
              },
            };
            break;

          case 'account_holders':
            query = `
              query GetAccountHolders($accountId: ID!) {
                node(id: $accountId) {
                  ... on BankAccount {
                    accountHolder {
                      ... on Individual {
                        fullName
                        identifyingDocument {
                          ... on IdentityDocument {
                            country
                            number
                          }
                        }
                        email
                        phone
                      }
                    }
                  }
                }
              }
            `;
            variables = { accountId: params.accountId };
            break;
        }

        const data = await stitchGraphQL(query, variables, token);

        if (data.errors) {
          return { success: false, data, error: `Stitch GraphQL errors: ${JSON.stringify(data.errors)}` };
        }

        return {
          success: true,
          data: { provider: 'stitch', dataType: params.dataType, accountId: params.accountId, result: data.data },
          metadata: { country: 'ZA' },
        };
      } catch (err) {
        return { success: false, data: null, error: `Stitch data fetch failed: ${err}` };
      }
    },
  },

  // ─── 6. Banking Providers Status ──────────────────────────
  {
    name: 'banking_providers_status',
    description: 'Health check for configured open banking providers (Mono for Nigeria, Stitch for South Africa).',
    category: 'banking',
    inputSchema: bankingProviderStatusSchema,
    requiresApproval: false,
    riskLevel: 'low',
    execute: async (input, ctx) => {
      const params = bankingProviderStatusSchema.parse(input);
      const checkAll = !params.providers || params.providers.length === 0;
      const results: Array<{ provider: string; configured: boolean; reachable: boolean; latencyMs: number; country: string }> = [];

      const providers = checkAll ? (['mono', 'stitch'] as const) : params.providers!;

      for (const p of providers) {
        const start = Date.now();
        let configured = false;
        let reachable = false;
        let country = '';

        try {
          switch (p) {
            case 'mono':
              country = 'NG';
              configured = !!CONFIG.mono.secretKey;
              if (configured) {
                const r = await fetch('https://api.withmono.com/v2/accounts', {
                  headers: { 'mono-sec-key': CONFIG.mono.secretKey },
                  signal: AbortSignal.timeout(5000),
                });
                reachable = r.status !== 0;
              }
              break;

            case 'stitch':
              country = 'ZA';
              configured = !!CONFIG.stitch.clientId;
              if (configured) {
                await stitchGetToken();
                reachable = true;
              }
              break;
          }
        } catch {
          reachable = false;
        }

        results.push({ provider: p, configured, reachable, latencyMs: Date.now() - start, country });
      }

      ctx.logger.info(`[Plutus] Banking provider status: ${results.filter(r => r.reachable).length}/${results.length} reachable`);

      return {
        success: true,
        data: {
          providers: results,
          summary: {
            total: results.length,
            configured: results.filter(r => r.configured).length,
            reachable: results.filter(r => r.reachable).length,
          },
        },
      };
    },
  },
];
