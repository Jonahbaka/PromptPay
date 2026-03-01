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
import { webFetchCommand, webSearchCommand, youtubeCommand, newsCommand } from './commands/web.js';
import { apiCallCommand, currencyCommand, cryptoCommand, weatherCommand, whoisCommand, rssCommand, codeExecCommand, downloadCommand, pingCommand } from './commands/intelligence.js';

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
  // ── Server & Infrastructure ──
  { type: 'function', function: { name: 'health', description: 'System health: CPU, memory, disk, uptime, Node.js info', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'status', description: 'Full platform dashboard: system, PM2, app config, DB stats, revenue, engagement', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'admin', description: 'Query database: dashboard, users, revenue, audit trail, hooks, agents', parameters: { type: 'object', properties: { section: { type: 'string', description: 'Section to query', enum: ['dashboard', 'users', 'revenue', 'audit', 'hooks', 'agents'] } }, required: ['section'] } } },
  { type: 'function', function: { name: 'logs', description: 'Read PM2 log lines for the active project', parameters: { type: 'object', properties: { lines: { type: 'number', description: 'Lines to read (default 30, max 200)' }, error_only: { type: 'boolean', description: 'Error logs only' } } } } },
  { type: 'function', function: { name: 'github', description: 'GitHub: commits, status, diff, branch, log, issues, prs, actions', parameters: { type: 'object', properties: { action: { type: 'string', description: 'GitHub action', enum: ['commits', 'status', 'diff', 'branch', 'log', 'issues', 'prs', 'actions'] } }, required: ['action'] } } },
  { type: 'function', function: { name: 'file', description: 'Read a file or directory on the server (whitelisted paths, no secrets)', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Path relative to project root' }, lines: { type: 'number', description: 'Max lines (default 100)' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'env', description: 'Show app config with secrets masked. Drill into a section optionally.', parameters: { type: 'object', properties: { section: { type: 'string', description: 'Config section (ollama, stripe, telegram, etc.)' } } } } },
  { type: 'function', function: { name: 'pm2', description: 'PM2 management. list/status/describe safe. restart/reload/stop BLOCKED.', parameters: { type: 'object', properties: { action: { type: 'string', description: 'PM2 action', enum: ['list', 'status', 'monit', 'describe', 'restart', 'reload', 'stop', 'start'] } }, required: ['action'] } } },
  { type: 'function', function: { name: 'shell', description: 'Execute a safe shell command (curl, ls, grep, npm, node, cat, etc.). Destructive commands are blocked.', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Shell command to run' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'deploy', description: 'Trigger deployment. BLOCKED — tell owner to use /deploy + /confirm.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'project', description: 'Switch active project (promptpay or doctarx)', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Project: promptpay, pp, doctarx, dx' } }, required: ['name'] } } },

  // ── Internet & Web Access ──
  { type: 'function', function: { name: 'web_fetch', description: 'Browse any URL — fetches the page and returns readable text content. Works with any website.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full URL to fetch (https://...)' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'web_search', description: 'Search the internet via DuckDuckGo. Returns titles, URLs, and snippets.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'youtube', description: 'Analyze a YouTube video: title, channel, views, duration, description, and full transcript/captions.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'YouTube URL or video ID' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'news', description: 'Get latest news headlines on any topic from the web', parameters: { type: 'object', properties: { topic: { type: 'string', description: 'News topic to search' } }, required: ['topic'] } } },
  { type: 'function', function: { name: 'rss', description: 'Read and parse RSS/Atom feeds from any source (blogs, news, podcasts)', parameters: { type: 'object', properties: { url: { type: 'string', description: 'RSS feed URL' } }, required: ['url'] } } },

  // ── Intelligence & Data ──
  { type: 'function', function: { name: 'api_call', description: 'Call ANY REST API (GET/POST/PUT/DELETE) with custom headers and JSON body. Universal HTTP client.', parameters: { type: 'object', properties: { method: { type: 'string', description: 'HTTP method', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] }, url: { type: 'string', description: 'API endpoint URL' }, body: { type: 'string', description: 'JSON request body (for POST/PUT/PATCH)' } }, required: ['method', 'url'] } } },
  { type: 'function', function: { name: 'currency', description: 'Real-time currency exchange rates. 150+ currencies. Convert amounts.', parameters: { type: 'object', properties: { amount: { type: 'number', description: 'Amount to convert (default 1)' }, from: { type: 'string', description: 'Source currency code (USD, NGN, EUR, etc.)' }, to: { type: 'string', description: 'Target currency code. Omit to show all rates.' } }, required: ['from'] } } },
  { type: 'function', function: { name: 'crypto', description: 'Real-time cryptocurrency prices, market cap, 24h/7d change via CoinGecko', parameters: { type: 'object', properties: { coin: { type: 'string', description: 'Coin name or symbol (bitcoin, eth, solana, etc.)' } }, required: ['coin'] } } },
  { type: 'function', function: { name: 'weather', description: 'Current weather and 3-day forecast for any city worldwide', parameters: { type: 'object', properties: { city: { type: 'string', description: 'City name (Lagos, Nairobi, New York, etc.)' } }, required: ['city'] } } },
  { type: 'function', function: { name: 'whois', description: 'Domain lookup: DNS records (A, MX, NS, TXT), SSL certificate, WHOIS registration', parameters: { type: 'object', properties: { domain: { type: 'string', description: 'Domain name (e.g. upromptpay.com)' } }, required: ['domain'] } } },
  { type: 'function', function: { name: 'ping', description: 'Network connectivity check: ping, HTTP response time, port check', parameters: { type: 'object', properties: { host: { type: 'string', description: 'Hostname or IP to check' } }, required: ['host'] } } },

  // ── Code & Compute ──
  { type: 'function', function: { name: 'code', description: 'Execute Node.js code on the server. Has access to fetch, fs, path, crypto, child_process. Returns stdout.', parameters: { type: 'object', properties: { code: { type: 'string', description: 'JavaScript/Node.js code to execute' } }, required: ['code'] } } },
  { type: 'function', function: { name: 'download', description: 'Download a file from any URL to the server (max 50MB)', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL to download' }, filename: { type: 'string', description: 'Save as filename (optional)' } }, required: ['url'] } } },

  // ── Memory ──
  { type: 'function', function: { name: 'memory_store', description: 'Store important information to persistent memory (survives restarts)', parameters: { type: 'object', properties: { content: { type: 'string', description: 'Information to remember' }, namespace: { type: 'string', description: 'Category (default: openclaw)' }, importance: { type: 'number', description: '0.0-1.0 (default: 0.5)' } }, required: ['content'] } } },
  { type: 'function', function: { name: 'memory_recall', description: 'Recall information from persistent memory by search', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, namespace: { type: 'string', description: 'Filter by namespace' } }, required: ['query'] } } },
];

// ── System prompt (agentic, tool-aware) ───────────────────────

function buildSystemPrompt(project: Project): string {
  return `You are OpenClaw, a fully autonomous AI agent for the owner of PromptPay and DoctaRx.
You have 25+ tools. You can access the internet, browse websites, search the web, analyze YouTube videos, call APIs, execute code, and manage servers. You are NOT limited — USE YOUR TOOLS.

## Tools — Server & Infrastructure
- **health** — CPU, RAM, disk, uptime
- **status** — full platform dashboard
- **admin** — DB queries: users, revenue, audit, engagement
- **logs** — PM2 application logs (with error filtering)
- **github** — commits, diff, branches, issues, PRs, CI/CD
- **file** — read server files | **env** — config (secrets masked)
- **pm2** — process list/status (restart/reload/stop need manual /confirm)
- **shell** — run safe shell commands (curl, ls, grep, npm, node, cat, etc.)
- **project** — switch between PromptPay and DoctaRx

## Tools — Internet & Web
- **web_search** — search the internet (DuckDuckGo), get results with links
- **web_fetch** — browse ANY URL, read full page content as text
- **youtube** — analyze videos: title, channel, views, description + full transcript
- **news** — latest headlines on any topic
- **rss** — read RSS/Atom feeds (blogs, news, podcasts)

## Tools — Intelligence & Data
- **api_call** — call ANY REST API (GET/POST/PUT/DELETE) with custom body
- **currency** — real-time FX rates, 150+ currencies, convert amounts
- **crypto** — live crypto prices, market cap, 24h change (CoinGecko)
- **weather** — current weather + 3-day forecast for any city
- **whois** — domain DNS records, SSL cert, WHOIS registration
- **ping** — network connectivity check (ping + HTTP timing)

## Tools — Code & Compute
- **code** — execute Node.js code on the server (full access to fetch, fs, crypto)
- **download** — download files from any URL to the server

## Tools — Memory
- **memory_store** — persist facts across restarts
- **memory_recall** — search stored memories

## How to Be Resourceful
- To research anything: web_search → web_fetch the top results → synthesize
- To monitor competitors: web_fetch their websites, track changes with memory
- To analyze a YouTube video: youtube tool gets transcript, then you summarize/analyze
- To check any API: api_call with GET/POST
- To install an npm package: shell with "npm install <pkg>"
- To run complex logic: code tool executes Node.js with full stdlib
- To get real-time data (stocks, weather, FX): use the dedicated tools or api_call
- Chain multiple tools in sequence for complex research tasks

## Dangerous Operations (Need Manual /confirm)
- **deploy** — tell owner to use /deploy + /confirm
- **pm2 restart/reload/stop** — tell owner to use /pm2 <action> + /confirm

## Active: ${project.name}
Path: \`${project.path}\` | PM2: \`${project.pm2Name}\` | Stack: ${project.stack}

## Rules
- You serve ONLY the owner. Be direct, no fluff.
- Under 4000 chars for Telegram. Use markdown.
- ALWAYS use tools instead of saying "I can't access that" — you CAN.
- **Be efficient with tools.** Use 1-3 tool calls max, then RESPOND with a synthesized answer. Do NOT keep calling more tools endlessly. One web_search + one web_fetch is usually enough for research. Get the data, then answer.
- After calling tools, ALWAYS produce a final text response. Do not call more tools unless the previous results were genuinely insufficient.
- Store important findings to memory for future reference.`;
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
      webFetchCommand, webSearchCommand, youtubeCommand, newsCommand,
      apiCallCommand, currencyCommand, cryptoCommand, weatherCommand,
      whoisCommand, rssCommand, codeExecCommand, downloadCommand, pingCommand,
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

    // Max iterations reached — force a final response WITHOUT tools
    this.logger.warn(`OpenClaw hit MAX_ITERATIONS (${MAX_ITERATIONS}), forcing final response for: ${text.slice(0, 80)}`);
    try {
      messages.push({
        role: 'user',
        content: 'You have gathered enough information. Now synthesize everything and give me a final, concise answer. Do NOT call any more tools.',
      });
      const finalRes = await this.callKimiNoTools(messages);
      const reply = finalRes || 'Could not generate a response. Try a simpler request.';
      this.history.push({ role: 'assistant', content: reply });
      await this.sendMessage(chatId, reply);

      this.auditTrail.record('openclaw', 'agentic_conversation', `tg:${chatId}`, {
        input: text.slice(0, 200),
        toolsUsed,
        iterations: MAX_ITERATIONS,
        forced: true,
      });
    } catch (err) {
      this.logger.error(`OpenClaw forced response failed: ${err instanceof Error ? err.message : err}`);
      await this.sendMessage(chatId, 'Reached max reasoning iterations. Please try a simpler request.');
    }
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

  // ── Kimi call WITHOUT tools (forces text response) ─────────

  private async callKimiNoTools(messages: ChatMessage[]): Promise<string> {
    // Strip tool_calls from messages to avoid confusing the model
    const cleanMessages = messages.map(m => {
      if (m.tool_calls) {
        return { role: m.role, content: m.content || '(used tools)' };
      }
      if (m.tool_call_id) {
        return { role: 'user' as const, content: `[Tool result]: ${m.content?.slice(0, 2000) || ''}` };
      }
      return { role: m.role, content: m.content };
    });

    const res = await fetch(`${CONFIG.ollama.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.ollama.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.ollama.model,
        messages: cleanMessages,
        max_tokens: CONFIG.ollama.maxTokens,
        temperature: 0.4,
        // NO tools — forces text response
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`OpenClaw Kimi (no-tools) error: ${res.status} ${errText.slice(0, 300)}`);
      throw new Error(`AI error (${res.status})`);
    }

    const data = await res.json() as {
      choices: Array<{ message: { content: string | null } }>;
    };

    return data.choices?.[0]?.message?.content || '';
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
      case 'deploy':
        return 'BLOCKED: Deploy requires manual /deploy + /confirm.';

      case 'pm2': {
        const action = String(args.action || 'list');
        if (['restart', 'reload', 'stop', 'start'].includes(action)) {
          return `BLOCKED: /pm2 ${action} requires manual /pm2 ${action} + /confirm.`;
        }
        return (await pm2Command.execute(action, ctx)).output;
      }

      // ── Shell (safe commands allowed, destructive blocked) ──
      case 'shell': {
        const cmd = String(args.command || '');
        if (!cmd) return 'Error: command is required';
        // Allow safe commands, block destructive ones
        const destructive = /^\s*(rm|rmdir|mv|cp\s.*\/|chmod|chown|kill|pkill|shutdown|reboot|systemctl|mkfs|dd\s|fdisk|mount|umount|userdel|useradd|passwd|iptables|nft\s)/i;
        if (destructive.test(cmd)) {
          return `BLOCKED: "${cmd.split(/\s+/)[0]}" is destructive. Use /shell + /confirm for manual execution.`;
        }
        return (await shellCommand.execute(cmd, ctx)).output;
      }

      // ── Server & Infrastructure ──
      case 'health': return (await healthCommand.execute('', ctx)).output;
      case 'status': return (await statusCommand.execute('', ctx)).output;
      case 'admin': return (await adminCommand.execute(String(args.section || 'dashboard'), ctx)).output;
      case 'logs': {
        const lines = args.lines ? String(args.lines) : '30';
        return (await logsCommand.execute(args.error_only ? `${lines} --error` : lines, ctx)).output;
      }
      case 'github': return (await githubCommand.execute(String(args.action || 'status'), ctx)).output;
      case 'file': {
        const path = String(args.path || '.');
        return (await fileCommand.execute(`${path}${args.lines ? ` --lines ${args.lines}` : ''}`, ctx)).output;
      }
      case 'env': return (await envCommand.execute(String(args.section || ''), ctx)).output;
      case 'project': {
        const result = await projectCommand.execute(String(args.name || ''), ctx);
        if (result.output.startsWith('__SWITCH_PROJECT__:')) {
          const projectId = result.output.split(':')[1];
          const project = PROJECTS[projectId];
          if (project) {
            this.activeProject = project;
            return `Switched to ${project.name} (${project.path} | PM2: ${project.pm2Name}).`;
          }
        }
        return result.output;
      }

      // ── Internet & Web ──
      case 'web_fetch': return (await webFetchCommand.execute(String(args.url || ''), ctx)).output;
      case 'web_search': return (await webSearchCommand.execute(String(args.query || ''), ctx)).output;
      case 'youtube': return (await youtubeCommand.execute(String(args.url || ''), ctx)).output;
      case 'news': return (await newsCommand.execute(String(args.topic || ''), ctx)).output;
      case 'rss': return (await rssCommand.execute(String(args.url || ''), ctx)).output;

      // ── Intelligence & Data ──
      case 'api_call': {
        const method = String(args.method || 'GET');
        const url = String(args.url || '');
        const body = args.body ? ` ${String(args.body)}` : '';
        return (await apiCallCommand.execute(`${method} ${url}${body}`, ctx)).output;
      }
      case 'currency': {
        const amt = args.amount ? `${args.amount} ` : '';
        const from = String(args.from || 'USD');
        const to = args.to ? ` ${String(args.to)}` : '';
        return (await currencyCommand.execute(`${amt}${from}${to}`, ctx)).output;
      }
      case 'crypto': return (await cryptoCommand.execute(String(args.coin || ''), ctx)).output;
      case 'weather': return (await weatherCommand.execute(String(args.city || ''), ctx)).output;
      case 'whois': return (await whoisCommand.execute(String(args.domain || ''), ctx)).output;
      case 'ping': return (await pingCommand.execute(String(args.host || ''), ctx)).output;

      // ── Code & Compute ──
      case 'code': return (await codeExecCommand.execute(String(args.code || ''), ctx)).output;
      case 'download': {
        const url = String(args.url || '');
        const fname = args.filename ? ` ${String(args.filename)}` : '';
        return (await downloadCommand.execute(`${url}${fname}`, ctx)).output;
      }

      // ── Memory ──
      case 'memory_store': {
        const content = String(args.content || '');
        if (!content) return 'Error: content is required';
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
        if (!query) return 'Error: query is required';
        const memories = await this.memoryHandle.recall(query, String(args.namespace || 'openclaw'), 5);
        if (!memories.length) return 'No memories found.';
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
