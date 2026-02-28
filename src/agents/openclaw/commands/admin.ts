// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /admin — Query database for platform stats
// ═══════════════════════════════════════════════════════════════

import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

type QueryRow = Record<string, unknown>;

export const adminCommand: OpenClawCommand = {
  name: 'admin',
  aliases: ['api'],
  description: 'Query platform database: dashboard, users, revenue, audit, hooks',
  usage: '/admin <dashboard|users|revenue|audit|hooks|agents>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const section = args.trim().split(/\s+/)[0]?.toLowerCase() || 'dashboard';

    try {
      let output: string;

      switch (section) {
        case 'dashboard': {
          const users = ctx.db.prepare('SELECT COUNT(*) as count FROM users').get() as QueryRow;
          const txns = ctx.db.prepare('SELECT COUNT(*) as count FROM fee_ledger').get() as QueryRow;
          const revenue = ctx.db.prepare('SELECT COALESCE(SUM(fee_amount), 0) as total FROM fee_ledger').get() as QueryRow;
          const audit = ctx.db.prepare('SELECT COUNT(*) as count FROM audit_trail').get() as QueryRow;
          const memories = ctx.db.prepare('SELECT COUNT(*) as count FROM memories').get() as QueryRow;
          const streaks = ctx.db.prepare('SELECT COUNT(*) as count FROM user_streaks WHERE current_streak > 0').get() as QueryRow;

          output = `*Platform Dashboard*
\`\`\`
Users:          ${users?.count ?? 0}
Transactions:   ${txns?.count ?? 0}
Revenue (fees): $${Number(revenue?.total ?? 0).toFixed(2)}
Audit entries:  ${audit?.count ?? 0}
Memories:       ${memories?.count ?? 0}
Active streaks: ${streaks?.count ?? 0}
\`\`\``;
          break;
        }

        case 'users': {
          const rows = ctx.db.prepare(`
            SELECT id, email, display_name, role, country_code, kyc_tier, created_at
            FROM users ORDER BY created_at DESC LIMIT 20
          `).all() as QueryRow[];

          const lines = rows.map((r: QueryRow) =>
            `${r.display_name || r.email} | ${r.role} | ${r.country_code || '??'} | KYC:${r.kyc_tier ?? 0}`
          );
          output = `*Users (latest 20):*\n\`\`\`\n${lines.join('\n') || 'No users'}\n\`\`\``;
          break;
        }

        case 'revenue': {
          const daily = ctx.db.prepare(`
            SELECT DATE(created_at) as day, SUM(fee_amount) as total, COUNT(*) as txns
            FROM fee_ledger
            GROUP BY DATE(created_at)
            ORDER BY day DESC LIMIT 14
          `).all() as QueryRow[];

          const lines = daily.map((r: QueryRow) =>
            `${r.day} | $${Number(r.total).toFixed(2)} | ${r.txns} txns`
          );
          output = `*Revenue (last 14 days):*\n\`\`\`\n${lines.join('\n') || 'No revenue data'}\n\`\`\``;
          break;
        }

        case 'audit': {
          const recent = ctx.db.prepare(`
            SELECT actor, action, target, timestamp
            FROM audit_trail
            ORDER BY sequence_number DESC LIMIT 20
          `).all() as QueryRow[];

          const lines = recent.map((r: QueryRow) =>
            `${String(r.timestamp).slice(11, 19)} | ${r.actor} | ${r.action} → ${r.target}`
          );
          output = `*Audit Trail (latest 20):*\n\`\`\`\n${lines.join('\n') || 'No entries'}\n\`\`\``;
          break;
        }

        case 'hooks': {
          const streaks = ctx.db.prepare('SELECT COUNT(*) as c FROM user_streaks').get() as QueryRow;
          const cashback = ctx.db.prepare('SELECT COUNT(*) as c FROM cashback_ledger').get() as QueryRow;
          const referrals = ctx.db.prepare('SELECT COUNT(*) as c FROM referral_events').get() as QueryRow;
          const achievements = ctx.db.prepare('SELECT COUNT(*) as c FROM user_achievements').get() as QueryRow;
          const loyalty = ctx.db.prepare('SELECT COUNT(*) as c FROM loyalty_accounts').get() as QueryRow;
          const savings = ctx.db.prepare('SELECT COUNT(*) as c FROM savings_goals').get() as QueryRow;

          output = `*Engagement Hooks:*
\`\`\`
Streaks:      ${streaks?.c ?? 0} users
Cashback:     ${cashback?.c ?? 0} entries
Referrals:    ${referrals?.c ?? 0} events
Achievements: ${achievements?.c ?? 0} unlocked
Loyalty:      ${loyalty?.c ?? 0} accounts
Savings goals: ${savings?.c ?? 0}
\`\`\``;
          break;
        }

        case 'agents': {
          const state = ctx.orchestrator.getState();
          output = `*Orchestrator State:*
\`\`\`
Tools:    ${state.toolCount}
Status:   ${state.isRunning ? 'Running' : 'Stopped'}
\`\`\``;
          break;
        }

        default:
          output = `Unknown section: ${section}\nAvailable: dashboard, users, revenue, audit, hooks, agents`;
      }

      return { success: true, output };
    } catch (err) {
      return { success: false, output: `DB error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
