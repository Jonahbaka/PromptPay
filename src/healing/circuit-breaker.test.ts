import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreakerRegistry } from './circuit-breaker.js';

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('CircuitBreakerRegistry', () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry(
      { circuitBreakerThreshold: 3, circuitBreakerCooldownMs: 1000 },
      mockLogger,
    );
  });

  describe('canExecute', () => {
    it('returns true for an unknown tool', () => {
      expect(registry.canExecute('unknown-tool')).toBe(true);
    });

    it('returns false when circuit is open', () => {
      // Trip the breaker with 3 failures (threshold)
      registry.recordFailure('flaky-tool');
      registry.recordFailure('flaky-tool');
      registry.recordFailure('flaky-tool');

      expect(registry.canExecute('flaky-tool')).toBe(false);
    });

    it('returns true after cooldown expires (half_open)', () => {
      // Trip the breaker
      registry.recordFailure('slow-tool');
      registry.recordFailure('slow-tool');
      registry.recordFailure('slow-tool');

      expect(registry.canExecute('slow-tool')).toBe(false);

      // Advance time past cooldown (1000ms)
      vi.useFakeTimers();
      vi.advanceTimersByTime(1001);

      expect(registry.canExecute('slow-tool')).toBe(true);

      // Verify state is now half_open
      const states = registry.getState();
      const breaker = states.find(s => s.toolName === 'slow-tool');
      expect(breaker?.state).toBe('half_open');

      vi.useRealTimers();
    });
  });

  describe('recordFailure', () => {
    it('opens the circuit after reaching threshold', () => {
      registry.recordFailure('bad-tool');
      registry.recordFailure('bad-tool');

      // Still closed after 2 failures (threshold is 3)
      expect(registry.canExecute('bad-tool')).toBe(true);

      registry.recordFailure('bad-tool');

      // Now open after 3 failures
      expect(registry.canExecute('bad-tool')).toBe(false);

      const states = registry.getState();
      const breaker = states.find(s => s.toolName === 'bad-tool');
      expect(breaker?.state).toBe('open');
      expect(breaker?.failureCount).toBe(3);
    });
  });

  describe('reset', () => {
    it('closes the circuit immediately', () => {
      // Trip the breaker
      registry.recordFailure('resettable-tool');
      registry.recordFailure('resettable-tool');
      registry.recordFailure('resettable-tool');

      expect(registry.canExecute('resettable-tool')).toBe(false);

      // Reset
      registry.reset('resettable-tool');

      expect(registry.canExecute('resettable-tool')).toBe(true);

      const states = registry.getState();
      const breaker = states.find(s => s.toolName === 'resettable-tool');
      expect(breaker?.state).toBe('closed');
      expect(breaker?.failureCount).toBe(0);
    });
  });
});
