// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /deploy — Trigger deployment
// Project-aware: runs the active project's deploy script
// DANGEROUS: requires /confirm
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

export const deployCommand: OpenClawCommand = {
  name: 'deploy',
  aliases: ['release'],
  description: 'Run the deploy script (git pull + build + restart)',
  usage: '/deploy',
  dangerous: true,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const project = ctx.activeProject;

    if (!project.deployScript) {
      return { success: false, output: `No deploy script configured for ${project.name}.` };
    }

    await ctx.sendMessage(`*[${project.name}]* Deploying... this may take 1-2 minutes.`);

    return new Promise((resolve) => {
      exec(`bash ${project.deployScript} 2>&1`, {
        cwd: project.path,
        timeout: 180_000, // 3 minutes max
        maxBuffer: 1024 * 512,
      }, (error, stdout) => {
        const output = stdout?.trim() || 'No output';
        const success = !error && (output.includes('SUCCESS') || output.includes('success'));

        ctx.auditTrail.record('openclaw', 'deploy', ctx.chatId, {
          project: project.id,
          success,
          exitCode: error?.code ?? 0,
        });

        resolve({
          success,
          output: `*[${project.name}] Deploy ${success ? 'SUCCESS' : 'FAILED'}:*\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\`${output.length > 3500 ? '\n(truncated)' : ''}`,
        });
      });
    });
  },
};
