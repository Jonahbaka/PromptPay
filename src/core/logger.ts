// ═══════════════════════════════════════════════════════════════
// PromptPay :: Logger
// Structured logging with file rotation
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { LoggerHandle } from './types.js';
import { CONFIG } from './config.js';

const LEVEL_MAP: Record<string, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function createLogger(name: string): LoggerHandle {
  const logDir = CONFIG.logging.dir;
  const minLevel = LEVEL_MAP[CONFIG.logging.level] ?? 1;

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFile = path.join(logDir, `${name}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });

  function write(level: string, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_MAP[level] < minLevel) return;

    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${name}] ${msg}${metaStr}\n`;

    stream.write(line);

    const colors: Record<string, string> = {
      debug: '\x1b[90m',
      info: '\x1b[36m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
    };
    const reset = '\x1b[0m';
    process.stdout.write(`${colors[level] || ''}${line}${reset}`);
  }

  return {
    debug: (msg, meta) => write('debug', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    error: (msg, meta) => write('error', msg, meta),
  };
}
