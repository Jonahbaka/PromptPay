// ═══════════════════════════════════════════════════════════════
// PromptPay :: RBAC Permissions
// Permission catalog, resolution, and checking utilities
// ═══════════════════════════════════════════════════════════════

import type Database from 'better-sqlite3';

export interface PermissionDefinition {
  key: string;
  description: string;
  category: string;
}

export const PERMISSIONS: PermissionDefinition[] = [
  // Admin
  { key: 'admin.dashboard.view', description: 'View admin dashboard', category: 'admin' },
  { key: 'admin.config.manage', description: 'Manage platform configuration', category: 'admin' },
  { key: 'admin.users.view', description: 'View user list', category: 'admin' },
  { key: 'admin.users.manage', description: 'Manage users (suspend, activate)', category: 'admin' },
  { key: 'admin.roles.manage', description: 'Create, edit, and delete roles', category: 'admin' },
  { key: 'admin.agents.view', description: 'View agent network', category: 'admin' },
  { key: 'admin.agents.manage', description: 'Manage agent accounts', category: 'admin' },
  { key: 'admin.tasks.view', description: 'View task queue', category: 'admin' },
  { key: 'admin.tasks.manage', description: 'Execute and manage tasks', category: 'admin' },
  { key: 'admin.audit.view', description: 'View audit trail', category: 'admin' },
  { key: 'admin.health.view', description: 'View system health and circuit breakers', category: 'admin' },
  { key: 'admin.hooks.view', description: 'View hook stats', category: 'admin' },
  { key: 'admin.hooks.manage', description: 'Manage hooks and engagement modules', category: 'admin' },
  { key: 'admin.providers.view', description: 'View payment providers', category: 'admin' },
  { key: 'admin.providers.manage', description: 'Manage payment providers', category: 'admin' },
  { key: 'admin.revenue.view', description: 'View revenue and fee data', category: 'admin' },
  { key: 'admin.tools.view', description: 'View tool invocations and health', category: 'admin' },
  { key: 'admin.executive.query', description: 'Query executive AI personas', category: 'admin' },
  { key: 'admin.rewards.manage', description: 'Manage rewards and loyalty', category: 'admin' },
  { key: 'admin.pos.manage', description: 'Manage POS settings', category: 'admin' },

  // Chat
  { key: 'chat.send', description: 'Send chat messages', category: 'chat' },

  // Wallet
  { key: 'wallet.view', description: 'View wallet balance and transactions', category: 'wallet' },
  { key: 'wallet.transfer', description: 'Transfer funds', category: 'wallet' },
  { key: 'wallet.topup', description: 'Top up wallet', category: 'wallet' },
  { key: 'wallet.withdraw', description: 'Withdraw funds', category: 'wallet' },

  // Payments
  { key: 'payments.execute', description: 'Execute payments', category: 'payments' },
  { key: 'payments.view', description: 'View payment history', category: 'payments' },

  // Profile
  { key: 'profile.view', description: 'View own profile', category: 'profile' },
  { key: 'profile.edit', description: 'Edit own profile', category: 'profile' },

  // Agents (agentic features)
  { key: 'shopping.use', description: 'Use shopping agent (Aria)', category: 'agents' },
  { key: 'assistant.use', description: 'Use assistant agent (Otto)', category: 'agents' },

  // Partner management
  { key: 'partner.manage', description: 'Manage partner tenants', category: 'partner' },

  // HR
  { key: 'hr.view', description: 'View HR data and applications', category: 'hr' },
  { key: 'hr.manage', description: 'Manage job postings and candidates', category: 'hr' },

  // POS
  { key: 'pos.view', description: 'View POS data', category: 'pos' },
  { key: 'pos.manage', description: 'Manage POS merchants and transactions', category: 'pos' },
];

/** All permission keys for quick lookup */
export const PERMISSION_KEYS = new Set(PERMISSIONS.map(p => p.key));

/**
 * Check if a permission set includes the required permission.
 * Supports wildcards: '*' matches everything, 'admin.*' matches 'admin.dashboard.view', etc.
 */
export function hasPermission(userPermissions: string[], required: string): boolean {
  for (const perm of userPermissions) {
    if (perm === '*') return true;
    if (perm === required) return true;
    // Wildcard: 'admin.*' matches 'admin.dashboard.view'
    if (perm.endsWith('.*')) {
      const prefix = perm.slice(0, -1); // 'admin.'
      if (required.startsWith(prefix)) return true;
    }
  }
  return false;
}

/** Check if a permission set includes ANY of the required permissions (OR) */
export function hasAnyPermission(userPermissions: string[], required: string[]): boolean {
  return required.some(r => hasPermission(userPermissions, r));
}

/**
 * Resolve all permissions for a user by querying user_roles + roles + role_permissions.
 * Owner always gets ['*'].
 */
export function resolveUserPermissions(db: Database.Database, userId: string): string[] {
  // Check if user is owner
  const user = db.prepare('SELECT role FROM users WHERE id = ?').get(userId) as { role: string } | undefined;
  if (!user) return [];
  if (user.role === 'owner') return ['*'];

  // Get permissions from all assigned roles via user_roles
  const rows = db.prepare(`
    SELECT DISTINCT rp.permission
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    WHERE ur.user_id = ?
  `).all(userId) as Array<{ permission: string }>;

  const permissions = rows.map(r => r.permission);

  // If no roles assigned via user_roles, fall back to legacy users.role column
  if (permissions.length === 0) {
    const legacyRole = db.prepare(`
      SELECT rp.permission
      FROM roles r
      JOIN role_permissions rp ON r.id = rp.role_id
      WHERE r.name = ?
    `).all(user.role) as Array<{ permission: string }>;
    return legacyRole.map(r => r.permission);
  }

  return permissions;
}
