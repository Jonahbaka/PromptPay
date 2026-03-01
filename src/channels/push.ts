// ═══════════════════════════════════════════════════════════════
// PromptPay :: Push Notification Channel (Web Push / VAPID)
// ═══════════════════════════════════════════════════════════════

import webpush from 'web-push';
import { v4 as uuid } from 'uuid';
import type Database from 'better-sqlite3';
import type { ChannelCapabilities, ChannelMessage, LoggerHandle } from '../core/types.js';
import { BaseChannel } from './base.js';

export class PushChannel extends BaseChannel {
  private db: Database.Database;

  constructor(logger: LoggerHandle, db: Database.Database) {
    super('push', logger);
    this.db = db;
  }

  getCapabilities(): ChannelCapabilities {
    return {
      canSendText: true, canSendMedia: false, canCreatePolls: false,
      canReact: false, canThread: false, canVoice: false, maxMessageLength: 4000,
    };
  }

  async sendMessage(recipientId: string, content: string): Promise<boolean> {
    try {
      const payload = content.startsWith('{')
        ? content
        : JSON.stringify({ title: 'PromptPay', body: content });

      const subs = this.db.prepare(
        'SELECT subscription FROM push_subscriptions WHERE user_id = ?'
      ).all(recipientId) as Array<{ subscription: string }>;

      if (subs.length === 0) return false;

      let sent = 0;
      for (const row of subs) {
        try {
          const subscription = JSON.parse(row.subscription);
          await webpush.sendNotification(subscription, payload);
          sent++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 410 || statusCode === 404) {
            this.db.prepare(
              'DELETE FROM push_subscriptions WHERE user_id = ? AND subscription = ?'
            ).run(recipientId, row.subscription);
          }
          this.logger.error(`Push send error for ${recipientId}: ${err}`);
        }
      }

      if (sent > 0) {
        const msg: ChannelMessage = {
          id: uuid(), channelType: 'push', direction: 'outbound',
          senderId: 'system', recipientId, content,
          metadata: { subscriptionCount: subs.length, sent },
          timestamp: new Date(),
        };
        this.emitMessage(msg);
      }

      return sent > 0;
    } catch (err) {
      this.logger.error(`Push channel error: ${err}`);
      return false;
    }
  }

  saveSubscription(userId: string, subscription: object): void {
    const json = JSON.stringify(subscription);
    this.db.prepare(`
      INSERT OR REPLACE INTO push_subscriptions (user_id, subscription, created_at)
      VALUES (?, ?, ?)
    `).run(userId, json, new Date().toISOString());
    this.logger.info(`Push subscription saved for ${userId}`);
  }

  removeSubscription(userId: string, endpoint: string): void {
    const subs = this.db.prepare(
      'SELECT rowid, subscription FROM push_subscriptions WHERE user_id = ?'
    ).all(userId) as Array<{ rowid: number; subscription: string }>;

    for (const row of subs) {
      const parsed = JSON.parse(row.subscription);
      if (parsed.endpoint === endpoint) {
        this.db.prepare('DELETE FROM push_subscriptions WHERE rowid = ?').run(row.rowid);
      }
    }
  }

  async start(): Promise<void> {
    // VAPID keys not configured — push channel disabled for now
    // To enable: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT in .env
    // and add push config section to config.ts
    this.logger.warn('VAPID keys not configured, push channel disabled');
  }

  async stop(): Promise<void> {
    this.active = false;
  }
}
