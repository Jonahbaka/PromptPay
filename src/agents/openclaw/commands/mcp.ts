import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';
import { openClawMcp, isSensitiveMcpToolName } from '../mcp.js';

function formatJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2) || 'null';
  return text.length > 3500 ? `${text.slice(0, 3500)}\n... [truncated]` : text;
}

function parseJsonArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export const mcpCommand: OpenClawCommand = {
  name: 'mcp',
  aliases: ['context'],
  description: 'Inspect or call MCP servers, tools, resources, and prompts',
  usage: '/mcp <servers|tools|resources|prompts|read|prompt|call> ...',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const [action = 'servers', serverName = '', target = '', ...rest] = args.trim().split(/\s+/);
    const trailing = rest.join(' ').trim();

    try {
      switch (action.toLowerCase()) {
        case 'servers': {
          const servers = openClawMcp.listServers();
          if (!servers.length) {
            return { success: true, output: 'No MCP servers configured.' };
          }
          const lines = servers.map(server => `- \`${server.name}\` → ${server.url}`);
          return { success: true, output: `*MCP Servers*\n${lines.join('\n')}` };
        }

        case 'tools': {
          if (!serverName) return { success: false, output: 'Usage: /mcp tools <server>' };
          const tools = await openClawMcp.listTools(serverName);
          if (!tools.length) return { success: true, output: `No MCP tools exposed by \`${serverName}\`.` };
          const lines = tools.map(tool => `- \`${tool.name}\`${tool.description ? ` — ${tool.description}` : ''}`);
          return { success: true, output: `*MCP Tools — ${serverName}*\n${lines.join('\n')}` };
        }

        case 'resources': {
          if (!serverName) return { success: false, output: 'Usage: /mcp resources <server>' };
          const resources = await openClawMcp.listResources(serverName);
          if (!resources.length) return { success: true, output: `No MCP resources exposed by \`${serverName}\`.` };
          const lines = resources.map(resource => `- \`${resource.uri}\`${resource.name ? ` — ${resource.name}` : ''}`);
          return { success: true, output: `*MCP Resources — ${serverName}*\n${lines.join('\n')}` };
        }

        case 'prompts': {
          if (!serverName) return { success: false, output: 'Usage: /mcp prompts <server>' };
          const prompts = await openClawMcp.listPrompts(serverName);
          if (!prompts.length) return { success: true, output: `No MCP prompts exposed by \`${serverName}\`.` };
          const lines = prompts.map(prompt => `- \`${prompt.name}\`${prompt.description ? ` — ${prompt.description}` : ''}`);
          return { success: true, output: `*MCP Prompts — ${serverName}*\n${lines.join('\n')}` };
        }

        case 'read': {
          if (!serverName || !target) return { success: false, output: 'Usage: /mcp read <server> <uri>' };
          const resource = await openClawMcp.readResource(serverName, target);
          return { success: true, output: `*MCP Resource — ${serverName}*\n\`\`\`\n${formatJson(resource)}\n\`\`\`` };
        }

        case 'prompt': {
          if (!serverName || !target) return { success: false, output: 'Usage: /mcp prompt <server> <name> [jsonArgs]' };
          const prompt = await openClawMcp.getPrompt(serverName, target, parseJsonArgs(trailing));
          return { success: true, output: `*MCP Prompt — ${serverName}/${target}*\n\`\`\`\n${formatJson(prompt)}\n\`\`\`` };
        }

        case 'call': {
          if (!serverName || !target) return { success: false, output: 'Usage: /mcp call <server> <tool> [jsonArgs]' };
          if (isSensitiveMcpToolName(target)) {
            return {
              success: false,
              output: `Blocked sensitive MCP tool \`${target}\`. Use a project-native slash command or manual review path instead.`,
            };
          }
          const result = await openClawMcp.callTool(serverName, target, parseJsonArgs(trailing));
          ctx.auditTrail.record('openclaw', 'mcp_tool_call', ctx.chatId, {
            server: serverName,
            tool: target,
            project: ctx.activeProject.id,
          });
          return { success: true, output: `*MCP Tool Result — ${serverName}/${target}*\n\`\`\`\n${formatJson(result)}\n\`\`\`` };
        }

        default:
          return { success: false, output: 'Usage: /mcp <servers|tools|resources|prompts|read|prompt|call> ...' };
      }
    } catch (err) {
      return { success: false, output: `MCP error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
