// ═══════════════════════════════════════════════════════════════
// PromptPay :: Calendar AI Agent — "Chrono"
// Proactive streaming to-do & reminder agent with motivational AI
// Available: Super Admin (full) + Partners (paid feature)
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { LoggerHandle } from '../core/types.js';
import { authenticate, requireRole } from '../auth/middleware.js';
import type { MemoryStore } from '../memory/store.js';
import type { AuditTrail } from '../protocols/audit-trail.js';

export interface CalendarRouteDependencies {
  memory: MemoryStore;
  auditTrail: AuditTrail;
  logger: LoggerHandle;
}

// ── Motivational AI Engine ──
const MOTIVATIONAL_MESSAGES = {
  morning: [
    "Rise and grind! Your empire won't build itself. Let's crush today's tasks.",
    "Good morning, boss. You've got {pending} items waiting. Let's eat.",
    "New day, new wins. {completed_yesterday} tasks cleared yesterday — keep that energy.",
    "The grind doesn't stop. {overdue} overdue items need your attention first.",
    "Champions wake up and attack the day. Your to-do list is loaded.",
    "Another day to outwork everyone. Let's get these {pending} tasks done.",
  ],
  afternoon: [
    "Halfway through the day — {completed_today} tasks down. Keep pushing.",
    "Don't slow down now. {pending} tasks still on deck.",
    "Afternoon check-in: You're {percent}% through today's list. Strong work.",
    "The second half is where winners separate. {remaining} items left.",
    "Momentum is everything. Keep stacking those completed tasks.",
  ],
  evening: [
    "End-of-day review: {completed_today} tasks completed. Tomorrow we go harder.",
    "Wrapping up — {overdue} items carry over. First priority tomorrow.",
    "Great day of execution. {completed_today} done, {pending} ready for tomorrow.",
    "Rest tonight, but {priority_high} high-priority items need early attention tomorrow.",
    "Today's score: {completed_today} completed. Your consistency is building something big.",
  ],
  streak: [
    "🔥 {streak}-day productivity streak! Don't break the chain.",
    "You've been consistent for {streak} days straight. That's how empires are built.",
    "{streak} days of hitting your goals. The compound effect is real.",
  ],
  overdue: [
    "⚠️ {count} overdue tasks need immediate attention. Let's clear the backlog.",
    "Red alert: {count} items past due. Block 30 minutes and knock them out.",
    "Overdue items are accumulating ({count}). Prioritize or reschedule them.",
  ],
  milestone: [
    "🏆 {count} tasks completed this week! You're operating at CEO level.",
    "100+ tasks lifetime! Your execution rate is elite.",
    "You just hit {count} total completions. The machine keeps running.",
  ],
  deadline_approaching: [
    "⏰ '{title}' is due {when}. Make sure it's handled.",
    "Heads up: '{title}' deadline is {when}. Don't let it slip.",
    "'{title}' — due {when}. Block time now to get it done.",
  ],
  productivity_tip: [
    "💡 Tip: Eat the frog first. Start with your hardest task.",
    "💡 Tip: Time-block your calendar. 90-minute deep work sprints.",
    "💡 Tip: If it takes less than 2 minutes, do it now. Don't add it to the list.",
    "💡 Tip: Review tomorrow's tasks tonight. Wake up with clarity.",
    "💡 Tip: Say no to low-priority requests. Protect your focus.",
    "💡 Tip: Batch similar tasks together. Context-switching kills productivity.",
  ],
};

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const hour = new Date().getUTCHours() + 1; // WAT is UTC+1
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fillTemplate(template: string, vars: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
}

// ── Priority colors for streaming ──
const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  urgent: { label: 'URGENT', color: '#ef4444' },
  high: { label: 'HIGH', color: '#f97316' },
  medium: { label: 'MEDIUM', color: '#eab308' },
  low: { label: 'LOW', color: '#22c55e' },
};

// ── Category icons ──
const CATEGORY_ICONS: Record<string, string> = {
  business: '💼', hiring: '👥', finance: '💰', marketing: '📢',
  product: '🛠️', legal: '⚖️', operations: '⚙️', personal: '🏠',
  meeting: '📅', call: '📞', email: '✉️', review: '🔍',
  deadline: '⏰', followup: '🔄', strategy: '🎯', general: '📌',
};

export function createCalendarRoutes(deps: CalendarRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // ── Create tables ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_todos (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_type TEXT NOT NULL DEFAULT 'admin',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'general',
      priority TEXT DEFAULT 'medium',
      status TEXT DEFAULT 'pending',
      due_date TEXT,
      due_time TEXT,
      reminder_at TEXT,
      reminder_sent INTEGER DEFAULT 0,
      recurrence TEXT DEFAULT 'none',
      recurrence_end TEXT,
      parent_id TEXT,
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      completed_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_type TEXT NOT NULL DEFAULT 'admin',
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      category TEXT DEFAULT 'meeting',
      start_time TEXT NOT NULL,
      end_time TEXT,
      location TEXT DEFAULT '',
      attendees TEXT DEFAULT '[]',
      reminder_minutes INTEGER DEFAULT 15,
      reminder_sent INTEGER DEFAULT 0,
      recurrence TEXT DEFAULT 'none',
      color TEXT DEFAULT '#6366f1',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_streaks (
      owner_id TEXT PRIMARY KEY,
      current_streak INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_active_date TEXT,
      total_completed INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS calendar_reminders_log (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      message TEXT NOT NULL,
      message_type TEXT DEFAULT 'reminder',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_cal_todos_owner ON calendar_todos(owner_id, owner_type);
    CREATE INDEX IF NOT EXISTS idx_cal_todos_status ON calendar_todos(status, due_date);
    CREATE INDEX IF NOT EXISTS idx_cal_todos_reminder ON calendar_todos(reminder_at, reminder_sent);
    CREATE INDEX IF NOT EXISTS idx_cal_events_owner ON calendar_events(owner_id, owner_type);
    CREATE INDEX IF NOT EXISTS idx_cal_events_time ON calendar_events(start_time);
    CREATE INDEX IF NOT EXISTS idx_cal_reminders_owner ON calendar_reminders_log(owner_id, read);
  `);

  // ══════════════════════════════════════════════════════════════
  // SHARED HELPERS
  // ══════════════════════════════════════════════════════════════

  function getOwnerContext(req: Request): { ownerId: string; ownerType: string } {
    const role = req.auth?.role || 'user';
    if (role === 'owner') return { ownerId: req.auth!.userId, ownerType: 'admin' };
    if (role === 'partner_admin') return { ownerId: req.auth!.userId, ownerType: 'partner' };
    return { ownerId: req.auth!.userId, ownerType: 'user' };
  }

  function getStats(ownerId: string, ownerType: string) {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const pending = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'pending'"
    ).get(ownerId, ownerType) as { c: number }).c;

    const completedToday = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'completed' AND date(completed_at) = ?"
    ).get(ownerId, ownerType, today) as { c: number }).c;

    const completedYesterday = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'completed' AND date(completed_at) = ?"
    ).get(ownerId, ownerType, yesterday) as { c: number }).c;

    const overdue = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'pending' AND due_date < ? AND due_date IS NOT NULL"
    ).get(ownerId, ownerType, today) as { c: number }).c;

    const highPriority = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'pending' AND priority IN ('urgent', 'high')"
    ).get(ownerId, ownerType) as { c: number }).c;

    const totalCompleted = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'completed'"
    ).get(ownerId, ownerType) as { c: number }).c;

    const completedThisWeek = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'completed' AND completed_at >= datetime('now', '-7 days')"
    ).get(ownerId, ownerType) as { c: number }).c;

    const dueToday = (db.prepare(
      "SELECT COUNT(*) as c FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'pending' AND due_date = ?"
    ).get(ownerId, ownerType, today) as { c: number }).c;

    const streak = db.prepare(
      "SELECT * FROM calendar_streaks WHERE owner_id = ?"
    ).get(ownerId) as { current_streak: number; longest_streak: number; total_completed: number } | undefined;

    const todayTotal = completedToday + pending;
    const percent = todayTotal > 0 ? Math.round((completedToday / todayTotal) * 100) : 0;

    return {
      pending, completedToday, completedYesterday, overdue, highPriority,
      totalCompleted, completedThisWeek, dueToday, percent,
      streak: streak?.current_streak || 0,
      longestStreak: streak?.longest_streak || 0,
      remaining: pending,
    };
  }

  function generateMotivation(ownerId: string, ownerType: string): string[] {
    const stats = getStats(ownerId, ownerType);
    const messages: string[] = [];
    const vars: Record<string, string | number> = {
      pending: stats.pending,
      completed_today: stats.completedToday,
      completed_yesterday: stats.completedYesterday,
      overdue: stats.overdue,
      priority_high: stats.highPriority,
      remaining: stats.remaining,
      percent: stats.percent,
      streak: stats.streak,
      count: stats.totalCompleted,
    };

    // Time-of-day greeting
    const tod = getTimeOfDay();
    messages.push(fillTemplate(pickRandom(MOTIVATIONAL_MESSAGES[tod]), vars));

    // Streak message if active
    if (stats.streak >= 3) {
      messages.push(fillTemplate(pickRandom(MOTIVATIONAL_MESSAGES.streak), vars));
    }

    // Overdue alert
    if (stats.overdue > 0) {
      messages.push(fillTemplate(pickRandom(MOTIVATIONAL_MESSAGES.overdue), { count: stats.overdue }));
    }

    // Milestone
    if (stats.completedThisWeek >= 10) {
      messages.push(fillTemplate(pickRandom(MOTIVATIONAL_MESSAGES.milestone), { count: stats.completedThisWeek }));
    }

    // Random productivity tip (30% chance)
    if (Math.random() < 0.3) {
      messages.push(pickRandom(MOTIVATIONAL_MESSAGES.productivity_tip));
    }

    // Upcoming deadline alerts
    const upcoming = db.prepare(`
      SELECT title, due_date, due_time FROM calendar_todos
      WHERE owner_id = ? AND owner_type = ? AND status = 'pending'
        AND due_date IS NOT NULL AND due_date <= date('now', '+2 days')
      ORDER BY due_date, due_time LIMIT 3
    `).all(ownerId, ownerType) as Array<{ title: string; due_date: string; due_time: string }>;

    for (const item of upcoming) {
      const dueDate = new Date(item.due_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diff = Math.ceil((dueDate.getTime() - today.getTime()) / 86400000);
      const when = diff <= 0 ? 'TODAY' : diff === 1 ? 'tomorrow' : `in ${diff} days`;
      messages.push(fillTemplate(pickRandom(MOTIVATIONAL_MESSAGES.deadline_approaching), {
        title: item.title, when,
      }));
    }

    return messages;
  }

  function updateStreak(ownerId: string): void {
    const today = new Date().toISOString().slice(0, 10);
    const existing = db.prepare("SELECT * FROM calendar_streaks WHERE owner_id = ?").get(ownerId) as {
      current_streak: number; longest_streak: number; last_active_date: string; total_completed: number;
    } | undefined;

    if (!existing) {
      db.prepare(`INSERT INTO calendar_streaks (owner_id, current_streak, longest_streak, last_active_date, total_completed)
        VALUES (?, 1, 1, ?, 1)`).run(ownerId, today);
      return;
    }

    const lastDate = existing.last_active_date;
    if (lastDate === today) {
      db.prepare("UPDATE calendar_streaks SET total_completed = total_completed + 1 WHERE owner_id = ?").run(ownerId);
      return;
    }

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const newStreak = lastDate === yesterday ? existing.current_streak + 1 : 1;
    const longest = Math.max(newStreak, existing.longest_streak);

    db.prepare(`UPDATE calendar_streaks SET current_streak = ?, longest_streak = ?, last_active_date = ?,
      total_completed = total_completed + 1, updated_at = datetime('now') WHERE owner_id = ?`)
      .run(newStreak, longest, today, ownerId);
  }

  // ══════════════════════════════════════════════════════════════
  // STREAMING ENDPOINT — SSE (Server-Sent Events)
  // Real-time proactive motivation + reminder stream
  // ══════════════════════════════════════════════════════════════

  router.get('/api/calendar/stream', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);

    // SSE headers
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    // Send initial motivation burst
    const motivations = generateMotivation(ownerId, ownerType);
    const stats = getStats(ownerId, ownerType);

    res.write(`data: ${JSON.stringify({ type: 'init', stats, motivations, timestamp: new Date().toISOString() })}\n\n`);

    // Send unread reminders
    const unread = db.prepare(
      "SELECT * FROM calendar_reminders_log WHERE owner_id = ? AND read = 0 ORDER BY created_at DESC LIMIT 20"
    ).all(ownerId) as Array<Record<string, unknown>>;

    if (unread.length > 0) {
      res.write(`data: ${JSON.stringify({ type: 'unread_reminders', reminders: unread })}\n\n`);
    }

    // Periodic check every 60 seconds
    const interval = setInterval(() => {
      try {
        // Check for new due reminders
        const now = new Date().toISOString();
        const dueReminders = db.prepare(`
          SELECT * FROM calendar_todos
          WHERE owner_id = ? AND owner_type = ? AND status = 'pending'
            AND reminder_at IS NOT NULL AND reminder_at <= ? AND reminder_sent = 0
        `).all(ownerId, ownerType, now) as Array<Record<string, unknown>>;

        for (const todo of dueReminders) {
          const msg = `⏰ Reminder: "${todo.title}" — ${todo.priority === 'urgent' ? 'URGENT!' : 'due soon'}`;
          db.prepare("UPDATE calendar_todos SET reminder_sent = 1 WHERE id = ?").run(todo.id);
          db.prepare(`INSERT INTO calendar_reminders_log (id, owner_id, owner_type, message, message_type)
            VALUES (?, ?, ?, ?, 'reminder')`).run(uuid(), ownerId, ownerType, msg);
          res.write(`data: ${JSON.stringify({ type: 'reminder', todo, message: msg })}\n\n`);
        }

        // Check upcoming events (within 15 min)
        const soon = new Date(Date.now() + 15 * 60000).toISOString();
        const upcomingEvents = db.prepare(`
          SELECT * FROM calendar_events
          WHERE owner_id = ? AND owner_type = ? AND start_time > ? AND start_time <= ? AND reminder_sent = 0
        `).all(ownerId, ownerType, now, soon) as Array<Record<string, unknown>>;

        for (const event of upcomingEvents) {
          db.prepare("UPDATE calendar_events SET reminder_sent = 1 WHERE id = ?").run(event.id);
          res.write(`data: ${JSON.stringify({
            type: 'event_reminder',
            event,
            message: `📅 "${event.title}" starts in ${event.reminder_minutes || 15} minutes${event.location ? ` at ${event.location}` : ''}`
          })}\n\n`);
        }

        // Heartbeat with fresh stats every 60s
        const freshStats = getStats(ownerId, ownerType);
        res.write(`data: ${JSON.stringify({ type: 'heartbeat', stats: freshStats, timestamp: new Date().toISOString() })}\n\n`);

      } catch (err) {
        deps.logger.error(`Calendar stream error: ${err}`);
      }
    }, 60000);

    // Motivational nudge every 30 minutes
    const motivationInterval = setInterval(() => {
      try {
        const msgs = generateMotivation(ownerId, ownerType);
        const tip = pickRandom(msgs);
        res.write(`data: ${JSON.stringify({ type: 'motivation', message: tip, timestamp: new Date().toISOString() })}\n\n`);
      } catch (_) { /* stream closed */ }
    }, 1800000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(interval);
      clearInterval(motivationInterval);
      deps.logger.debug(`Calendar stream closed for ${ownerId}`);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // TO-DO CRUD
  // ══════════════════════════════════════════════════════════════

  // Get all todos (with filtering)
  router.get('/api/calendar/todos', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const status = req.query.status as string || '';
    const priority = req.query.priority as string || '';
    const category = req.query.category as string || '';
    const dateFrom = req.query.from as string || '';
    const dateTo = req.query.to as string || '';
    const search = req.query.search as string || '';

    let sql = "SELECT * FROM calendar_todos WHERE owner_id = ? AND owner_type = ?";
    const params: unknown[] = [ownerId, ownerType];

    if (status) { sql += " AND status = ?"; params.push(status); }
    if (priority) { sql += " AND priority = ?"; params.push(priority); }
    if (category) { sql += " AND category = ?"; params.push(category); }
    if (dateFrom) { sql += " AND due_date >= ?"; params.push(dateFrom); }
    if (dateTo) { sql += " AND due_date <= ?"; params.push(dateTo); }
    if (search) { sql += " AND (title LIKE ? OR description LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }

    sql += " ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, due_date ASC, created_at DESC";

    const todos = db.prepare(sql).all(...params);
    const stats = getStats(ownerId, ownerType);

    res.json({ todos, stats });
  });

  // Create todo
  router.post('/api/calendar/todos', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const { title, description, category, priority, dueDate, dueTime, reminderAt, recurrence, tags } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      res.status(400).json({ error: 'Title is required' });
      return;
    }

    const id = uuid();
    db.prepare(`INSERT INTO calendar_todos (id, owner_id, owner_type, title, description, category, priority, due_date, due_time, reminder_at, recurrence, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, ownerId, ownerType, title.trim(), description || '', category || 'general',
      priority || 'medium', dueDate || null, dueTime || null, reminderAt || null,
      recurrence || 'none', JSON.stringify(tags || [])
    );

    deps.auditTrail.record(ownerType, 'calendar_todo_created', ownerId, { id, title });
    const todo = db.prepare("SELECT * FROM calendar_todos WHERE id = ?").get(id);
    res.json({ todo, message: '✅ Task added! Stay focused.' });
  });

  // Update todo
  router.put('/api/calendar/todos/:id', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const todoId = req.params.id;
    const existing = db.prepare(
      "SELECT * FROM calendar_todos WHERE id = ? AND owner_id = ? AND owner_type = ?"
    ).get(todoId, ownerId, ownerType) as Record<string, unknown> | undefined;

    if (!existing) { res.status(404).json({ error: 'Todo not found' }); return; }

    const { title, description, category, priority, dueDate, dueTime, reminderAt, status, notes, tags } = req.body;

    const fields: string[] = [];
    const params: unknown[] = [];

    if (title !== undefined) { fields.push("title = ?"); params.push(title); }
    if (description !== undefined) { fields.push("description = ?"); params.push(description); }
    if (category !== undefined) { fields.push("category = ?"); params.push(category); }
    if (priority !== undefined) { fields.push("priority = ?"); params.push(priority); }
    if (dueDate !== undefined) { fields.push("due_date = ?"); params.push(dueDate || null); }
    if (dueTime !== undefined) { fields.push("due_time = ?"); params.push(dueTime || null); }
    if (reminderAt !== undefined) { fields.push("reminder_at = ?"); params.push(reminderAt || null); fields.push("reminder_sent = 0"); }
    if (notes !== undefined) { fields.push("notes = ?"); params.push(notes); }
    if (tags !== undefined) { fields.push("tags = ?"); params.push(JSON.stringify(tags)); }

    if (status !== undefined) {
      fields.push("status = ?");
      params.push(status);
      if (status === 'completed' && existing.status !== 'completed') {
        fields.push("completed_at = datetime('now')");
        updateStreak(ownerId);
      }
    }

    fields.push("updated_at = datetime('now')");
    params.push(todoId, ownerId, ownerType);

    db.prepare(`UPDATE calendar_todos SET ${fields.join(', ')} WHERE id = ? AND owner_id = ? AND owner_type = ?`).run(...params);

    const updated = db.prepare("SELECT * FROM calendar_todos WHERE id = ?").get(todoId);
    const motivMsg = status === 'completed' ? pickRandom([
      "💪 Crushed it! One less thing on the list.",
      "✅ Done! Keep that momentum going.",
      "🔥 Task complete. You're on fire today.",
      "💥 Another one down. The grind pays off.",
      "⚡ Executed! What's next?",
    ]) : '';

    res.json({ todo: updated, message: motivMsg || 'Updated.' });
  });

  // Delete todo
  router.delete('/api/calendar/todos/:id', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const result = db.prepare(
      "DELETE FROM calendar_todos WHERE id = ? AND owner_id = ? AND owner_type = ?"
    ).run(req.params.id, ownerId, ownerType);

    if (result.changes === 0) { res.status(404).json({ error: 'Todo not found' }); return; }
    res.json({ success: true });
  });

  // Bulk status update (complete multiple, clear completed, etc.)
  router.post('/api/calendar/todos/bulk', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const { action, ids } = req.body;

    if (!action || !Array.isArray(ids)) {
      res.status(400).json({ error: 'action and ids[] required' });
      return;
    }

    let affected = 0;
    if (action === 'complete') {
      for (const id of ids) {
        const r = db.prepare(
          "UPDATE calendar_todos SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND owner_id = ? AND owner_type = ? AND status = 'pending'"
        ).run(id, ownerId, ownerType);
        if (r.changes > 0) { affected++; updateStreak(ownerId); }
      }
    } else if (action === 'delete') {
      for (const id of ids) {
        const r = db.prepare("DELETE FROM calendar_todos WHERE id = ? AND owner_id = ? AND owner_type = ?").run(id, ownerId, ownerType);
        affected += r.changes;
      }
    } else if (action === 'clear_completed') {
      const r = db.prepare(
        "DELETE FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'completed'"
      ).run(ownerId, ownerType);
      affected = r.changes;
    }

    res.json({ affected, message: affected > 0 ? `🎯 ${affected} items processed.` : 'No changes.' });
  });

  // ══════════════════════════════════════════════════════════════
  // CALENDAR EVENTS
  // ══════════════════════════════════════════════════════════════

  router.get('/api/calendar/events', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const from = req.query.from as string || new Date().toISOString().slice(0, 10);
    const to = req.query.to as string || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    const events = db.prepare(
      "SELECT * FROM calendar_events WHERE owner_id = ? AND owner_type = ? AND date(start_time) >= ? AND date(start_time) <= ? ORDER BY start_time ASC"
    ).all(ownerId, ownerType, from, to);

    res.json({ events });
  });

  router.post('/api/calendar/events', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const { title, description, category, startTime, endTime, location, attendees, reminderMinutes, color, recurrence } = req.body;

    if (!title || !startTime) {
      res.status(400).json({ error: 'title and startTime required' });
      return;
    }

    const id = uuid();
    db.prepare(`INSERT INTO calendar_events (id, owner_id, owner_type, title, description, category, start_time, end_time, location, attendees, reminder_minutes, color, recurrence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, ownerId, ownerType, title, description || '', category || 'meeting',
      startTime, endTime || null, location || '', JSON.stringify(attendees || []),
      reminderMinutes || 15, color || '#6366f1', recurrence || 'none'
    );

    const event = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(id);
    res.json({ event, message: '📅 Event scheduled!' });
  });

  router.put('/api/calendar/events/:id', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const { title, description, startTime, endTime, location, color } = req.body;
    const fields: string[] = [];
    const params: unknown[] = [];

    if (title !== undefined) { fields.push("title = ?"); params.push(title); }
    if (description !== undefined) { fields.push("description = ?"); params.push(description); }
    if (startTime !== undefined) { fields.push("start_time = ?"); params.push(startTime); }
    if (endTime !== undefined) { fields.push("end_time = ?"); params.push(endTime); }
    if (location !== undefined) { fields.push("location = ?"); params.push(location); }
    if (color !== undefined) { fields.push("color = ?"); params.push(color); }

    if (fields.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    params.push(req.params.id, ownerId, ownerType);

    db.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ? AND owner_id = ? AND owner_type = ?`).run(...params);
    const event = db.prepare("SELECT * FROM calendar_events WHERE id = ?").get(req.params.id);
    res.json({ event });
  });

  router.delete('/api/calendar/events/:id', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    db.prepare("DELETE FROM calendar_events WHERE id = ? AND owner_id = ? AND owner_type = ?").run(req.params.id, ownerId, ownerType);
    res.json({ success: true });
  });

  // ══════════════════════════════════════════════════════════════
  // MOTIVATION & STATS
  // ══════════════════════════════════════════════════════════════

  router.get('/api/calendar/motivation', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const messages = generateMotivation(ownerId, ownerType);
    const stats = getStats(ownerId, ownerType);
    res.json({ messages, stats });
  });

  router.get('/api/calendar/stats', authenticate, (req: Request, res: Response) => {
    const { ownerId, ownerType } = getOwnerContext(req);
    const stats = getStats(ownerId, ownerType);

    // Weekly breakdown
    const weekData = db.prepare(`
      SELECT date(completed_at) as day, COUNT(*) as count
      FROM calendar_todos WHERE owner_id = ? AND owner_type = ? AND status = 'completed'
        AND completed_at >= datetime('now', '-7 days')
      GROUP BY date(completed_at) ORDER BY day
    `).all(ownerId, ownerType);

    // Category breakdown
    const categoryBreakdown = db.prepare(`
      SELECT category, COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM calendar_todos WHERE owner_id = ? AND owner_type = ?
      GROUP BY category ORDER BY total DESC
    `).all(ownerId, ownerType);

    // Priority breakdown
    const priorityBreakdown = db.prepare(`
      SELECT priority, COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM calendar_todos WHERE owner_id = ? AND owner_type = ?
      GROUP BY priority
    `).all(ownerId, ownerType);

    res.json({ stats, weekData, categoryBreakdown, priorityBreakdown });
  });

  // Mark reminders as read
  router.post('/api/calendar/reminders/read', authenticate, (req: Request, res: Response) => {
    const { ownerId } = getOwnerContext(req);
    const { ids } = req.body;

    if (ids && Array.isArray(ids)) {
      for (const id of ids) {
        db.prepare("UPDATE calendar_reminders_log SET read = 1 WHERE id = ? AND owner_id = ?").run(id, ownerId);
      }
    } else {
      db.prepare("UPDATE calendar_reminders_log SET read = 1 WHERE owner_id = ?").run(ownerId);
    }
    res.json({ success: true });
  });

  // Get unread reminder count (for badge)
  router.get('/api/calendar/reminders/unread', authenticate, (req: Request, res: Response) => {
    const { ownerId } = getOwnerContext(req);
    const row = db.prepare(
      "SELECT COUNT(*) as c FROM calendar_reminders_log WHERE owner_id = ? AND read = 0"
    ).get(ownerId) as { c: number };
    res.json({ unread: row.c });
  });

  // ══════════════════════════════════════════════════════════════
  // PROACTIVE DAEMON HELPER (called from daemon loop)
  // ══════════════════════════════════════════════════════════════

  // This is a static check endpoint the daemon calls
  router.post('/api/calendar/daemon/check', (req: Request, res: Response) => {
    // Internal endpoint — check all pending reminders across all users
    const internalKey = req.headers['x-internal-key'];
    if (internalKey !== 'chrono-daemon-key') {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const now = new Date().toISOString();
    const dueReminders = db.prepare(`
      SELECT t.*, t.owner_id, t.owner_type FROM calendar_todos t
      WHERE t.status = 'pending' AND t.reminder_at IS NOT NULL
        AND t.reminder_at <= ? AND t.reminder_sent = 0
    `).all(now) as Array<Record<string, unknown>>;

    let processed = 0;
    for (const todo of dueReminders) {
      db.prepare("UPDATE calendar_todos SET reminder_sent = 1 WHERE id = ?").run(todo.id);
      db.prepare(`INSERT INTO calendar_reminders_log (id, owner_id, owner_type, message, message_type)
        VALUES (?, ?, ?, ?, 'reminder')`)
        .run(uuid(), todo.owner_id, todo.owner_type,
          `⏰ Reminder: "${todo.title}" — ${todo.priority === 'urgent' ? 'URGENT!' : 'needs attention'}`);
      processed++;
    }

    // Auto-generate morning motivation for active users
    const hour = new Date().getUTCHours() + 1; // WAT
    if (hour === 8) { // 8 AM WAT daily motivation
      const activeUsers = db.prepare(`
        SELECT DISTINCT owner_id, owner_type FROM calendar_todos
        WHERE status = 'pending' AND created_at >= datetime('now', '-30 days')
      `).all() as Array<{ owner_id: string; owner_type: string }>;

      for (const user of activeUsers) {
        const msgs = generateMotivation(user.owner_id, user.owner_type);
        if (msgs.length > 0) {
          db.prepare(`INSERT INTO calendar_reminders_log (id, owner_id, owner_type, message, message_type)
            VALUES (?, ?, ?, ?, 'motivation')`)
            .run(uuid(), user.owner_id, user.owner_type, msgs[0]);
        }
      }
    }

    res.json({ processed, timestamp: now });
  });

  deps.logger.info('Chrono (Calendar AI) agent initialized');
  return router;
}
