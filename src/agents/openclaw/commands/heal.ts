import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

function formatDate(value: Date | null): string {
  return value ? value.toISOString() : 'never';
}

export const healCommand: OpenClawCommand = {
  name: 'heal',
  aliases: ['recovery'],
  description: 'Inspect daemon health, breaker state, and safe recovery actions',
  usage: '/heal [status|breakers|jobs|probe|run <job>|reset <breaker>]',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const [action = 'status', target = ''] = args.trim().split(/\s+/);

    try {
      switch (action.toLowerCase()) {
        case 'status': {
          const state = ctx.orchestrator.getState();
          const breakers = ctx.circuitBreakers?.getState() || [];
          const jobs = ctx.daemon?.getJobs() || [];
          const openBreakers = breakers.filter(b => b.state === 'open').length;

          const output = `*Healing Status*
\`\`\`
Orchestrator: ${state.isRunning ? 'online' : 'offline'}
Tools:        ${state.toolCount}
Agents:       ${state.agentCount}
Events:       ${state.eventCount}
Breakers:     ${breakers.length} total / ${openBreakers} open
Daemon Jobs:  ${jobs.length}
\`\`\``;
          return { success: true, output };
        }

        case 'breakers': {
          const breakers = ctx.circuitBreakers?.getState() || [];
          if (!breakers.length) return { success: true, output: 'No circuit breakers registered yet.' };
          const lines = breakers.map(b =>
            `- \`${b.toolName}\` — ${b.state} | failures=${b.failureCount} | last=${formatDate(b.lastFailure)}`
          );
          return { success: true, output: `*Circuit Breakers*\n${lines.join('\n')}` };
        }

        case 'jobs': {
          const jobs = ctx.daemon?.getJobs() || [];
          if (!jobs.length) return { success: true, output: 'Daemon jobs are unavailable in this context.' };
          const lines = jobs.map(job =>
            `- \`${job.id}\` — ${job.enabled ? 'enabled' : 'disabled'} | next=${job.nextRun.toISOString()} | last=${formatDate(job.lastRun)}`
          );
          return { success: true, output: `*Daemon Jobs*\n${lines.join('\n')}` };
        }

        case 'probe': {
          const state = ctx.orchestrator.getState();
          const breakers = ctx.circuitBreakers?.evaluate() || [];
          const output = `*Healing Probe*
\`\`\`
Orchestrator running: ${state.isRunning}
Breaker transitions:  ${breakers.length}
Recent transitions:   ${breakers.map(b => `${b.toolName}:${b.state}`).join(', ') || 'none'}
\`\`\``;
          return { success: true, output };
        }

        case 'run': {
          if (!target) return { success: false, output: 'Usage: /heal run <job-id>' };
          if (!ctx.daemon) return { success: false, output: 'Daemon control is unavailable in this context.' };
          const ok = ctx.daemon.triggerJob(target);
          if (!ok) return { success: false, output: `Unknown daemon job: ${target}` };
          ctx.auditTrail.record('openclaw', 'heal_trigger_job', ctx.chatId, { job: target, project: ctx.activeProject.id });
          return { success: true, output: `Triggered daemon job \`${target}\`.` };
        }

        case 'reset': {
          if (!target) return { success: false, output: 'Usage: /heal reset <breaker-name>' };
          if (!ctx.circuitBreakers) return { success: false, output: 'Circuit breaker control is unavailable in this context.' };
          ctx.circuitBreakers.reset(target);
          ctx.auditTrail.record('openclaw', 'heal_reset_breaker', ctx.chatId, { breaker: target, project: ctx.activeProject.id });
          return { success: true, output: `Reset circuit breaker \`${target}\`.` };
        }

        default:
          return { success: false, output: 'Usage: /heal [status|breakers|jobs|probe|run <job>|reset <breaker>]' };
      }
    } catch (err) {
      return { success: false, output: `Healing error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
