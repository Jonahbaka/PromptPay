// ═══════════════════════════════════════════════════════════════
// PromptPay :: Payment Reminders Engine
// Upcoming bill alerts via Telegram/SMS/WhatsApp
// Configurable lead time, tracks sent/failed/acknowledged
// ═══════════════════════════════════════════════════════════════

import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';

export class RemindersEngine {
  private db: Database.Database;
  private logger: LoggerHandle;

  constructor(db: Database.Database, logger: LoggerHandle) {
    this.db = db;
    this.logger = logger;
  }

  /** Check for upcoming bills and create reminders. Returns count of new reminders. */
  generateReminders(): number {
    const reminderLeadTimeHours = 24; // 24h lead time
    const leadMs = reminderLeadTimeHours * 3600000;
    const now = new Date();
    const horizon = new Date(now.getTime() + leadMs);

    // Find upcoming scheduled bills
    const upcomingBills = this.db.prepare(`
      SELECT bs.*, bs.user_id FROM bill_schedules bs
      WHERE bs.next_due <= ? AND bs.status = 'active'
        AND bs.id NOT IN (
          SELECT reference_id FROM payment_reminders
          WHERE status IN ('sent', 'acknowledged') AND created_at > ?
        )
    `).all(horizon.toISOString(), new Date(now.getTime() - leadMs).toISOString()) as Array<{
      id: string; user_id: string; biller_name: string;
      amount: number; currency: string; next_due: string;
    }>;

    let created = 0;
    for (const bill of upcomingBills) {
      const dueDate = new Date(bill.next_due);
      const daysUntil = Math.ceil((dueDate.getTime() - now.getTime()) / 86400000);

      const message = daysUntil <= 0
        ? `⚠️ ${bill.biller_name} payment of ${bill.currency} ${bill.amount} is DUE TODAY!`
        : `📋 ${bill.biller_name} payment of ${bill.currency} ${bill.amount} is due in ${daysUntil} day${daysUntil > 1 ? 's' : ''}.`;

      this.db.prepare(`
        INSERT INTO payment_reminders (id, user_id, type, reference_id, message, channel, scheduled_for, status, created_at)
        VALUES (?, ?, 'bill_due', ?, ?, 'preferred', ?, 'pending', ?)
      `).run(uuid(), bill.user_id, bill.id, message, dueDate.toISOString(), now.toISOString());

      created++;
    }

    if (created > 0) {
      this.logger.info(`[Reminders] Created ${created} new bill reminders`);
    }
    return created;
  }

  /** Get pending reminders ready to send */
  getPendingReminders(): Array<{
    id: string; userId: string; type: string; message: string;
    channel: string; scheduledFor: string;
  }> {
    return this.db.prepare(`
      SELECT id, user_id as userId, type, message, channel, scheduled_for as scheduledFor
      FROM payment_reminders WHERE status = 'pending' ORDER BY scheduled_for ASC
    `).all() as Array<{
      id: string; userId: string; type: string; message: string;
      channel: string; scheduledFor: string;
    }>;
  }

  /** Mark a reminder as sent */
  markSent(reminderId: string): void {
    this.db.prepare(
      "UPDATE payment_reminders SET status = 'sent', sent_at = ? WHERE id = ?"
    ).run(new Date().toISOString(), reminderId);
  }

  /** Mark a reminder as failed */
  markFailed(reminderId: string, error: string): void {
    this.db.prepare(
      "UPDATE payment_reminders SET status = 'failed', error = ? WHERE id = ?"
    ).run(error, reminderId);
  }

  /** Mark a reminder as acknowledged by user */
  markAcknowledged(reminderId: string): void {
    this.db.prepare(
      "UPDATE payment_reminders SET status = 'acknowledged' WHERE id = ?"
    ).run(reminderId);
  }

  /** Create a custom reminder */
  createCustomReminder(userId: string, message: string, scheduledFor: Date, channel = 'preferred'): string {
    const id = uuid();
    this.db.prepare(`
      INSERT INTO payment_reminders (id, user_id, type, message, channel, scheduled_for, status, created_at)
      VALUES (?, ?, 'custom', ?, ?, ?, 'pending', ?)
    `).run(id, userId, message, channel, scheduledFor.toISOString(), new Date().toISOString());
    return id;
  }

  /** Get reminder stats */
  getStats(): { total: number; pending: number; sent: number; failed: number; acknowledged: number } {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(CASE WHEN status = 'acknowledged' THEN 1 END) as acknowledged
      FROM payment_reminders
    `).get() as { total: number; pending: number; sent: number; failed: number; acknowledged: number };

    return row;
  }
}
