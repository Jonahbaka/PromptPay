// ═══════════════════════════════════════════════════════════════
// OpenClaw :: /file — Read server files (whitelisted dirs only)
// Project-aware: uses active project context
// ═══════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import type { OpenClawCommand, CommandContext, CommandResult } from '../commands.js';

const BLOCKED_FILES = [
  '.env',
  '.pem',
  'credentials',
  'secret',
  'password',
  'token',
  'key.json',
  'id_rsa',
  'id_ed25519',
];

export const fileCommand: OpenClawCommand = {
  name: 'file',
  aliases: ['cat', 'read'],
  description: 'Read a server file (whitelisted directories only)',
  usage: '/file <path> [--lines N]',
  dangerous: false,

  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(/\s+/);
    let filePath = parts[0];
    const linesIdx = parts.indexOf('--lines');
    const maxLines = linesIdx !== -1 ? parseInt(parts[linesIdx + 1] || '100', 10) : 100;

    const project = ctx.activeProject;

    if (!filePath) {
      return { success: false, output: `Usage: /file <path> [--lines N]\n*Project:* ${project.name}\nAllowed dirs: ${project.allowedDirs.join(', ')}` };
    }

    // Resolve relative to active project root
    if (!filePath.startsWith('/')) {
      filePath = path.join(project.path, filePath);
    }

    // Normalize and check for path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(project.path)) {
      return { success: false, output: `Access denied: path outside ${project.name} directory.` };
    }

    // Check against allowed dirs
    const relative = path.relative(project.path, resolved);
    const inAllowedDir = project.allowedDirs.some(dir => relative.startsWith(dir)) ||
      project.rootFiles.includes(relative);

    if (!inAllowedDir) {
      return { success: false, output: `Access denied: \`${relative}\` not in allowed directories.\n*${project.name}* allowed: ${project.allowedDirs.join(', ')}` };
    }

    // Check blocked files
    const basename = path.basename(resolved).toLowerCase();
    if (BLOCKED_FILES.some(b => basename.includes(b))) {
      return { success: false, output: `Access denied: \`${basename}\` is a sensitive file.` };
    }

    try {
      const stat = fs.statSync(resolved);

      if (stat.isDirectory()) {
        const entries = fs.readdirSync(resolved);
        return {
          success: true,
          output: `*[${project.name}] ${relative}/*\n\`\`\`\n${entries.join('\n')}\n\`\`\``,
        };
      }

      if (stat.size > 512 * 1024) {
        return { success: false, output: `File too large: ${(stat.size / 1024).toFixed(0)}KB (max 512KB)` };
      }

      const content = fs.readFileSync(resolved, 'utf-8');
      const lines = content.split('\n');
      const truncated = lines.length > maxLines;
      const shown = lines.slice(0, maxLines).join('\n');
      const ext = path.extname(resolved).slice(1) || '';

      return {
        success: true,
        output: `*[${project.name}] ${relative}* (${lines.length} lines, ${(stat.size / 1024).toFixed(1)}KB)\n\`\`\`${ext}\n${shown.slice(0, 3500)}\n\`\`\`${truncated ? `\n(showing first ${maxLines} of ${lines.length} lines)` : ''}`,
      };
    } catch (err) {
      return { success: false, output: `Error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
