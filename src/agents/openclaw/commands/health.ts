// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /health — System health metrics
// ═══════════════════════════════════════════════════════════════

import os from 'os';
import { exec } from 'child_process';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

export const healthCommand: OpenClawCommand = {
  name: 'health',
  aliases: ['ping'],
  description: 'System health: uptime, memory, CPU, disk',
  usage: '/health',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const uptime = process.uptime();
    const uptimeStr = formatUptime(uptime);
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // Get disk usage
    const diskInfo = await getDiskUsage();

    // Orchestrator state
    const orchState = ctx.orchestrator.getState();

    const output = `*System Health*
\`\`\`
── Process ──
Uptime:      ${uptimeStr}
Heap Used:   ${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB
Heap Total:  ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB
RSS:         ${(mem.rss / 1024 / 1024).toFixed(1)} MB
External:    ${(mem.external / 1024 / 1024).toFixed(1)} MB

── System ──
CPUs:        ${cpus.length} x ${cpus[0]?.model?.trim() || 'unknown'}
Load (1/5/15): ${loadAvg.map(l => l.toFixed(2)).join(' / ')}
Total RAM:   ${(totalMem / 1024 / 1024).toFixed(0)} MB
Free RAM:    ${(freeMem / 1024 / 1024).toFixed(0)} MB
Used RAM:    ${((totalMem - freeMem) / 1024 / 1024).toFixed(0)} MB (${(((totalMem - freeMem) / totalMem) * 100).toFixed(1)}%)

── Disk ──
${diskInfo}

── Orchestrator ──
Tools:       ${orchState.toolCount}
Status:      ${orchState.isRunning ? 'Running' : 'Stopped'}

── Node ──
Version:     ${process.version}
PID:         ${process.pid}
Worker:      ${process.env.NODE_APP_INSTANCE ?? 'N/A'}
\`\`\``;

    return { success: true, output };
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

function getDiskUsage(): Promise<string> {
  return new Promise((resolve) => {
    exec('df -h / 2>/dev/null | tail -1', { timeout: 5000 }, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve('Unavailable');
        return;
      }
      const parts = stdout.trim().split(/\s+/);
      resolve(`${parts[2] || '?'} / ${parts[1] || '?'} (${parts[4] || '?'} used)`);
    });
  });
}
