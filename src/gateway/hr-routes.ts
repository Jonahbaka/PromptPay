// ═══════════════════════════════════════════════════════════════
// PromptPay :: HR & Hiring Routes
// Job listings, applications, interview pipeline, candidate tracking
// Public: /api/careers — Admin: /api/hr/*
// ═══════════════════════════════════════════════════════════════

import { Router, type Request, type Response } from 'express';
import { v4 as uuid } from 'uuid';
import { authenticate, requireRole } from '../auth/middleware.js';
import type { MemoryStore } from '../memory/store.js';
import type { AuditTrail } from '../protocols/audit-trail.js';
import type { LoggerHandle } from '../core/types.js';

export interface HrRouteDependencies {
  memory: MemoryStore;
  auditTrail: AuditTrail;
  logger: LoggerHandle;
}

// Application pipeline stages
const PIPELINE_STAGES = ['applied', 'screening', 'interview', 'assessment', 'offer', 'hired', 'rejected'] as const;

export function createHrRoutes(deps: HrRouteDependencies): Router {
  const router = Router();
  const db = deps.memory.getDb();

  // ── Ensure HR tables exist ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS job_listings (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      department TEXT NOT NULL,
      type TEXT DEFAULT 'full-time',
      location TEXT DEFAULT 'Lagos, Nigeria',
      remote_ok INTEGER DEFAULT 0,
      salary_min REAL,
      salary_max REAL,
      salary_currency TEXT DEFAULT 'NGN',
      description TEXT NOT NULL,
      requirements TEXT,
      benefits TEXT,
      status TEXT DEFAULT 'draft',
      priority TEXT DEFAULT 'normal',
      positions INTEGER DEFAULT 1,
      applications_count INTEGER DEFAULT 0,
      hired_count INTEGER DEFAULT 0,
      created_by TEXT,
      published_at TEXT,
      closes_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON job_listings(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_dept ON job_listings(department);

    CREATE TABLE IF NOT EXISTS job_applications (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      location TEXT,
      linkedin_url TEXT,
      portfolio_url TEXT,
      resume_data TEXT,
      resume_filename TEXT,
      cover_letter TEXT,
      experience_years INTEGER DEFAULT 0,
      current_role TEXT,
      expected_salary TEXT,
      referral_source TEXT,
      answers TEXT,
      stage TEXT DEFAULT 'applied',
      rating INTEGER DEFAULT 0,
      notes TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      assigned_to TEXT,
      rejection_reason TEXT,
      offer_amount REAL,
      offer_accepted INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (job_id) REFERENCES job_listings(id)
    );
    CREATE INDEX IF NOT EXISTS idx_apps_job ON job_applications(job_id);
    CREATE INDEX IF NOT EXISTS idx_apps_stage ON job_applications(stage);
    CREATE INDEX IF NOT EXISTS idx_apps_email ON job_applications(email);

    CREATE TABLE IF NOT EXISTS interview_schedules (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      interview_type TEXT DEFAULT 'phone',
      scheduled_at TEXT NOT NULL,
      duration_minutes INTEGER DEFAULT 30,
      interviewer TEXT,
      location TEXT,
      notes TEXT,
      outcome TEXT,
      score INTEGER,
      completed INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES job_applications(id)
    );
    CREATE INDEX IF NOT EXISTS idx_interview_app ON interview_schedules(application_id);
  `);

  // ═══════════════════════════════════════════════
  // PUBLIC ENDPOINTS
  // ═══════════════════════════════════════════════

  // ── List Open Positions (Public) ──
  router.get('/api/careers', (_req: Request, res: Response) => {
    const jobs = db.prepare(`
      SELECT id, title, department, type, location, remote_ok,
             salary_min, salary_max, salary_currency, description,
             requirements, benefits, positions, priority, published_at, closes_at
      FROM job_listings
      WHERE status = 'published' AND (closes_at IS NULL OR closes_at > datetime('now'))
      ORDER BY priority DESC, published_at DESC
    `).all() as Array<Record<string, unknown>>;

    res.json({
      positions: jobs.map(j => ({
        id: j.id,
        title: j.title,
        department: j.department,
        type: j.type,
        location: j.location,
        remoteOk: !!j.remote_ok,
        salary: j.salary_min ? {
          min: j.salary_min,
          max: j.salary_max,
          currency: j.salary_currency,
        } : null,
        description: j.description,
        requirements: j.requirements ? JSON.parse(j.requirements as string) : [],
        benefits: j.benefits ? JSON.parse(j.benefits as string) : [],
        positions: j.positions,
        priority: j.priority,
        publishedAt: j.published_at,
        closesAt: j.closes_at,
      })),
      company: {
        name: 'PromptPay',
        tagline: 'AI-Powered Financial Services for Africa',
        about: 'PromptPay is building the future of financial services in Africa — combining AI agents, digital wallets, POS networks, and cross-border payments into one platform. We are growing fast and looking for exceptional talent to join our mission.',
        perks: [
          'Competitive salary + performance bonuses',
          'HMO health coverage',
          'Flexible work hours',
          'Growth in a fast-paced fintech startup',
          'Work on cutting-edge AI + financial technology',
          'Be part of the founding team in Nigeria',
        ],
        locations: ['Lagos, Nigeria', 'Abuja, Nigeria', 'Remote'],
      },
    });
  });

  // ── Get Single Job (Public) ──
  router.get('/api/careers/:id', (req: Request, res: Response) => {
    const job = db.prepare(
      "SELECT * FROM job_listings WHERE id = ? AND status = 'published'"
    ).get(String(req.params.id)) as Record<string, unknown> | undefined;
    if (!job) { res.status(404).json({ error: 'Position not found' }); return; }

    res.json({
      ...job,
      requirements: job.requirements ? JSON.parse(job.requirements as string) : [],
      benefits: job.benefits ? JSON.parse(job.benefits as string) : [],
    });
  });

  // ── Submit Application (Public) ──
  router.post('/api/careers/apply', (req: Request, res: Response) => {
    try {
      const {
        jobId, fullName, email, phone, location, linkedinUrl, portfolioUrl,
        resumeData, resumeFilename, coverLetter, experienceYears, currentRole,
        expectedSalary, referralSource, answers,
      } = req.body;

      if (!jobId || !fullName || !email) {
        res.status(400).json({ error: 'jobId, fullName, and email are required' });
        return;
      }

      // Verify job exists and is open
      const job = db.prepare(
        "SELECT id, title, status FROM job_listings WHERE id = ? AND status = 'published'"
      ).get(jobId) as { id: string; title: string; status: string } | undefined;
      if (!job) {
        res.status(404).json({ error: 'This position is no longer accepting applications' });
        return;
      }

      // Check for duplicate application
      const existing = db.prepare(
        'SELECT id FROM job_applications WHERE job_id = ? AND email = ?'
      ).get(jobId, email.toLowerCase().trim());
      if (existing) {
        res.status(409).json({ error: 'You have already applied for this position' });
        return;
      }

      const id = uuid();
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO job_applications (
          id, job_id, full_name, email, phone, location, linkedin_url, portfolio_url,
          resume_data, resume_filename, cover_letter, experience_years, current_role,
          expected_salary, referral_source, answers, stage, rating, notes, tags,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'applied', 0, '[]', '[]', ?, ?)
      `).run(
        id, jobId, fullName, email.toLowerCase().trim(),
        phone || null, location || null, linkedinUrl || null, portfolioUrl || null,
        resumeData || null, resumeFilename || null, coverLetter || null,
        experienceYears || 0, currentRole || null,
        expectedSalary || null, referralSource || null,
        answers ? JSON.stringify(answers) : null,
        now, now,
      );

      // Increment application count
      db.prepare('UPDATE job_listings SET applications_count = applications_count + 1 WHERE id = ?').run(jobId);

      deps.auditTrail.record('hr', 'application_received', fullName, { jobId, jobTitle: job.title, email });
      deps.logger.info(`[HR] Application: ${fullName} (${email}) for ${job.title}`);

      res.status(201).json({
        applicationId: id,
        message: `Thank you for applying, ${fullName.split(' ')[0]}! We've received your application for ${job.title}. We'll review it and get back to you within 5-7 business days.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.logger.error(`[HR] Application error: ${msg}`);
      res.status(500).json({ error: 'Failed to submit application' });
    }
  });

  // ── Check Application Status (Public, by email) ──
  router.get('/api/careers/status', (req: Request, res: Response) => {
    const email = (req.query.email as string || '').toLowerCase().trim();
    if (!email) { res.status(400).json({ error: 'Email required' }); return; }

    const apps = db.prepare(`
      SELECT a.id, a.stage, a.created_at, a.updated_at, j.title as job_title, j.department
      FROM job_applications a
      JOIN job_listings j ON j.id = a.job_id
      WHERE a.email = ?
      ORDER BY a.created_at DESC
    `).all(email) as Array<Record<string, unknown>>;

    const stageLabels: Record<string, string> = {
      applied: 'Application Received',
      screening: 'Under Review',
      interview: 'Interview Stage',
      assessment: 'Assessment',
      offer: 'Offer Extended',
      hired: 'Hired!',
      rejected: 'Not Selected',
    };

    res.json({
      applications: apps.map(a => ({
        id: a.id,
        jobTitle: a.job_title,
        department: a.department,
        stage: a.stage,
        stageLabel: stageLabels[a.stage as string] || a.stage,
        appliedAt: a.created_at,
        lastUpdated: a.updated_at,
      })),
    });
  });

  // ═══════════════════════════════════════════════
  // ADMIN ENDPOINTS
  // ═══════════════════════════════════════════════

  // ── HR Dashboard Stats ──
  router.get('/api/hr/stats', authenticate, requireRole('owner', 'partner_admin'), (_req: Request, res: Response) => {
    const openPositions = (db.prepare("SELECT COUNT(*) as c FROM job_listings WHERE status = 'published'").get() as { c: number }).c;
    const totalListings = (db.prepare('SELECT COUNT(*) as c FROM job_listings').get() as { c: number }).c;
    const totalApplications = (db.prepare('SELECT COUNT(*) as c FROM job_applications').get() as { c: number }).c;
    const newThisWeek = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE created_at >= datetime('now', '-7 days')").get() as { c: number }).c;
    const inPipeline = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE stage NOT IN ('hired', 'rejected')").get() as { c: number }).c;
    const hired = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE stage = 'hired'").get() as { c: number }).c;
    const rejected = (db.prepare("SELECT COUNT(*) as c FROM job_applications WHERE stage = 'rejected'").get() as { c: number }).c;

    // Pipeline breakdown
    const pipeline = db.prepare(`
      SELECT stage, COUNT(*) as count FROM job_applications
      WHERE stage NOT IN ('hired', 'rejected')
      GROUP BY stage ORDER BY
        CASE stage WHEN 'applied' THEN 1 WHEN 'screening' THEN 2 WHEN 'interview' THEN 3
        WHEN 'assessment' THEN 4 WHEN 'offer' THEN 5 END
    `).all() as Array<{ stage: string; count: number }>;

    // By department
    const byDepartment = db.prepare(`
      SELECT j.department, COUNT(a.id) as applications,
        COUNT(CASE WHEN a.stage NOT IN ('hired','rejected') THEN 1 END) as active
      FROM job_listings j
      LEFT JOIN job_applications a ON a.job_id = j.id
      WHERE j.status = 'published'
      GROUP BY j.department
    `).all() as Array<Record<string, unknown>>;

    // Recent applications
    const recent = db.prepare(`
      SELECT a.id, a.full_name, a.email, a.stage, a.rating, a.created_at,
             j.title as job_title, j.department
      FROM job_applications a
      JOIN job_listings j ON j.id = a.job_id
      ORDER BY a.created_at DESC LIMIT 20
    `).all() as Array<Record<string, unknown>>;

    // Upcoming interviews
    const interviews = db.prepare(`
      SELECT i.*, a.full_name, a.email, j.title as job_title
      FROM interview_schedules i
      JOIN job_applications a ON a.id = i.application_id
      JOIN job_listings j ON j.id = a.job_id
      WHERE i.completed = 0 AND i.scheduled_at >= datetime('now')
      ORDER BY i.scheduled_at ASC LIMIT 10
    `).all() as Array<Record<string, unknown>>;

    res.json({
      openPositions, totalListings, totalApplications, newThisWeek,
      inPipeline, hired, rejected, pipeline, byDepartment, recent, interviews,
    });
  });

  // ── CRUD Job Listings ──
  router.get('/api/hr/jobs', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const status = req.query.status as string || '';
    let query = 'SELECT * FROM job_listings';
    const params: unknown[] = [];
    if (status) { query += ' WHERE status = ?'; params.push(status); }
    query += ' ORDER BY created_at DESC';
    const jobs = db.prepare(query).all(...params);
    res.json({ jobs });
  });

  router.post('/api/hr/jobs', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const {
      title, department, type, location, remoteOk, salaryMin, salaryMax,
      salaryCurrency, description, requirements, benefits, positions, priority, closesAt,
    } = req.body;

    if (!title || !department || !description) {
      res.status(400).json({ error: 'title, department, and description are required' });
      return;
    }

    const id = uuid();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO job_listings (
        id, title, department, type, location, remote_ok, salary_min, salary_max,
        salary_currency, description, requirements, benefits, positions, priority,
        status, created_by, closes_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `).run(
      id, title, department, type || 'full-time', location || 'Lagos, Nigeria',
      remoteOk ? 1 : 0, salaryMin || null, salaryMax || null,
      salaryCurrency || 'NGN', description,
      requirements ? JSON.stringify(requirements) : null,
      benefits ? JSON.stringify(benefits) : null,
      positions || 1, priority || 'normal',
      req.auth!.userId, closesAt || null, now, now,
    );

    deps.logger.info(`[HR] Job created: ${title} (${department})`);
    res.status(201).json({ id, title, status: 'draft' });
  });

  router.put('/api/hr/jobs/:id', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const now = new Date().toISOString();
    const fields = req.body;
    const updates: string[] = [];
    const params: unknown[] = [];

    const allowed = ['title', 'department', 'type', 'location', 'description', 'positions', 'priority', 'closes_at'];
    for (const key of allowed) {
      if (fields[key] !== undefined) {
        updates.push(`${key} = ?`);
        params.push(fields[key]);
      }
    }
    if (fields.remoteOk !== undefined) { updates.push('remote_ok = ?'); params.push(fields.remoteOk ? 1 : 0); }
    if (fields.salaryMin !== undefined) { updates.push('salary_min = ?'); params.push(fields.salaryMin); }
    if (fields.salaryMax !== undefined) { updates.push('salary_max = ?'); params.push(fields.salaryMax); }
    if (fields.salaryCurrency !== undefined) { updates.push('salary_currency = ?'); params.push(fields.salaryCurrency); }
    if (fields.requirements !== undefined) { updates.push('requirements = ?'); params.push(JSON.stringify(fields.requirements)); }
    if (fields.benefits !== undefined) { updates.push('benefits = ?'); params.push(JSON.stringify(fields.benefits)); }

    if (updates.length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
    updates.push('updated_at = ?');
    params.push(now, jobId);
    db.prepare(`UPDATE job_listings SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ success: true });
  });

  // ── Publish / Unpublish / Close Job ──
  router.put('/api/hr/jobs/:id/status', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const { status } = req.body;
    if (!['draft', 'published', 'closed', 'archived'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }
    const now = new Date().toISOString();
    const extra = status === 'published' ? ', published_at = ?' : '';
    const params = status === 'published' ? [status, now, now, jobId] : [status, now, jobId];
    db.prepare(`UPDATE job_listings SET status = ?, updated_at = ?${extra} WHERE id = ?`).run(...params);
    deps.logger.info(`[HR] Job ${jobId} status → ${status}`);
    res.json({ success: true, status });
  });

  // ── Get Applications for a Job ──
  router.get('/api/hr/jobs/:id/applications', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const jobId = String(req.params.id);
    const stage = req.query.stage as string || '';
    let query = 'SELECT * FROM job_applications WHERE job_id = ?';
    const params: unknown[] = [jobId];
    if (stage) { query += ' AND stage = ?'; params.push(stage); }
    query += ' ORDER BY created_at DESC';
    const apps = db.prepare(query).all(...params);
    res.json({ applications: apps });
  });

  // ── Get All Applications (pipeline view) ──
  router.get('/api/hr/applications', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const stage = req.query.stage as string || '';
    const search = (req.query.search as string || '').trim();
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;

    let query = `
      SELECT a.*, j.title as job_title, j.department
      FROM job_applications a
      JOIN job_listings j ON j.id = a.job_id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (stage) { query += ' AND a.stage = ?'; params.push(stage); }
    if (search) {
      query += ' AND (a.full_name LIKE ? OR a.email LIKE ? OR j.title LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const countQuery = query.replace('SELECT a.*, j.title as job_title, j.department', 'SELECT COUNT(*) as c');
    const total = (db.prepare(countQuery).get(...params) as { c: number }).c;

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);
    const applications = db.prepare(query).all(...params);

    res.json({ applications, total, limit, offset });
  });

  // ── Get Single Application ──
  router.get('/api/hr/applications/:id', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const app = db.prepare(`
      SELECT a.*, j.title as job_title, j.department, j.type as job_type
      FROM job_applications a
      JOIN job_listings j ON j.id = a.job_id
      WHERE a.id = ?
    `).get(String(req.params.id)) as Record<string, unknown> | undefined;
    if (!app) { res.status(404).json({ error: 'Application not found' }); return; }

    // Get interviews
    const interviews = db.prepare(
      'SELECT * FROM interview_schedules WHERE application_id = ? ORDER BY scheduled_at DESC'
    ).all(app.id) as Array<Record<string, unknown>>;

    res.json({
      ...app,
      notes: JSON.parse(app.notes as string || '[]'),
      tags: JSON.parse(app.tags as string || '[]'),
      interviews,
    });
  });

  // ── Move Application Through Pipeline ──
  router.put('/api/hr/applications/:id/stage', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const appId = String(req.params.id);
    const { stage, rejectionReason } = req.body;
    if (!PIPELINE_STAGES.includes(stage)) {
      res.status(400).json({ error: 'Invalid stage', validStages: PIPELINE_STAGES });
      return;
    }

    const now = new Date().toISOString();
    const app = db.prepare('SELECT * FROM job_applications WHERE id = ?').get(appId) as Record<string, unknown> | undefined;
    if (!app) { res.status(404).json({ error: 'Application not found' }); return; }

    db.prepare('UPDATE job_applications SET stage = ?, rejection_reason = ?, updated_at = ? WHERE id = ?')
      .run(stage, stage === 'rejected' ? (rejectionReason || null) : app.rejection_reason, now, appId);

    // Update hired count on job if hired
    if (stage === 'hired') {
      db.prepare('UPDATE job_listings SET hired_count = hired_count + 1 WHERE id = ?').run(app.job_id);
    }

    deps.auditTrail.record('hr', `application_${stage}`, app.full_name as string, {
      appId, jobId: app.job_id, stage,
    });

    res.json({ success: true, stage });
  });

  // ── Rate Application ──
  router.put('/api/hr/applications/:id/rate', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const rating = Math.max(0, Math.min(5, Number(req.body.rating) || 0));
    db.prepare('UPDATE job_applications SET rating = ?, updated_at = ? WHERE id = ?')
      .run(rating, new Date().toISOString(), String(req.params.id));
    res.json({ success: true, rating });
  });

  // ── Add Note to Application ──
  router.post('/api/hr/applications/:id/notes', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const appId = String(req.params.id);
    const { text } = req.body;
    if (!text) { res.status(400).json({ error: 'Note text required' }); return; }

    const app = db.prepare('SELECT notes FROM job_applications WHERE id = ?').get(appId) as { notes: string } | undefined;
    if (!app) { res.status(404).json({ error: 'Application not found' }); return; }

    const notes = JSON.parse(app.notes || '[]');
    notes.push({
      id: uuid(),
      text,
      author: req.auth!.userId,
      createdAt: new Date().toISOString(),
    });

    db.prepare('UPDATE job_applications SET notes = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(notes), new Date().toISOString(), appId);
    res.json({ success: true, notes });
  });

  // ── Schedule Interview ──
  router.post('/api/hr/applications/:id/interview', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const appId = String(req.params.id);
    const { type, scheduledAt, duration, interviewer, location, notes } = req.body;
    if (!scheduledAt) { res.status(400).json({ error: 'scheduledAt is required' }); return; }

    const id = uuid();
    db.prepare(`
      INSERT INTO interview_schedules (id, application_id, interview_type, scheduled_at, duration_minutes, interviewer, location, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, appId, type || 'phone', scheduledAt, duration || 30, interviewer || null, location || null, notes || null, new Date().toISOString());

    // Move to interview stage if still at screening
    db.prepare("UPDATE job_applications SET stage = 'interview', updated_at = ? WHERE id = ? AND stage IN ('applied', 'screening')")
      .run(new Date().toISOString(), appId);

    res.status(201).json({ id, success: true });
  });

  // ── Complete Interview ──
  router.put('/api/hr/interviews/:id/complete', authenticate, requireRole('owner', 'partner_admin'), (req: Request, res: Response) => {
    const { outcome, score, notes } = req.body;
    db.prepare('UPDATE interview_schedules SET completed = 1, outcome = ?, score = ?, notes = ? WHERE id = ?')
      .run(outcome || null, score || null, notes || null, String(req.params.id));
    res.json({ success: true });
  });

  // ── Make Offer ──
  router.post('/api/hr/applications/:id/offer', authenticate, requireRole('owner'), (req: Request, res: Response) => {
    const appId = String(req.params.id);
    const { amount } = req.body;
    const now = new Date().toISOString();

    db.prepare("UPDATE job_applications SET stage = 'offer', offer_amount = ?, updated_at = ? WHERE id = ?")
      .run(amount || null, now, appId);

    deps.auditTrail.record('hr', 'offer_extended', appId, { amount });
    res.json({ success: true, stage: 'offer' });
  });

  return router;
}
