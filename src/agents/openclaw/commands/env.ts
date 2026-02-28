// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /env — Show config with secrets masked
// ═══════════════════════════════════════════════════════════════

import { CONFIG } from '../../../core/config.js';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

const SECRET_KEYS = [
  'key', 'secret', 'token', 'password', 'apikey', 'api_key',
  'bottoken', 'private', 'credential', 'jwt',
];

function maskValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '(not set)';
  const str = String(value);
  const keyLower = key.toLowerCase().replace(/[_-]/g, '');

  if (SECRET_KEYS.some(s => keyLower.includes(s))) {
    if (str.length <= 8) return '****';
    return str.slice(0, 4) + '****' + str.slice(-2);
  }

  return str;
}

function flattenConfig(obj: Record<string, unknown>, prefix = ''): Array<[string, string]> {
  const entries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      entries.push(...flattenConfig(value as Record<string, unknown>, fullKey));
    } else {
      entries.push([fullKey, maskValue(key, value)]);
    }
  }

  return entries;
}

export const envCommand: OpenClawCommand = {
  name: 'env',
  aliases: ['config'],
  description: 'Show config with secrets masked',
  usage: '/env [section]',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const section = args.trim().toLowerCase();

    const configObj = CONFIG as unknown as Record<string, unknown>;

    if (section && section in configObj) {
      const sectionData = configObj[section];
      if (sectionData && typeof sectionData === 'object') {
        const entries = flattenConfig(sectionData as Record<string, unknown>, section);
        const lines = entries.map(([k, v]) => `${k}: ${v}`);
        return {
          success: true,
          output: `*Config — ${section}:*\n\`\`\`\n${lines.join('\n').slice(0, 3500)}\n\`\`\``,
        };
      }
    }

    if (section && !(section in configObj)) {
      const available = Object.keys(configObj).join(', ');
      return { success: false, output: `Unknown section: ${section}\nAvailable: ${available}` };
    }

    // Show top-level sections
    const sections = Object.keys(configObj);
    const summary = sections.map(s => {
      const val = configObj[s];
      const count = val && typeof val === 'object' ? Object.keys(val).length : 1;
      return `${s} (${count} keys)`;
    });

    return {
      success: true,
      output: `*Config Sections:*\n\`\`\`\n${summary.join('\n')}\n\`\`\`\nUse \`/env <section>\` for details.`,
    };
  },
};
