// ═══════════════════════════════════════════════════════════════
// OpenClaw :: Command Interface
// Typed command system for the owner's autonomous agent
// ═══════════════════════════════════════════════════════════════

import type Database from 'better-sqlite3';
import type { LoggerHandle } from '../../core/types.js';
import type { AuditTrail } from '../../protocols/audit-trail.js';
import type { Orchestrator } from '../../core/orchestrator.js';

export interface CommandContext {
  chatId: string;
  username: string;
  db: Database.Database;
  logger: LoggerHandle;
  auditTrail: AuditTrail;
  orchestrator: Orchestrator;
  sendMessage: (text: string) => Promise<void>;
}

export interface CommandResult {
  success: boolean;
  output: string;
}

export interface OpenClawCommand {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
  dangerous: boolean;
  execute(args: string, ctx: CommandContext): Promise<CommandResult>;
}
