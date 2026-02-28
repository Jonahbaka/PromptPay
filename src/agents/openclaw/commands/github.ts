// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /github — GitHub operations via git/gh CLI
// Project-aware: runs in active project directory
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

const ACTIONS: Record<string, string> = {
  commits: 'git log --oneline -20',
  status: 'git status --short',
  diff: 'git diff --stat',
  branch: 'git branch -a',
  log: 'git log --oneline -10',
  issues: 'gh issue list --limit 10 2>/dev/null || echo "gh CLI not available or not authenticated"',
  prs: 'gh pr list --limit 10 2>/dev/null || echo "gh CLI not available or not authenticated"',
  actions: 'gh run list --limit 5 2>/dev/null || echo "gh CLI not available or not authenticated"',
};

export const githubCommand: OpenClawCommand = {
  name: 'github',
  aliases: ['gh', 'git'],
  description: 'GitHub & git operations',
  usage: '/github <commits|status|diff|branch|issues|prs|actions>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const action = args.trim().split(/\s+/)[0]?.toLowerCase() || 'status';

    const cmd = ACTIONS[action];
    if (!cmd) {
      return { success: false, output: `Unknown action: ${action}\nAvailable: ${Object.keys(ACTIONS).join(', ')}` };
    }

    const project = ctx.activeProject;

    return new Promise((resolve) => {
      exec(cmd, {
        cwd: project.path,
        timeout: 15_000,
        maxBuffer: 1024 * 256,
      }, (error, stdout) => {
        const output = stdout?.trim() || 'No output';

        resolve({
          success: !error,
          output: `*[${project.name}] GitHub — ${action}:*\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\``,
        });
      });
    });
  },
};
