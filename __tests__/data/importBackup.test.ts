/**
 * Reading a backup back in (§15.1), against real SQLite.
 *
 * Two things are worth proving. That a ledger survives a round trip -- export,
 * wipe, import, and the same spending is there -- because that is the entire
 * claim the export makes. And that a bad file is refused whole: this is the
 * only place in the app where a document from outside becomes rows, and a
 * parser that gives up halfway leaves a ledger nobody can trust.
 */

import { openTestDriver } from '../support/sqlite-driver';

import type { SqlDriver } from '@/data/driver';
import { eraseEverything, type CacheClears } from '@/data/eraseAll';
import { buildBackup, toBackupBill } from '@/data/exportBackup';
import { BackupFormatError, parseBackup, restoreBackup } from '@/data/importBackup';
import { createBill, getBill, getReceiptScans, listBills } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';

let db: SqlDriver;

const noCaches: CacheClears = {
  preferences: () => {}, products: () => {}, geocodes: () => {},
  catalog: () => {}, hubConfig: () => {},
};

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const seed = (over: { merchant?: string; total?: number; date?: string } = {}) =>
  createBill(db, {
    merchant: over.merchant ?? "PAK'nSAVE Mill Street",
    merchantAddress: '10 Mill Street, Hamilton',
    purchasedAt: over.date ?? '2026-09-10',
    totalCents: over.total ?? 1250,
    currency: 'NZD',
    source: 'receipt',
    modelAlias: 'gemini-3.6-flash',
    ocrPages: ["PAK'nSAVE\nMILK 2L  7.50\nBREAD    5.00"],
    items: [
      { name: 'Milk', category: 'dairy', qty: 2, unit: 'l', priceCents: 750,
        unitPriceCents: 375, rawText: 'MILK 2L  7.50' },
      { name: 'Bread', category: 'bakery', qty: 1, unit: 'pc', priceCents: 500 },
    ],
  });

/** Everything in the ledger, as a backup document. */
async function exportAll(): Promise<string> {
  const summaries = await listBills(db);
  const bills = [];
  for (const summary of summaries) {
    const bill = await getBill(db, summary.id);
    bills.push(toBackupBill(bill!, await getReceiptScans(db, summary.id)));
  }
  return JSON.stringify(buildBackup(bills, { 'privacy.mapPreviews': false }));
}

describe('a round trip', () => {
  it('puts back what was taken out', async () => {
    await seed();
    const file = await exportAll();

    await eraseEverything(db, noCaches);
    expect(await listBills(db)).toEqual([]);

    const result = await restoreBackup(db, parseBackup(file));

    expect(result).toEqual({ imported: 1, skipped: 0 });
    const [restored] = await listBills(db);
    expect(restored.merchant).toBe("PAK'nSAVE Mill Street");
    expect(restored.totalCents).toBe(1250);
  });

  it('puts back the line items, with their prices and provenance', async () => {
    await seed();
    const file = await exportAll();
    await eraseEverything(db, noCaches);
    await restoreBackup(db, parseBackup(file));

    const [summary] = await listBills(db);
    const bill = await getBill(db, summary.id);

    expect(bill!.items).toHaveLength(2);
    expect(bill!.items[0]).toMatchObject({
      name: 'Milk', category: 'dairy', qty: 2, unit: 'l',
      priceCents: 750, unitPriceCents: 375, rawText: 'MILK 2L  7.50',
    });
  });

  /** §4.6: a receipt must never be stored without the text it was read from. */
  it('puts back the OCR pages', async () => {
    await seed();
    const file = await exportAll();
    await eraseEverything(db, noCaches);
    await restoreBackup(db, parseBackup(file));

    const [summary] = await listBills(db);
    expect((await getReceiptScans(db, summary.id))[0]).toContain('MILK 2L');
  });

  /** NULL is illegible and 0 is free (§4.3). A round trip must not blur them. */
  it('keeps an illegible price illegible', async () => {
    await createBill(db, {
      merchant: 'Wellmart', purchasedAt: '2026-09-01', totalCents: 400, source: 'receipt',
      items: [{ name: 'Smudged', category: 'other', qty: 1, unit: 'pc', priceCents: null }],
    });
    const file = await exportAll();
    await eraseEverything(db, noCaches);
    await restoreBackup(db, parseBackup(file));

    const [summary] = await listBills(db);
    expect((await getBill(db, summary.id))!.items[0].priceCents).toBeNull();
  });

  /**
   * The one thing a restore cannot recompute. Losing it silently marks every
   * reviewed bill as needing review again.
   */
  it('puts back the human review record', async () => {
    const billId = await seed();
    await db.run('UPDATE bills SET reviewed_at = ?, reviewed_flags = ? WHERE id = ?', [
      '2026-09-11T02:00:00Z', JSON.stringify(['low_confidence']), billId,
    ]);
    const file = await exportAll();
    await eraseEverything(db, noCaches);
    await restoreBackup(db, parseBackup(file));

    const [summary] = await listBills(db);
    const restored = await getBill(db, summary.id);
    expect(restored!.reviewedAt).toBe('2026-09-11T02:00:00Z');
    expect(restored!.reviewedFlags).toEqual(['low_confidence']);
  });
});

describe('importing the same file twice', () => {
  it('skips what is already there rather than duplicating it', async () => {
    await seed();
    const file = await exportAll();

    const again = await restoreBackup(db, parseBackup(file));

    expect(again).toEqual({ imported: 0, skipped: 1 });
    expect(await listBills(db)).toHaveLength(1);
  });

  it('still imports the bills that are new', async () => {
    await seed();
    const file = await exportAll();
    await seed({ merchant: 'New World', total: 999, date: '2026-09-12' });
    const bigger = await exportAll();

    await eraseEverything(db, noCaches);
    await restoreBackup(db, parseBackup(file));
    const second = await restoreBackup(db, parseBackup(bigger));

    expect(second).toEqual({ imported: 1, skipped: 1 });
    expect(await listBills(db)).toHaveLength(2);
  });
});

describe('a file that is not a backup', () => {
  it.each([
    ['not JSON at all', 'this is a receipt, not a file'],
    ['JSON but not an object', '[1, 2, 3]'],
    ['no bills', '{"schema_version":1}'],
  ])('refuses %s', (_why, text) => {
    expect(() => parseBackup(text)).toThrow(BackupFormatError);
  });

  /** A later format may mean something different by the same field name. */
  it('refuses a version it does not know, and says which', () => {
    expect(() => parseBackup('{"schema_version":99,"bills":[]}')).toThrow(/version 99/);
  });

  it('names the bill that is wrong, not just "invalid"', () => {
    const file = JSON.stringify({
      schema_version: 1,
      bills: [
        { purchasedAt: '2026-09-01', items: [] },
        { purchasedAt: '2026-09-02', items: [{ name: 'X', category: 'not_a_category' }] },
      ],
    });

    expect(() => parseBackup(file)).toThrow(/Bill 2, line 1/);
  });

  /**
   * The failure that matters most: a file wrong in its last bill must not
   * leave the earlier ones imported.
   */
  it('writes nothing at all when the file is bad', async () => {
    const file = JSON.stringify({
      schema_version: 1,
      bills: [
        { purchasedAt: '2026-09-01', totalCents: 100,
          items: [{ name: 'Fine', category: 'other', unit: 'pc' }] },
        { purchasedAt: '2026-09-02', totalCents: 200,
          items: [{ name: 'Broken', category: 'nonsense', unit: 'pc' }] },
      ],
    });

    expect(() => parseBackup(file)).toThrow(BackupFormatError);
    expect(await listBills(db)).toEqual([]);
  });

  it('accepts a backup with no bills in it', async () => {
    const empty = parseBackup('{"schema_version":1,"bills":[]}');
    expect(await restoreBackup(db, empty)).toEqual({ imported: 0, skipped: 0 });
  });
});
