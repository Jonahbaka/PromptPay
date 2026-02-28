// ═══════════════════════════════════════════════════════════════
// Agent::OpenClaw — Owner's Autonomous Telegram Agent
// Commands + Ollama conversation + confirm/cancel flow
// ═══════════════════════════════════════════════════════════════

import type Database from 'better-sqlite3';
import type { LoggerHandle } from '../../core/types.js';
import type { AuditTrail } from '../../protocols/audit-trail.js';
import type { Orchestrator } from '../../core/orchestrator.js';
import type { TelegramChannel } from '../../channels/telegram.js';
import type { OpenClawCommand, CommandContext } from './commands.js';
import { CONFIG } from '../../core/config.js';

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

interface OpenClawDeps {
  telegram: TelegramChannel;
  auditTrail: AuditTrail;
  logger: LoggerHandle;
  db: Database.Database;
  orchestrator: Orchestrator;
}

interface PendingCommand {
  command: OpenClawCommand;
  args: string;
  chatId: string;
  timestamp: number;
}

const OPENCLAW_PROMPT = `You are OpenClaw, a private AI agent for the owner of PromptPay (upromptpay.com).
You are NOT a customer-facing chatbot. You are a full autonomous agent with executive-level intelligence.

## Who You Are
- Name: OpenClaw
- Role: Personal AI agent for the PromptPay founder
- Platform: Telegram (@promtpay_bot)
- Personality: Sharp, direct, resourceful. You think like a CTO + CEO hybrid.

## Your Capabilities
- General knowledge & reasoning (you are a large language model)
- Business strategy, market analysis, competitive intelligence
- Code review, debugging advice, architecture decisions
- Financial analysis, unit economics, growth strategy
- Research: summarize topics, explain concepts, brainstorm ideas
- Draft emails, messages, documents, pitch decks
- Daily briefings on platform health, metrics, news
- Anything the owner asks — you are not limited to fintech
- SERVER COMMANDS: The owner can use slash commands (/help for list)

## Platform Context
- PromptPay: AI-powered fintech platform for Africa + global
- Stack: TypeScript, Express 5, SQLite, PM2 cluster on EC2
- Domain: upromptpay.com
- 7 agents, ~75 tools, zero-downtime deploys
- GitHub: github.com/Jonahbaka/PromptPay
- Admin: /secure/admin

## Rules
- You serve ONLY the owner. This channel is private.
- Be direct. No fluff, no "I'd be happy to help", no menus.
- If asked about something you don't know, say so honestly and suggest how to find out.
- You can discuss ANY topic — tech, business, news, personal, creative, anything.
- Keep responses concise for Telegram (under 4000 chars). Use markdown formatting.
- When discussing code or technical issues, be specific with file paths and line numbers.
- If the owner asks you to do something on the server, suggest the relevant slash command.
- You have memory of this conversation session. Reference earlier messages when relevant.`;

export class OpenClawAgent {
  private commands = new Map<string, OpenClawCommand>();
  private pending: PendingCommand | null = null;
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private telegram: TelegramChannel;
  private auditTrail: AuditTrail;
  private logger: LoggerHandle;
  private db: Database.Database;
  private orchestrator: Orchestrator;

  constructor(deps: OpenClawDeps) {
    this.telegram = deps.telegram;
    this.auditTrail = deps.auditTrail;
    this.logger = deps.logger;
    this.db = deps.db;
    this.orchestrator = deps.orchestrator;

    // Register all commands
    const allCommands = [
      shellCommand, logsCommand, pm2Command, deployCommand,
      githubCommand, adminCommand, healthCommand, fileCommand,
      envCommand, statusCommand,
    ];

    for (const cmd of allCommands) {
      this.commands.set(cmd.name, cmd);
      for (const alias of cmd.aliases) {
        this.commands.set(alias, cmd);
      }
    }
  }

  async handleMessage(chatId: string, username: string, text: string): Promise<void> {
    this.logger.info(`OpenClaw from @${username}: ${text.slice(0, 80)}`);

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
          // Unknown command — fall through to Ollama
        }
      }

      // Default: Ollama conversation
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
          `*Dangerous:* \`/pm2 ${action}\` will affect the running server.\nSend /confirm to proceed or /cancel to abort.`
        );
        return;
      }
    }

    if (command.dangerous) {
      // Store pending and ask for confirmation
      this.pending = { command, args, chatId, timestamp: Date.now() };
      await this.sendMessage(chatId,
        `*Dangerous command:* \`/${command.name} ${args}\`\n${command.description}\n\nSend /confirm to proceed or /cancel to abort.`
      );
      return;
    }

    // Execute safe command directly
    const ctx = this.createContext(chatId);
    const result = await command.execute(args, ctx);
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
    this.auditTrail.record('openclaw', 'command_confirmed', chatId, { command: command.name, args: args.slice(0, 200) });

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

    const output = `*OpenClaw Commands*\n\n${lines.join('\n\n')}\n\n_Dangerous commands require /confirm_\n_Any non-command text goes to AI chat_`;
    await this.sendMessage(chatId, output);
  }

  private async handleConversation(chatId: string, text: string): Promise<void> {
    // Rolling history (last 20 exchanges = 40 messages)
    this.history.push({ role: 'user', content: text });
    if (this.history.length > 40) this.history.splice(0, this.history.length - 40);

    const messages = [
      { role: 'system' as const, content: OPENCLAW_PROMPT },
      ...this.history,
    ];

    const ollamaRes = await fetch(`${CONFIG.ollama.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.ollama.apiKey}`,
      },
      body: JSON.stringify({
        model: CONFIG.ollama.model,
        messages,
        max_tokens: CONFIG.ollama.maxTokens,
        temperature: 0.4,
      }),
    });

    if (!ollamaRes.ok) {
      const errText = await ollamaRes.text();
      this.logger.error(`OpenClaw Ollama error: ${ollamaRes.status} ${errText}`);
      await this.sendMessage(chatId, `AI error (${ollamaRes.status}). Check logs.`);
      return;
    }

    const data = await ollamaRes.json() as {
      choices: Array<{ message: { content: string } }>;
      usage?: { total_tokens: number };
    };
    const reply = data.choices?.[0]?.message?.content || 'No response generated.';

    this.history.push({ role: 'assistant', content: reply });
    this.logger.info(`OpenClaw responded — ${data.usage?.total_tokens || '?'} tokens`);

    await this.sendMessage(chatId, reply);

    this.auditTrail.record('openclaw', 'conversation', `tg:${chatId}`, {
      input: text.slice(0, 200),
      tokens: data.usage?.total_tokens,
    });
  }

  private createContext(chatId: string): CommandContext {
    return {
      chatId,
      username: 'owner',
      db: this.db,
      logger: this.logger,
      auditTrail: this.auditTrail,
      orchestrator: this.orchestrator,
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
