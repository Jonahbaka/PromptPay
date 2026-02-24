// ═══════════════════════════════════════════════════════════════
// Self-Healing :: Circuit Breaker Registry
// Protects payment providers from cascading failures
// ═══════════════════════════════════════════════════════════════

import { CircuitBreakerState, LoggerHandle } from '../core/types.js';

export class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreakerState> = new Map();
  private threshold: number;
  private cooldownMs: number;
  private logger: LoggerHandle;

  constructor(config: { circuitBreakerThreshold: number; circuitBreakerCooldownMs: number }, logger: LoggerHandle) {
    this.threshold = config.circuitBreakerThreshold;
    this.cooldownMs = config.circuitBreakerCooldownMs;
    this.logger = logger;
  }

  private ensureBreaker(toolName: string): CircuitBreakerState {
    if (!this.breakers.has(toolName)) {
      this.breakers.set(toolName, {
        toolName, failureCount: 0, lastFailure: null,
        state: 'closed', openedAt: null, cooldownMs: this.cooldownMs,
      });
    }
    return this.breakers.get(toolName)!;
  }

  recordSuccess(toolName: string): void {
    const b = this.ensureBreaker(toolName);
    if (b.state === 'half_open') {
      this.logger.info(`Circuit breaker CLOSED: ${toolName} (recovered)`);
    }
    b.failureCount = 0;
    b.state = 'closed';
    b.openedAt = null;
  }

  recordFailure(toolName: string): void {
    const b = this.ensureBreaker(toolName);
    b.failureCount++;
    b.lastFailure = new Date();
    if (b.failureCount >= this.threshold && b.state === 'closed') {
      b.state = 'open';
      b.openedAt = new Date();
      this.logger.warn(`Circuit breaker OPEN: ${toolName} (${b.failureCount} failures)`);
    }
  }

  canExecute(toolName: string): boolean {
    const b = this.breakers.get(toolName);
    if (!b) return true;
    if (b.state === 'closed') return true;
    if (b.state === 'half_open') return true;
    if (b.openedAt && Date.now() - b.openedAt.getTime() >= b.cooldownMs) {
      b.state = 'half_open';
      this.logger.info(`Circuit breaker HALF_OPEN: ${toolName} (probing)`);
      return true;
    }
    return false;
  }

  evaluate(): CircuitBreakerState[] {
    const changed: CircuitBreakerState[] = [];
    for (const b of this.breakers.values()) {
      if (b.state === 'open' && b.openedAt && Date.now() - b.openedAt.getTime() >= b.cooldownMs) {
        b.state = 'half_open';
        changed.push(b);
        this.logger.info(`Circuit breaker HALF_OPEN: ${b.toolName}`);
      }
    }
    return changed;
  }

  reset(toolName: string): void {
    const b = this.breakers.get(toolName);
    if (b) {
      b.failureCount = 0;
      b.state = 'closed';
      b.openedAt = null;
      this.logger.info(`Circuit breaker RESET: ${toolName}`);
    }
  }

  getState(): CircuitBreakerState[] {
    return Array.from(this.breakers.values());
  }
}
