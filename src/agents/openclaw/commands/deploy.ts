// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /deploy — Trigger deployment
// DANGEROUS: requires /confirm
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

export const deployCommand: OpenClawCommand = {
  name: 'deploy',
  aliases: ['release'],
  description: 'Run the deploy script (git pull + build + pm2 reload)',
  usage: '/deploy',
  dangerous: true,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    await ctx.sendMessage('Deploying... this may take 1-2 minutes.');

    return new Promise((resolve) => {
      exec('bash /home/ec2-user/PromptPay/scripts/deploy.sh 2>&1', {
        cwd: '/home/ec2-user/PromptPay',
        timeout: 180_000, // 3 minutes max
        maxBuffer: 1024 * 512,
      }, (error, stdout) => {
        const output = stdout?.trim() || 'No output';
        const success = !error && output.includes('Deploy SUCCESS');

        ctx.auditTrail.record('openclaw', 'deploy', ctx.chatId, {
          success,
          exitCode: error?.code ?? 0,
        });

        resolve({
          success,
          output: `*Deploy ${success ? 'SUCCESS' : 'FAILED'}:*\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\`${output.length > 3500 ? '\n(truncated)' : ''}`,
        });
      });
    });
  },
};
