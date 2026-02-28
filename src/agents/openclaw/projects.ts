// ═══════════════════════════════════════════════════════════════
// OpenClaw :: Project Registry
// Multi-project management — manage all projects from Telegram
// ═══════════════════════════════════════════════════════════════

export interface Project {
  id: string;
  name: string;
  description: string;
  path: string;
  pm2Name: string;
  repo: string;
  stack: string;
  deployScript: string | null;
  allowedDirs: string[];
  rootFiles: string[];
}

export const PROJECTS: Record<string, Project> = {
  promptpay: {
    id: 'promptpay',
    name: 'PromptPay',
    description: 'AI-powered fintech platform for Africa + global',
    path: '/home/ec2-user/PromptPay',
    pm2Name: 'upromptpay',
    repo: 'Jonahbaka/PromptPay',
    stack: 'TypeScript, Express 5, SQLite, PM2 cluster',
    deployScript: '/home/ec2-user/PromptPay/scripts/deploy.sh',
    allowedDirs: ['src/', 'config/', 'logs/', 'public/', 'scripts/', 'dist/', 'data/'],
    rootFiles: ['package.json', 'tsconfig.json', 'ecosystem.config.cjs', '.gitignore'],
  },
  doctarx: {
    id: 'doctarx',
    name: 'DoctaRx',
    description: 'HIPAA-compliant telehealth platform',
    path: '/home/ec2-user/zuma-teledoc',
    pm2Name: 'doctarx',
    repo: 'Jonahbaka/zuma-teledoc',
    stack: 'Next.js 15, Express 4, PostgreSQL, Redis, Socket.io',
    deployScript: '/home/ec2-user/zuma-teledoc/deploy.sh',
    allowedDirs: ['app/', 'server/', 'components/', 'lib/', 'config/', 'public/', 'scripts/', 'accelerators/', 'cronops/'],
    rootFiles: ['package.json', 'next.config.js', 'jsconfig.json', 'tailwind.config.js', '.gitignore', 'Dockerfile'],
  },
};

// Aliases for quick access
export const PROJECT_ALIASES: Record<string, string> = {
  pp: 'promptpay',
  promptpay: 'promptpay',
  upromptpay: 'promptpay',
  dx: 'doctarx',
  doctarx: 'doctarx',
  teledoc: 'doctarx',
  zuma: 'doctarx',
};

export function resolveProject(name: string): Project | null {
  const key = PROJECT_ALIASES[name.toLowerCase()];
  return key ? PROJECTS[key] : null;
}

export function getProjectList(): string {
  return Object.values(PROJECTS)
    .map(p => `*${p.name}* (\`${p.id}\`) — ${p.description}\n  Path: \`${p.path}\` | PM2: \`${p.pm2Name}\`\n  Stack: ${p.stack}`)
    .join('\n\n');
}
