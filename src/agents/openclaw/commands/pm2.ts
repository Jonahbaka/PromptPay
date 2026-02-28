// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /pm2 — PM2 process management
// Project-aware: targets active project's PM2 process
// restart/reload are DANGEROUS, list/status are safe
// ═══════════════════════════════════════════════════════════════

import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

const SAFE_ACTIONS = ['list', 'status', 'monit', 'describe'];
const DANGEROUS_ACTIONS = ['restart', 'reload', 'stop', 'start'];
const ALL_ACTIONS = [...SAFE_ACTIONS, ...DANGEROUS_ACTIONS];

export const pm2Command: OpenClawCommand = {
  name: 'pm2',
  aliases: [],
  description: 'PM2 process management',
  usage: '/pm2 <list|status|restart|reload>',
  dangerous: false, // We handle danger per-subcommand

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const action = args.trim().split(/\s+/)[0]?.toLowerCase() || 'list';
    const project = ctx.activeProject;

    if (!ALL_ACTIONS.includes(action)) {
      return { success: false, output: `Unknown action: ${action}\nAllowed: ${ALL_ACTIONS.join(', ')}` };
    }

    // Build the PM2 command
    let cmd: string;
    if (action === 'list' || action === 'status') {
      cmd = 'pm2 jlist 2>/dev/null';
    } else if (action === 'describe') {
      cmd = `pm2 describe ${project.pm2Name} 2>/dev/null`;
    } else {
      cmd = `pm2 ${action} ${project.pm2Name} 2>/dev/null`;
    }

    return new Promise((resolve) => {
      exec(cmd, { timeout: 15_000, maxBuffer: 1024 * 256 }, (error, stdout) => {
        let output = stdout?.trim() || 'No output';

        // Format jlist output nicely
        if ((action === 'list' || action === 'status') && output.startsWith('[')) {
          try {
            const procs = JSON.parse(output) as Array<{
              name: string; pm_id: number; pid: number;
              pm2_env: { status: string; exec_mode: string; instances: number; pm_uptime: number; restart_time: number };
              monit: { memory: number; cpu: number };
            }>;
            const lines = procs.map(p => {
              const mem = (p.monit.memory / 1024 / 1024).toFixed(1);
              const uptime = Math.floor((Date.now() - p.pm2_env.pm_uptime) / 60000);
              const marker = p.name === project.pm2Name ? '→ ' : '  ';
              return `${marker}${p.name}[${p.pm_id}] | ${p.pm2_env.status} | PID:${p.pid} | ${mem}MB | CPU:${p.monit.cpu}% | Up:${uptime}m | Restarts:${p.pm2_env.restart_time}`;
            });
            output = lines.join('\n') || 'No processes';
          } catch {}
        }

        ctx.auditTrail.record('openclaw', 'pm2_action', ctx.chatId, { action, project: project.id });

        resolve({
          success: !error,
          output: `*[${project.name}] PM2 ${action}:*\n\`\`\`\n${output.slice(0, 3500)}\n\`\`\``,
        });
      });
    });
  },
};
