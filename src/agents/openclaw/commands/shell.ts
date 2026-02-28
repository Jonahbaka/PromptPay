// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /shell — Execute shell commands on the server
// DANGEROUS: requires /confirm
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  /rm\s+-rf\s+\/\*/,
  /mkfs/,
  /dd\s+if=/,
  /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/,    // fork bomb
  /\.\/\(.*\)\s*\{\s*\|/,               // fork bomb variants
  /shutdown/,
  /reboot/,
  /init\s+[06]/,
  /passwd/,
  /useradd/,
  /userdel/,
  /usermod/,
  /iptables\s+-F/,
  /iptables\s+-X/,
  />\s*\/dev\/sd/,
  />\s*\/dev\/nvme/,
  /curl.*\|\s*(ba)?sh/,
  /wget.*\|\s*(ba)?sh/,
  /npm\s+publish/,
  /npx.*publish/,
  /rm\s+-rf\s+~\//,
  /rm\s+-rf\s+\.\//,
  /chmod\s+777\s+\//,
  /chown.*\s+\//,
];

export const shellCommand: OpenClawCommand = {
  name: 'shell',
  aliases: ['sh', 'exec', 'run'],
  description: 'Execute a shell command on the server',
  usage: '/shell <command>',
  dangerous: true,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    if (!args.trim()) {
      return { success: false, output: 'Usage: /shell <command>' };
    }

    // Check blocklist
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(args)) {
        ctx.auditTrail.record('openclaw', 'shell_blocked', ctx.chatId, { command: args });
        return { success: false, output: `Blocked: dangerous command pattern detected.\nPattern: \`${pattern.source}\`` };
      }
    }

    return new Promise((resolve) => {
      const timeout = 30_000;
      const child = exec(args, {
        cwd: '/home/ec2-user/PromptPay',
        timeout,
        maxBuffer: 1024 * 512,
        env: { ...process.env, TERM: 'dumb' },
      }, (error, stdout, stderr) => {
        const output = stdout || '';
        const errOut = stderr || '';
        const exitCode = error?.code ?? 0;

        let result = '';
        if (output) result += output;
        if (errOut) result += (result ? '\n' : '') + `stderr: ${errOut}`;
        if (error && error.killed) result = 'Command timed out (30s limit)';
        if (!result) result = exitCode === 0 ? '(no output)' : `Exit code: ${exitCode}`;

        ctx.auditTrail.record('openclaw', 'shell_exec', ctx.chatId, {
          command: args.slice(0, 200),
          exitCode,
          outputLength: result.length,
        });

        resolve({
          success: exitCode === 0,
          output: `\`\`\`\n$ ${args}\n${result.slice(0, 3500)}\n\`\`\`${result.length > 3500 ? '\n(truncated)' : ''}`,
        });
      });
    });
  },
};
