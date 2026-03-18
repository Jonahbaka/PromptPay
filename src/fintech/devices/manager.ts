import type Database from "better-sqlite3";

/**
 * Device Management Module
 *
 * Tracks POS device inventory, assignments to agents,
 * financing terms, deposits, and recovery status.
 */

export interface DeviceModelInput {
  name: string;
  manufacturer?: string;
  modelNumber?: string;
  deviceType?: "pos" | "mpos" | "phone" | "tablet";
  retailPriceMinor?: number;
}

export interface DeviceInput {
  modelId: string;
  serialNumber: string;
  providerId?: string;
  metadata?: Record<string, unknown>;
}

export interface AssignmentInput {
  deviceId: string;
  agentId: string;
  tenantId?: string;
  depositAmountMinor?: number;
  financingTerms?: Record<string, unknown>;
}

export class DeviceManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ─── Device Models ───

  createModel(input: DeviceModelInput): string {
    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO device_models (id, name, manufacturer, model_number, device_type, retail_price_minor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, input.name, input.manufacturer || null, input.modelNumber || null, input.deviceType || "pos", input.retailPriceMinor || null);
    return id;
  }

  listModels(): any[] {
    return this.db.prepare("SELECT * FROM device_models ORDER BY name").all();
  }

  // ─── Devices ───

  registerDevice(input: DeviceInput): string {
    const id = this.generateId();
    this.db.prepare(`
      INSERT INTO devices (id, model_id, serial_number, provider_id, status, metadata)
      VALUES (?, ?, ?, ?, 'in_stock', ?)
    `).run(id, input.modelId, input.serialNumber, input.providerId || null, JSON.stringify(input.metadata || {}));
    return id;
  }

  getDevice(id: string): any | null {
    return this.db.prepare(`
      SELECT d.*, dm.name as model_name, dm.manufacturer, dm.device_type
      FROM devices d
      LEFT JOIN device_models dm ON d.model_id = dm.id
      WHERE d.id = ?
    `).get(id) || null;
  }

  getBySerial(serialNumber: string): any | null {
    return this.db.prepare(`
      SELECT d.*, dm.name as model_name, dm.manufacturer, dm.device_type
      FROM devices d
      LEFT JOIN device_models dm ON d.model_id = dm.id
      WHERE d.serial_number = ?
    `).get(serialNumber) || null;
  }

  updateDeviceStatus(id: string, status: string): void {
    this.db.prepare("UPDATE devices SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  }

  listDevices(filters: { status?: string; providerId?: string; limit?: number }): any[] {
    const conditions: string[] = ["1=1"];
    const params: any[] = [];
    if (filters.status) { conditions.push("d.status = ?"); params.push(filters.status); }
    if (filters.providerId) { conditions.push("d.provider_id = ?"); params.push(filters.providerId); }
    params.push(filters.limit || 50);
    return this.db.prepare(`
      SELECT d.*, dm.name as model_name, dm.manufacturer
      FROM devices d LEFT JOIN device_models dm ON d.model_id = dm.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY d.created_at DESC LIMIT ?
    `).all(...params);
  }

  // ─── Assignments ───

  assignToAgent(input: AssignmentInput): string {
    const id = this.generateId();

    const assign = this.db.transaction(() => {
      // Create assignment
      this.db.prepare(`
        INSERT INTO device_assignments (id, device_id, agent_id, tenant_id, deposit_amount_minor, deposit_status, financing_terms, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active')
      `).run(
        id, input.deviceId, input.agentId, input.tenantId || null,
        input.depositAmountMinor || 0,
        input.depositAmountMinor ? "pending" : "waived",
        JSON.stringify(input.financingTerms || {})
      );

      // Update device status
      this.db.prepare("UPDATE devices SET status = 'assigned', updated_at = datetime('now') WHERE id = ?")
        .run(input.deviceId);
    });

    assign();
    return id;
  }

  returnDevice(assignmentId: string, reason?: string): void {
    const assignment = this.db.prepare("SELECT * FROM device_assignments WHERE id = ?").get(assignmentId) as any;
    if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);

    const returnTx = this.db.transaction(() => {
      this.db.prepare("UPDATE device_assignments SET status = 'returned', returned_at = datetime('now') WHERE id = ?")
        .run(assignmentId);
      this.db.prepare("UPDATE devices SET status = 'in_stock', updated_at = datetime('now') WHERE id = ?")
        .run(assignment.device_id);
    });

    returnTx();
  }

  reportLost(assignmentId: string): void {
    const assignment = this.db.prepare("SELECT * FROM device_assignments WHERE id = ?").get(assignmentId) as any;
    if (!assignment) throw new Error(`Assignment ${assignmentId} not found`);

    const report = this.db.transaction(() => {
      this.db.prepare("UPDATE device_assignments SET status = 'lost' WHERE id = ?").run(assignmentId);
      this.db.prepare("UPDATE devices SET status = 'lost', updated_at = datetime('now') WHERE id = ?")
        .run(assignment.device_id);
    });

    report();
  }

  getAgentDevices(agentId: string): any[] {
    return this.db.prepare(`
      SELECT da.*, d.serial_number, dm.name as model_name, dm.manufacturer
      FROM device_assignments da
      JOIN devices d ON da.device_id = d.id
      LEFT JOIN device_models dm ON d.model_id = dm.id
      WHERE da.agent_id = ? AND da.status = 'active'
      ORDER BY da.assigned_at DESC
    `).all(agentId);
  }

  getInventorySummary(): any {
    return this.db.prepare(`
      SELECT status, COUNT(*) as count
      FROM devices
      GROUP BY status
    `).all();
  }

  private generateId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
  }
}
