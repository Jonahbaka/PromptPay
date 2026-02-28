// ═══════════════════════════════════════════════════════════════
// PromptPay :: Auth Tokens
// HMAC-SHA256 token creation/verification + password hashing
// Zero external dependencies — uses Node.js crypto only
// ═══════════════════════════════════════════════════════════════

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import type { AuthPayload, UserRole } from '../core/types.js';

const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuffer = Buffer.from(hash, 'hex');
  const derived = scryptSync(password, salt, 64);
  if (hashBuffer.length !== derived.length) return false;
  return timingSafeEqual(hashBuffer, derived);
}

export function createToken(
  userId: string,
  tenantId: string | null,
  role: UserRole,
  secret: string,
  expiryMs: number = TOKEN_EXPIRY_MS,
  permissions: string[] = [],
): string {
  const payload: AuthPayload = {
    userId,
    tenantId,
    role,
    permissions,
    exp: Date.now() + expiryMs,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyToken(token: string, secret: string): AuthPayload | null {
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);

  const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as AuthPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
