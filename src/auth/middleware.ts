// ═══════════════════════════════════════════════════════════════
// PromptPay :: Auth Middleware
// Express middleware for authentication and role-based access
// ═══════════════════════════════════════════════════════════════

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from './tokens.js';
import { CONFIG } from '../core/config.js';
import type { AuthPayload, UserRole } from '../core/types.js';
import { hasAnyPermission } from './permissions.js';

// Extend Express Request to carry auth payload
declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

/**
 * Authenticate requests. Accepts:
 * 1. Bearer token (HMAC-signed auth token)
 * 2. Legacy gateway secret (treated as owner for backward compatibility)
 * 3. Local dev mode bypass (gateway.secret === 'promptpay-local')
 */
export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;
  const raw = header?.replace('Bearer ', '') || queryToken;

  if (!raw) {
    if (CONFIG.gateway.secret === 'promptpay-local') {
      req.auth = { userId: 'system', tenantId: null, role: 'owner', permissions: ['*'], exp: Infinity };
      next();
      return;
    }
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // Legacy gateway secret → owner access
  if (raw === CONFIG.gateway.secret) {
    req.auth = { userId: 'system', tenantId: null, role: 'owner', permissions: ['*'], exp: Infinity };
    next();
    return;
  }

  // Verify HMAC token
  const payload = verifyToken(raw, CONFIG.auth.jwtSecret);
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  req.auth = payload;
  next();
}

/**
 * Require specific role(s). Must be used after authenticate().
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    if (!roles.includes(req.auth.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Require specific permission(s). Must be used after authenticate().
 * Owner always passes. Checks permissions from token payload.
 */
export function requirePermission(...permissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }
    // Owner always passes
    if (req.auth.role === 'owner') {
      next();
      return;
    }
    const userPerms = req.auth.permissions || [];
    if (!hasAnyPermission(userPerms, permissions)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}

/**
 * Get tenant filter for scoped queries.
 * Owner sees all (returns null). Partner admin sees only their tenant.
 */
export function getTenantFilter(auth: AuthPayload): string | null {
  if (auth.role === 'owner') return null;
  return auth.tenantId;
}
