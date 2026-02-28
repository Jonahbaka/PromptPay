// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /project — Switch active project context
// ═══════════════════════════════════════════════════════════════

import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';
import { resolveProject, getProjectList } from '../projects.js';

export const projectCommand: OpenClawCommand = {
  name: 'project',
  aliases: ['proj', 'switch'],
  description: 'Switch active project (promptpay, doctarx)',
  usage: '/project <name>',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const name = args.trim().toLowerCase();

    if (!name) {
      const current = ctx.activeProject?.name || 'PromptPay';
      return {
        success: true,
        output: `*Active project:* ${current}\n\n*Available projects:*\n${getProjectList()}\n\nUse \`/project <name>\` to switch.`,
      };
    }

    const project = resolveProject(name);
    if (!project) {
      return {
        success: false,
        output: `Unknown project: \`${name}\`\n\n*Available:*\n${getProjectList()}`,
      };
    }

    // The actual switching happens in the agent's handleMessage
    // We return a special marker that the agent picks up
    return {
      success: true,
      output: `__SWITCH_PROJECT__:${project.id}`,
    };
  },
};
