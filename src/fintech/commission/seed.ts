import type Database from 'better-sqlite3';

/**
 * Seed the three default revenue share models:
 * 1. Digital API Partner (Paystack/Flutterwave): 20/60/10/10
 * 2. Super Agent POS (Moniepoint): 10/70/10/10
 * 3. Airtime/Data Reseller: 25/65/5/5
 */
export function seedDefaultCommissionRules(db: Database.Database): void {
  const existing = db.prepare('SELECT COUNT(*) as count FROM commission_rules').get() as any;
  if (existing.count > 0) return; // Already seeded

  const insert = db.prepare(`
    INSERT INTO commission_rules (
      id, name, priority, scope_type, scope_id, transaction_type, product_type, provider_id,
      platform_share_bps, agent_share_bps, supervisor_share_bps, tenant_share_bps,
      regional_share_bps, reserve_holdback_bps, is_active, version
    ) VALUES (
      lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, 1, 1
    )
  `);

  const seed = db.transaction(() => {
    // 1. Digital API Partner — Default for Paystack collections/transfers
    insert.run(
      'Digital API Partner Default', 500, 'system', null, 'collection', null, null,
      2000, 6000, 1000, 1000, 0, 0
    );
    insert.run(
      'Digital Transfer Default', 500, 'system', null, 'transfer', null, null,
      2000, 6000, 1000, 1000, 0, 0
    );

    // 2. Super Agent / POS Model
    insert.run(
      'POS Cash-In Default', 500, 'system', null, 'cash_in', null, null,
      1000, 7000, 1000, 1000, 0, 0
    );
    insert.run(
      'POS Cash-Out Default', 500, 'system', null, 'cash_out', null, null,
      1000, 7000, 1000, 1000, 0, 0
    );

    // 3. Airtime/Data Reseller
    insert.run(
      'Airtime Reseller Default', 500, 'system', null, 'airtime', null, null,
      2500, 6500, 500, 500, 0, 0
    );
    insert.run(
      'Data Reseller Default', 500, 'system', null, 'data', null, null,
      2500, 6500, 500, 500, 0, 0
    );

    // 4. Bill Payment
    insert.run(
      'Bill Pay Default', 500, 'system', null, 'bill_pay', null, null,
      2000, 6000, 1000, 1000, 0, 0
    );

    // 5. Payout/Settlement (platform keeps more, agent gets less — these are outflows)
    insert.run(
      'Payout Default', 500, 'system', null, 'payout', null, null,
      3000, 5000, 1000, 1000, 0, 0
    );
  });

  seed();
}
