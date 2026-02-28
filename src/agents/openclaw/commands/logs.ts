// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /logs — Read PM2 log lines
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

export const logsCommand: OpenClawCommand = {
  name: 'logs',
  aliases: ['log'],
  description: 'Read last N PM2 log lines',
  usage: '/logs [N] [--error]',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    const errorOnly = parts.includes('--error');
    const lineCount = Math.min(parseInt(parts.find(p => /^\d+$/.test(p)) || '30', 10), 200);

    const logType = errorOnly ? '--err' : '';
    const cmd = `pm2 logs upromptpay --nostream --lines ${lineCount} ${logType} 2>/dev/null || tail -n ${lineCount} /home/ec2-user/PromptPay/logs/pm2-${errorOnly ? 'error' : 'out'}.log 2>/dev/null || echo "No logs found"`;

    return new Promise((resolve) => {
      exec(cmd, { timeout: 10_000, maxBuffer: 1024 * 256 }, (error, stdout) => {
        const output = stdout?.trim() || 'No log output';
        resolve({
          success: true,
          output: `*Last ${lineCount} ${errorOnly ? 'error ' : ''}log lines:*\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\`${output.length > 3500 ? '\n(truncated)' : ''}`,
        });
      });
    });
  },
};
