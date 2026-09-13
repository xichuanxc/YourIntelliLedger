import { expectRejection } from '../support/expectRejection';
import { openTestDriver } from '../support/sqlite-driver';

import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';
import { MIGRATIONS, SCHEMA_VERSION, type Migration } from '@/data/migrations';

async function userVersion(db: SqlDriver): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row!.user_version;
}

async function tableNames(db: SqlDriver): Promise<string[]> {
  const rows = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  return rows.map((row) => row.name);
}

describe('migrate (spec §4.12)', () => {
  let db: SqlDriver;

  beforeEach(() => {
    db = openTestDriver();
  });

  afterEach(async () => {
    await db.close();
  });

  it('brings an empty database up to the current schema version', async () => {
    const report = await migrate(db);

    // Derived from the registry, not written out: a literal here has to be
    // edited by every future migration, which makes an unrelated schema change
    // look like a broken test.
    expect(report).toEqual({
      from: 0,
      to: SCHEMA_VERSION,
      applied: MIGRATIONS.map((migration) => migration.version),
    });
    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
    // Listed rather than derived: a new table is a deliberate act, and this
    // assertion is where an accidental one gets noticed.
    expect(await tableNames(db)).toEqual([
      'ask_messages',
      'asked_questions',
      'bill_items',
      'bills',
      'query_log',
      'receipt_scans',
    ]);
  });

  it('is idempotent — a second run applies nothing', async () => {
    await migrate(db);
    const second = await migrate(db);

    expect(second.applied).toEqual([]);
    expect(second.from).toBe(SCHEMA_VERSION);
  });

  it('applies only the migrations a partially-migrated database is missing', async () => {
    const next: Migration = {
      version: SCHEMA_VERSION + 1,
      name: 'test-only follow-up',
      sql: 'CREATE TABLE later (id INTEGER PRIMARY KEY)',
    };

    await migrate(db, MIGRATIONS);
    const report = await migrate(db, [...MIGRATIONS, next]);

    expect(report).toEqual({
      from: SCHEMA_VERSION,
      to: next.version,
      applied: [next.version],
    });
    expect(await tableNames(db)).toContain('later');
  });

  it('rolls back a failing migration and leaves the version where it was', async () => {
    const broken: Migration = {
      version: SCHEMA_VERSION + 1,
      name: 'test-only broken migration',
      sql: `CREATE TABLE half_applied (id INTEGER PRIMARY KEY);
            CREATE TABLE bills (nope INTEGER);`, // bills already exists
    };

    await migrate(db, MIGRATIONS);
    await expectRejection(() => migrate(db, [...MIGRATIONS, broken]));

    // The point of the per-migration transaction: no half-applied state.
    expect(await userVersion(db)).toBe(SCHEMA_VERSION);
    expect(await tableNames(db)).not.toContain('half_applied');
  });

  it('refuses to run against a database written by a newer build', async () => {
    await migrate(db);
    await db.exec('PRAGMA user_version = 99');

    await expectRejection(() => migrate(db), { message: /only knows up to/ });
  });

  it('rejects a migration list with a gap or duplicate', async () => {
    // Two past the end, so it stays a gap however many migrations ship.
    const gap: Migration = { version: SCHEMA_VERSION + 2, name: 'gap', sql: 'SELECT 1' };
    await expectRejection(() => migrate(db, [...MIGRATIONS, gap]), { message: /contiguous/ });
  });

  it('keeps the shipped migration list contiguous from 1', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(
      MIGRATIONS.map((_, index) => index + 1)
    );
  });
});

describe('schema 001 constraints (spec §4.4, §4.7)', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = openTestDriver();
    await migrate(db);
  });

  afterEach(async () => {
    await db.close();
  });

  const insertBill = (source = 'manual', capturePath: string | null = null) =>
    db.run(
      `INSERT INTO bills (purchased_at, source, capture_path, created_at, updated_at)
       VALUES ('2026-07-19', ?, ?, '2026-07-19T00:00:00.000Z', '2026-07-19T00:00:00.000Z')`,
      [source, capturePath]
    );

  it('rejects a value outside a closed vocabulary rather than storing it', async () => {
    await expectRejection(() => insertBill('imported'));
  });

  it('accepts a NULL capture_path for a manual bill', async () => {
    // NULL passes `CHECK (capture_path IN (...))` — a manual bill had no capture.
    const result = await insertBill('manual', null);
    expect(result.lastInsertRowId).toBeGreaterThan(0);
  });

  it('rejects an unknown category on a line item', async () => {
    const bill = await insertBill();
    await expectRejection(() =>
      db.run(
        `INSERT INTO bill_items (bill_id, line_no, name, category) VALUES (?, 1, 'x', 'vegetables')`,
        [bill.lastInsertRowId]
      )
    );
  });

  it('cascades line items and cached OCR text when a bill is deleted', async () => {
    const bill = await insertBill();
    const billId = bill.lastInsertRowId;
    await db.run(
      `INSERT INTO bill_items (bill_id, line_no, name, category) VALUES (?, 1, 'milk', 'dairy')`,
      [billId]
    );
    await db.run(`INSERT INTO receipt_scans (bill_id, page_no, ocr_text) VALUES (?, 1, 'raw')`, [
      billId,
    ]);

    await db.run('DELETE FROM bills WHERE id = ?', [billId]);

    expect(await db.all('SELECT * FROM bill_items WHERE bill_id = ?', [billId])).toHaveLength(0);
    expect(await db.all('SELECT * FROM receipt_scans WHERE bill_id = ?', [billId])).toHaveLength(0);
  });

  it('rejects a line item whose bill does not exist', async () => {
    await expectRejection(() => db.run(`INSERT INTO bill_items (bill_id, line_no, name, category) VALUES (9999, 1, 'x', 'other')`));
  });
});
