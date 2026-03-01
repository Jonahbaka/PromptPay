// ═══════════════════════════════════════════════════════════════
// Agent::OpenClaw — Owner's Autonomous Telegram Agent
// Agentic tool-use loop via Kimi K2.5 + multi-project commands
// ═══════════════════════════════════════════════════════════════

import type Database from 'better-sqlite3';
import type { LoggerHandle, MemoryHandle } from '../../core/types.js';
import type { AuditTrail } from '../../protocols/audit-trail.js';
import type { Orchestrator } from '../../core/orchestrator.js';
import type { TelegramChannel } from '../../channels/telegram.js';
import type { OpenClawCommand, CommandContext } from './commands.js';
import { CONFIG } from '../../core/config.js';
import { PROJECTS, resolveProject, type Project } from './projects.js';

// Import all commands
import { shellCommand } from './commands/shell.js';
import { logsCommand } from './commands/logs.js';
import { pm2Command } from './commands/pm2.js';
import { deployCommand } from './commands/deploy.js';
import { githubCommand } from './commands/github.js';
import { adminCommand } from './commands/admin.js';
import { healthCommand } from './commands/health.js';
import { fileCommand } from './commands/file.js';
import { envCommand } from './commands/env.js';
import { statusCommand } from './commands/status.js';
import { projectCommand } from './commands/project.js';

interface OpenClawDeps {
  telegram: TelegramChannel;
  auditTrail: AuditTrail;
  logger: LoggerHandle;
  db: Database.Database;
  orchestrator: Orchestrator;
  memoryHandle: MemoryHandle;
}

interface PendingCommand {
  command: OpenClawCommand;
  args: string;
  chatId: string;
  timestamp: number;
}

// ── OpenAI-compatible tool definitions for Kimi K2.5 ──────────

interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required?: string[];
    };
  };
}

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'health',
      description: 'Get system health metrics: CPU, memory, disk, uptime, Node.js info, orchestrator state',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'status',
      description: 'Full platform dashboard: system info, PM2 processes, app config, database stats, revenue, engagement',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'admin',
      description: 'Query database for admin info: dashboard overview, users, revenue, audit trail, hooks/engagement, agents',
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            description: 'Which admin section to query',
            enum: ['dashboard', 'users', 'revenue', 'audit', 'hooks', 'agents'],
          },
        },
        required: ['section'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'logs',
      description: 'Read PM2 log lines for the active project',
      parameters: {
        type: 'object',
        properties: {
          lines: { type: 'number', description: 'Number of lines to read (default 30, max 200)' },
          error_only: { type: 'boolean', description: 'Show only error logs' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'github',
      description: 'GitHub operations: commits, status, diff, branch, log, issues, prs, actions',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'GitHub action to perform',
            enum: ['commits', 'status', 'diff', 'branch', 'log', 'issues', 'prs', 'actions'],
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file',
      description: 'Read a file or list a directory on the server (whitelisted paths only, no .env/.pem/secrets)',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File or directory path relative to project root' },
          lines: { type: 'number', description: 'Max lines to show (default 100)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'env',
      description: 'Show application config with secrets masked. Optionally drill into a section.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Config section name (e.g. "ollama", "stripe", "telegram"). Omit to list all sections.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pm2',
      description: 'PM2 process management. Safe actions: list, status, monit, describe. Dangerous actions (restart/reload/stop) are blocked in agentic mode.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: 'PM2 action to perform',
            enum: ['list', 'status', 'monit', 'describe', 'restart', 'reload', 'stop', 'start'],
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Execute a shell command on the server. BLOCKED in agentic mode for safety — tell the owner to use /shell <cmd> + /confirm.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'deploy',
      description: 'Trigger deployment. BLOCKED in agentic mode — tell the owner to use /deploy + /confirm.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'project',
      description: 'Switch active project context (promptpay or doctarx)',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name or alias: promptpay, pp, doctarx, dx' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_store',
      description: 'Store important information to persistent memory (survives restarts). Use for facts, decisions, events.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The information to remember' },
          namespace: { type: 'string', description: 'Category namespace (default: openclaw)' },
          importance: { type: 'number', description: 'Importance score 0.0-1.0 (default: 0.5)' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'memory_recall',
      description: 'Recall information from persistent memory by semantic search',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query for memory recall' },
          namespace: { type: 'string', description: 'Filter by namespace (default: openclaw)' },
        },
        required: ['query'],
      },
    },
  },
];

// ── System prompt (agentic, tool-aware) ───────────────────────

function buildSystemPrompt(project: Project): string {
  return `You are OpenClaw, a private AI agent for the owner of PromptPay and DoctaRx.
You are NOT a customer-facing chatbot. You are a fully autonomous agent with tools.

## Who You Are
- Name: OpenClaw
- Role: Personal AI agent for the founder
- Platform: Telegram (@promtpay_bot)
- Personality: Sharp, direct, resourceful. Think like a CTO + CEO hybrid.

## Your Tools
You have real tools that query the live server. USE THEM when relevant:
- **health** — system metrics (CPU, RAM, disk, uptime)
- **status** — full platform dashboard
- **admin** — database queries (users, revenue, audit, engagement)
- **logs** — PM2 application logs
- **github** — git commits, status, diff, branches, issues, PRs, CI/CD
- **file** — read server files (whitelisted paths, no secrets)
- **env** — show config sections (secrets masked)
- **pm2** — process management (list/status safe; restart/reload/stop blocked)
- **project** — switch between PromptPay and DoctaRx
- **memory_store** / **memory_recall** — persistent memory across restarts

## When to Use Tools
- Questions about server health, status, performance → use health/status
- Questions about users, revenue, metrics → use admin
- Questions about recent errors or issues → use logs
- Questions about code changes, deployments → use github
- Questions about code/files → use file
- When asked to remember something → use memory_store
- When asked about past events/decisions → use memory_recall
- Chain multiple tools when needed for a complete answer

## Dangerous Operations (BLOCKED)
These require the owner to use manual slash commands + /confirm:
- **shell** — arbitrary shell commands → tell owner to use \`/shell <cmd>\` + \`/confirm\`
- **deploy** — deployment → tell owner to use \`/deploy\` + \`/confirm\`
- **pm2 restart/reload/stop** → tell owner to use \`/pm2 <action>\` + \`/confirm\`

## Active Project
- **${project.name}** — ${project.description}
- Path: \`${project.path}\`
- PM2: \`${project.pm2Name}\`
- Stack: ${project.stack}

## Projects You Manage
1. **PromptPay** — AI-powered fintech platform for Africa + global
   - Stack: TypeScript, Express 5, SQLite, PM2 cluster on EC2
   - Domain: upromptpay.com
2. **DoctaRx** — HIPAA-compliant telehealth platform
   - Stack: Next.js 15, Express 4, PostgreSQL, Redis, Socket.io

## Rules
- You serve ONLY the owner. This channel is private.
- Be direct. No fluff, no "I'd be happy to help".
- Keep responses concise for Telegram (under 4000 chars). Use markdown.
- When discussing code, be specific with file paths and line numbers.
- You can discuss ANY topic — tech, business, news, personal, creative, anything.
- If asked about the server or platform, USE YOUR TOOLS rather than guessing.
- You have persistent memory — store important facts and recall them later.
- Reference earlier conversation when relevant.`;
}

// ── Agent class ───────────────────────────────────────────────

export class OpenClawAgent {
  private commands = new Map<string, OpenClawCommand>();
  private pending: PendingCommand | null = null;
  private history: Array<{ role: string; content: string; tool_calls?: ToolCall[]; tool_call_id?: string }> = [];
  private telegram: TelegramChannel;
  private auditTrail: AuditTrail;
  private logger: LoggerHandle;
  private db: Database.Database;
  private orchestrator: Orchestrator;
  private memoryHandle: MemoryHandle;
  private activeProject: Project = PROJECTS.promptpay;

  constructor(deps: OpenClawDeps) {
    this.telegram = deps.telegram;
    this.auditTrail = deps.auditTrail;
    this.logger = deps.logger;
    this.db = deps.db;
    this.orchestrator = deps.orchestrator;
    this.memoryHandle = deps.memoryHandle;

    // Register all commands
    const allCommands = [
      shellCommand, logsCommand, pm2Command, deployCommand,
      githubCommand, adminCommand, healthCommand, fileCommand,
      envCommand, statusCommand, projectCommand,
    ];

    for (const cmd of allCommands) {
      this.commands.set(cmd.name, cmd);
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
  }

  async handleMessage(chatId: string, username: string, text: string): Promise<void> {
    this.logger.info(`OpenClaw [${this.activeProject.id}] from @${username}: ${text.slice(0, 80)}`);

    try {
      // Handle /confirm
      if (text.toLowerCase() === '/confirm') {
        await this.handleConfirm(chatId);
        return;
      }

      // Handle /cancel
      if (text.toLowerCase() === '/cancel') {
        await this.handleCancel(chatId);
        return;
      }

      // Handle /help
      if (text.toLowerCase() === '/help') {
        await this.handleHelp(chatId);
        return;
      }

      // Handle slash commands
      if (text.startsWith('/')) {
        const match = text.match(/^\/(\S+)\s*(.*)/s);
        if (match) {
          const [, cmdName, args] = match;
          const command = this.commands.get(cmdName.toLowerCase());
          if (command) {
            await this.executeCommand(command, args, chatId, username);
            return;
          }
          // Unknown command — fall through to agentic conversation
        }
      }

      // Default: Agentic conversation with tool-use
      await this.handleConversation(chatId, text);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`OpenClaw error: ${errMsg}`);
      await this.sendMessage(chatId, `Error: ${errMsg.slice(0, 200)}`);
    }
  }

  private async executeCommand(
    command: OpenClawCommand,
    args: string,
    chatId: string,
    username: string,
  ): Promise<void> {
    // Check PM2 subcommands for danger
    if (command.name === 'pm2') {
      const action = args.trim().split(/\s+/)[0]?.toLowerCase() || '';
      const dangerousPm2 = ['restart', 'reload', 'stop'];
      if (dangerousPm2.includes(action)) {
        this.pending = { command, args, chatId, timestamp: Date.now() };
        await this.sendMessage(chatId,
          `*[${this.activeProject.name}] Dangerous:* \`/pm2 ${action}\` will affect ${this.activeProject.pm2Name}.\nSend /confirm to proceed or /cancel to abort.`
        );
        return;
      }
    }

    if (command.dangerous) {
      // Store pending and ask for confirmation
      this.pending = { command, args, chatId, timestamp: Date.now() };
      await this.sendMessage(chatId,
        `*[${this.activeProject.name}] Dangerous command:* \`/${command.name} ${args}\`\n${command.description}\n\nSend /confirm to proceed or /cancel to abort.`
      );
      return;
    }

    // Execute safe command directly
    const ctx = this.createContext(chatId);
    const result = await command.execute(args, ctx);

    // Handle project switch
    if (result.output.startsWith('__SWITCH_PROJECT__:')) {
      const projectId = result.output.split(':')[1];
      const project = PROJECTS[projectId];
      if (project) {
        this.activeProject = project;
        await this.sendMessage(chatId, `Switched to *${project.name}*\n\`${project.path}\` | PM2: \`${project.pm2Name}\`\nAll commands now target this project.`);
        this.auditTrail.record('openclaw', 'project_switch', chatId, { project: project.id });
      }
      return;
    }

    await this.sendMessage(chatId, result.output);
  }

  private async handleConfirm(chatId: string): Promise<void> {
    if (!this.pending) {
      await this.sendMessage(chatId, 'Nothing pending. Use a command first.');
      return;
    }

    // Expire after 5 minutes
    if (Date.now() - this.pending.timestamp > 5 * 60 * 1000) {
      this.pending = null;
      await this.sendMessage(chatId, 'Pending command expired. Please re-issue.');
      return;
    }

    const { command, args } = this.pending;
    this.pending = null;

    const ctx = this.createContext(chatId);
    this.logger.info(`OpenClaw confirmed: /${command.name} ${args.slice(0, 80)}`);
    this.auditTrail.record('openclaw', 'command_confirmed', chatId, { command: command.name, args: args.slice(0, 200), project: this.activeProject.id });

    const result = await command.execute(args, ctx);
    await this.sendMessage(chatId, result.output);
  }

  private async handleCancel(chatId: string): Promise<void> {
    if (!this.pending) {
      await this.sendMessage(chatId, 'Nothing to cancel.');
      return;
    }

    const cmdName = this.pending.command.name;
    this.pending = null;
    await this.sendMessage(chatId, `Cancelled \`/${cmdName}\`.`);
  }

  private async handleHelp(chatId: string): Promise<void> {
    const seen = new Set<string>();
    const lines: string[] = [];

    for (const [, cmd] of this.commands) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);

      const aliases = cmd.aliases.length > 0 ? ` (${cmd.aliases.map(a => `/${a}`).join(', ')})` : '';
      const danger = cmd.dangerous ? ' *DANGEROUS*' : '';
      lines.push(`\`${cmd.usage}\`${aliases}${danger}\n  ${cmd.description}`);
    }

    const output = `*OpenClaw Commands*\n*Active project:* ${this.activeProject.name}\n\n${lines.join('\n\n')}\n\n_Dangerous commands require /confirm_\n_Use /project to switch between projects_\n_Any non-command text goes to agentic AI chat (with tools)_`;
    await this.sendMessage(chatId, output);
  }

  // ── Agentic conversation with tool-use loop ─────────────────

  private async handleConversation(chatId: string, text: string): Promise<void> {
    this.history.push({ role: 'user', content: text });
    if (this.history.length > 40) this.history.splice(0, this.history.length - 40);

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.activeProject) },
      ...this.history,
    ];

    const MAX_ITERATIONS = 8;
    let toolsUsed = 0;

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.callKimi(messages);

      // If model wants to call tools
      if (response.finish_reason === 'tool_calls' && response.tool_calls?.length) {
        // Add assistant message with tool_calls
        messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.tool_calls,
        });

        // Execute each tool call and feed results back
        for (const toolCall of response.tool_calls) {
          const fnName = toolCall.function.name;
          const fnArgs = toolCall.function.arguments;
          this.logger.info(`OpenClaw tool call: ${fnName}(${fnArgs.slice(0, 100)})`);

          let result: string;
          try {
            result = await this.executeTool(fnName, fnArgs, chatId);
          } catch (err) {
            result = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          }

          // Truncate very large tool results to avoid token overflow
          if (result.length > 8000) {
            result = result.slice(0, 7900) + '\n\n... [truncated, too large]';
          }

          messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
          });
          toolsUsed++;
        }

        this.logger.info(`OpenClaw iteration ${i + 1}/${MAX_ITERATIONS} — ${response.tool_calls.length} tool(s) called`);
        continue; // Loop back to Kimi with tool results
      }

      // Final text response — send to Telegram
      const reply = response.content || 'No response.';
      this.history.push({ role: 'assistant', content: reply });

      this.logger.info(`OpenClaw responded — ${toolsUsed} tools used across ${i + 1} iteration(s)`);
      await this.sendMessage(chatId, reply);

      this.auditTrail.record('openclaw', 'agentic_conversation', `tg:${chatId}`, {
        input: text.slice(0, 200),
        toolsUsed,
        iterations: i + 1,
      });
      return;
    }

    // Max iterations reached — send whatever we have
    await this.sendMessage(chatId, 'Reached max reasoning iterations. Please try a simpler request.');
    this.logger.warn(`OpenClaw hit MAX_ITERATIONS (${MAX_ITERATIONS}) for: ${text.slice(0, 80)}`);
  }

  // ── Kimi K2.5 API call (OpenAI-compatible with tools) ──────

  private async callKimi(messages: ChatMessage[]): Promise<KimiResponse> {
    const res = await fetch(`${CONFIG.ollama.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.ollama.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.ollama.model,
        messages,
        tools: TOOLS,
        max_tokens: CONFIG.ollama.maxTokens,
        temperature: 0.4,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`OpenClaw Kimi error: ${res.status} ${errText.slice(0, 300)}`);
      throw new Error(`AI error (${res.status})`);
    }

    const data = await res.json() as {
      choices: Array<{
        message: { content: string | null; tool_calls?: ToolCall[] };
        finish_reason: string;
      }>;
      usage?: { total_tokens: number };
    };

    const choice = data.choices?.[0];
    if (!choice) throw new Error('No response from AI model');

    if (data.usage?.total_tokens) {
      this.logger.info(`OpenClaw tokens: ${data.usage.total_tokens}`);
    }

    return {
      content: choice.message?.content || null,
      finish_reason: choice.finish_reason || 'stop',
      tool_calls: choice.message?.tool_calls || undefined,
    };
  }

  // ── Tool execution router ──────────────────────────────────

  private async executeTool(name: string, argsJson: string, chatId: string): Promise<string> {
    let args: Record<string, unknown>;
    try {
      args = argsJson ? JSON.parse(argsJson) : {};
    } catch {
      return `Invalid tool arguments: ${argsJson.slice(0, 100)}`;
    }

    const ctx = this.createContext(chatId);

    switch (name) {
      // ── Blocked (dangerous) tools ──
      case 'shell':
        return 'BLOCKED: Shell commands require manual execution via `/shell <cmd>` then `/confirm` for safety. Tell the owner to use that flow.';

      case 'deploy':
        return 'BLOCKED: Deploy requires manual execution via `/deploy` then `/confirm` for safety. Tell the owner to use that flow.';

      case 'pm2': {
        const action = String(args.action || 'list');
        if (['restart', 'reload', 'stop', 'start'].includes(action)) {
          return `BLOCKED: \`/pm2 ${action}\` requires manual execution via \`/pm2 ${action}\` then \`/confirm\` for safety. Tell the owner to use that flow.`;
        }
        return (await pm2Command.execute(action, ctx)).output;
      }

      // ── Safe tools ──
      case 'health':
        return (await healthCommand.execute('', ctx)).output;

      case 'status':
        return (await statusCommand.execute('', ctx)).output;

      case 'admin':
        return (await adminCommand.execute(String(args.section || 'dashboard'), ctx)).output;

      case 'logs': {
        const lines = args.lines ? String(args.lines) : '30';
        const argStr = args.error_only ? `${lines} --error` : lines;
        return (await logsCommand.execute(argStr, ctx)).output;
      }

      case 'github':
        return (await githubCommand.execute(String(args.action || 'status'), ctx)).output;

      case 'file': {
        const path = String(args.path || '.');
        const lineArg = args.lines ? ` --lines ${args.lines}` : '';
        return (await fileCommand.execute(`${path}${lineArg}`, ctx)).output;
      }

      case 'env':
        return (await envCommand.execute(String(args.section || ''), ctx)).output;

      case 'project': {
        const result = await projectCommand.execute(String(args.name || ''), ctx);
        // Handle project switch in agentic mode
        if (result.output.startsWith('__SWITCH_PROJECT__:')) {
          const projectId = result.output.split(':')[1];
          const project = PROJECTS[projectId];
          if (project) {
            this.activeProject = project;
            return `Switched to ${project.name} (${project.path} | PM2: ${project.pm2Name}). All subsequent tool calls target this project.`;
          }
        }
        return result.output;
      }

      // ── Memory tools ──
      case 'memory_store': {
        const content = String(args.content || '');
        if (!content) return 'Error: content is required for memory_store';
        const id = await this.memoryHandle.store({
          agentId: 'openclaw',
          type: 'semantic',
          namespace: String(args.namespace || 'openclaw'),
          content,
          metadata: {},
          importance: Number(args.importance) || 0.5,
        });
        return `Stored to memory (id: ${id})`;
      }

      case 'memory_recall': {
        const query = String(args.query || '');
        if (!query) return 'Error: query is required for memory_recall';
        const memories = await this.memoryHandle.recall(query, String(args.namespace || 'openclaw'), 5);
        if (!memories.length) return 'No memories found matching that query.';
        return memories.map(m => `[${m.namespace}] ${m.content}`).join('\n');
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }

  // ── Shared helpers ─────────────────────────────────────────

  private createContext(chatId: string): CommandContext {
    return {
      chatId,
      username: 'owner',
      db: this.db,
      logger: this.logger,
      auditTrail: this.auditTrail,
      orchestrator: this.orchestrator,
      activeProject: this.activeProject,
      sendMessage: (text: string) => this.sendMessage(chatId, text),
    };
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    // Telegram max message = 4096 chars; split if needed
    if (text.length <= 4096) {
      await this.telegram.sendMessage(chatId, text);
    } else {
      const chunks = text.match(/[\s\S]{1,4000}/g) || [text];
      for (const chunk of chunks) {
        await this.telegram.sendMessage(chatId, chunk);
      }
    }
  }
}

// ── Types ────────────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ChatMessage {
  role: string;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface KimiResponse {
  content: string | null;
  finish_reason: string;
  tool_calls?: ToolCall[];
}
