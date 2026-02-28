// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /status — Full platform dashboard
// ═══════════════════════════════════════════════════════════════

import os from 'os';
import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';
import { CONFIG } from '../../../core/config.js';

type QueryRow = Record<string, unknown>;

export const statusCommand: OpenClawCommand = {
  name: 'status',
  aliases: ['dashboard'],
  description: 'Full platform status dashboard',
  usage: '/status',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    try {
      // System metrics
      const uptime = formatUptime(process.uptime());
      const mem = process.memoryUsage();
      const freeMem = os.freemem();
      const totalMem = os.totalmem();
      const loadAvg = os.loadavg();

      // DB stats
      const users = ctx.db.prepare('SELECT COUNT(*) as c FROM users').get() as QueryRow;
      const txns = ctx.db.prepare('SELECT COUNT(*) as c FROM fee_ledger').get() as QueryRow;
      const revenue = ctx.db.prepare('SELECT COALESCE(SUM(fee_amount), 0) as t FROM fee_ledger').get() as QueryRow;
      const todayTxns = ctx.db.prepare(`SELECT COUNT(*) as c FROM fee_ledger WHERE DATE(created_at) = DATE('now')`).get() as QueryRow;
      const todayRev = ctx.db.prepare(`SELECT COALESCE(SUM(fee_amount), 0) as t FROM fee_ledger WHERE DATE(created_at) = DATE('now')`).get() as QueryRow;
      const activeStreaks = ctx.db.prepare('SELECT COUNT(*) as c FROM user_streaks WHERE current_streak > 0').get() as QueryRow;
      const memories = ctx.db.prepare('SELECT COUNT(*) as c FROM memories').get() as QueryRow;
      const auditCount = ctx.db.prepare('SELECT COUNT(*) as c FROM audit_trail').get() as QueryRow;

      // Orchestrator
      const orchState = ctx.orchestrator.getState();

      // PM2 process count
      const pm2Info = await getPm2Info();

      // Channel status
      const channels = [];
      if (CONFIG.telegram.botToken) channels.push('Telegram');
      if (CONFIG.email.resendApiKey) channels.push('Email');
      if (CONFIG.push.vapidPublicKey) channels.push('Push');
      if (CONFIG.sms.twilioAccountSid) channels.push('SMS');

      const output = `*PromptPay Status Dashboard*
\`\`\`
══ SYSTEM ══════════════════════
Uptime:     ${uptime}
Memory:     ${(mem.rss / 1024 / 1024).toFixed(0)}MB RSS / ${(totalMem / 1024 / 1024).toFixed(0)}MB total
RAM Free:   ${(freeMem / 1024 / 1024).toFixed(0)}MB (${((freeMem / totalMem) * 100).toFixed(0)}%)
Load:       ${loadAvg.map(l => l.toFixed(2)).join(' / ')}
Node:       ${process.version}
Worker:     ${process.env.NODE_APP_INSTANCE ?? 'fork'}
${pm2Info}

══ APPLICATION ═════════════════
Version:    ${CONFIG.platform.version}
Domain:     ${CONFIG.platform.domainUrl}
Port:       ${CONFIG.gateway.port}
Tools:      ${orchState.toolCount}
Orchestrator: ${orchState.isRunning ? 'Running' : 'Stopped'}
Channels:   ${channels.join(', ') || 'None'}

══ DATABASE ════════════════════
Users:      ${users?.c ?? 0}
Memories:   ${memories?.c ?? 0}
Audit:      ${auditCount?.c ?? 0}

══ REVENUE ═════════════════════
Today:      $${Number(todayRev?.t ?? 0).toFixed(2)} (${todayTxns?.c ?? 0} txns)
All-time:   $${Number(revenue?.t ?? 0).toFixed(2)} (${txns?.c ?? 0} txns)

══ ENGAGEMENT ══════════════════
Active streaks: ${activeStreaks?.c ?? 0}
\`\`\``;

      return { success: true, output };
    } catch (err) {
      return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function getPm2Info(): Promise<string> {
  return new Promise((resolve) => {
    exec('pm2 jlist 2>/dev/null', { timeout: 5000 }, (error, stdout) => {
      if (error || !stdout?.trim()) {
        resolve('PM2:        Not available');
        return;
      }
      try {
        const procs = JSON.parse(stdout) as Array<{ pm2_env: { status: string; exec_mode: string } }>;
        const online = procs.filter(p => p.pm2_env.status === 'online').length;
        const mode = procs[0]?.pm2_env?.exec_mode || 'unknown';
        resolve(`PM2:        ${online}/${procs.length} online (${mode})`);
      } catch {
        resolve('PM2:        Parse error');
      }
    });
  });
}
