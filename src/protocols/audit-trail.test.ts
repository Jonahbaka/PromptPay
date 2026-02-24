import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { AuditTrail } from './audit-trail.js';

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe('AuditTrail', () => {
  let db: InstanceType<typeof Database>;
  let trail: AuditTrail;

  beforeEach(() => {
    db = new Database(':memory:');
    // AuditTrail calls initSchema internally, so no manual table creation needed
    trail = new AuditTrail(db, mockLogger);
  });

  describe('record', () => {
    it('creates an entry with correct hash chain', () => {
      const entry = trail.record('admin', 'create_user', 'user-1', { email: 'test@example.com' });

      expect(entry.sequenceNumber).toBe(1);
      expect(entry.actor).toBe('admin');
      expect(entry.action).toBe('create_user');
      expect(entry.target).toBe('user-1');
      expect(entry.details).toEqual({ email: 'test@example.com' });
      expect(entry.previousHash).toBe('0'.repeat(64)); // Genesis hash
      expect(entry.hash).toHaveLength(64); // SHA-256 hex

      // Second entry should chain from the first
      const entry2 = trail.record('admin', 'update_user', 'user-1', {});
      expect(entry2.sequenceNumber).toBe(2);
      expect(entry2.previousHash).toBe(entry.hash);
      expect(entry2.hash).not.toBe(entry.hash);
    });
  });

  describe('verifyChain', () => {
    it('returns valid for a correct chain', () => {
      trail.record('admin', 'action-1', 'target-1');
      trail.record('admin', 'action-2', 'target-2');
      trail.record('system', 'action-3', 'target-3');

      const result = trail.verifyChain();

      expect(result.valid).toBe(true);
      expect(result.totalEntries).toBe(3);
      expect(result.brokenAt).toBeUndefined();
    });

    it('detects tampering', () => {
      trail.record('admin', 'action-1', 'target-1');
      trail.record('admin', 'action-2', 'target-2');
      trail.record('system', 'action-3', 'target-3');

      // Tamper with the second entry's action
      db.prepare("UPDATE audit_trail SET action = 'tampered' WHERE sequence_number = 2").run();

      const result = trail.verifyChain();

      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(2);
      expect(result.totalEntries).toBe(3);
    });
  });

  describe('getRecent', () => {
    it('returns entries in ascending sequence order', () => {
      trail.record('alice', 'login', 'session-1');
      trail.record('bob', 'transfer', 'tx-1');
      trail.record('alice', 'logout', 'session-1');

      const recent = trail.getRecent(10);

      expect(recent).toHaveLength(3);
      // getRecent returns DESC from DB then reverses, so should be ascending
      expect(recent[0].sequenceNumber).toBe(1);
      expect(recent[1].sequenceNumber).toBe(2);
      expect(recent[2].sequenceNumber).toBe(3);
      expect(recent[0].actor).toBe('alice');
      expect(recent[1].actor).toBe('bob');
      expect(recent[2].actor).toBe('alice');
    });
  });
});
