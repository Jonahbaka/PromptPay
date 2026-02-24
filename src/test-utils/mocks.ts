// ═══════════════════════════════════════════════════════════════
// PromptPay :: Test Utilities
// Mock factories for unit testing
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import type { LoggerHandle, MemoryHandle, ExecutionContext } from '../core/types.js';

export function createMockLogger(): LoggerHandle {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

export function createMockMemory(): MemoryHandle {
  const store = new Map<string, unknown>();
  let counter = 0;

  return {
    async store(entry) {
      const id = `mem_${++counter}`;
      store.set(id, { id, ...entry, createdAt: new Date(), accessedAt: new Date(), accessCount: 0 });
      return id;
    },
    async recall(query, namespace, limit = 10) {
      const results: unknown[] = [];
      for (const [, val] of store) {
        const entry = val as Record<string, unknown>;
        if (namespace && entry.namespace !== namespace) continue;
        results.push(entry);
        if (results.length >= limit) break;
      }
      return results as Awaited<ReturnType<MemoryHandle['recall']>>;
    },
    async forget(id) {
      store.delete(id);
    },
    async consolidate() {
      return 0;
    },
  };
}

export function createMockContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  return {
    agentId: 'test-agent',
    taskId: 'test-task',
    sessionId: 'test-session',
    memory: createMockMemory(),
    logger: createMockLogger(),
    tools: new Map(),
    ...overrides,
  };
}

export function createTestDb(): Database.Database {
  return new Database(':memory:');
}
