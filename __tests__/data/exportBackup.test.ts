/**
 * The backup format (§15.1).
 *
 * This file is a promise: an export written today has to restore into a build
 * written later, which makes the shape harder to change than ordinary code
 * and worth pinning. The other half is the CSV quoting, which fails silently
 * -- a merchant name with a comma in it does not throw, it just produces a
 * spreadsheet with the columns shifted one to the right.
 */

import {
  EXPORT_SCHEMA_VERSION,
  billsCsv,
  buildBackup,
  exportFilename,
  itemsCsv,
  toBackupBill,
  type BackupBill,
} from '@/data/exportBackup';
import type { BillWithItems } from '@/types/ledger';

const bill = (over: Partial<BillWithItems> = {}): BillWithItems => ({
  id: 7,
  merchant: 'New World Rototuna',
  merchantNorm: 'new world rototuna',
  merchantAddress: '5 Rototuna Blvd',
  purchasedAt: '2026-09-10',
  purchasedTime: '17:42',
  totalCents: 1234,
  discountCents: 0,
  currency: 'NZD',
  unitsSold: 2,
  source: 'receipt',
  capturePath: 'scanner',
  parseFlags: ['low_confidence'],
  createdAt: '2026-09-10T05:42:00Z',
  updatedAt: '2026-09-10T05:42:00Z',
  pageCount: 1,
  modelAlias: 'gemini-3.6-flash',
  reviewedAt: '2026-09-11T02:00:00Z',
  reviewedFlags: ['low_confidence'],
  items: [
    {
      id: 1, billId: 7, lineNo: 1, name: 'Milk', nameLocal: null,
      category: 'dairy', isFood: true, qty: 2, unit: 'l', scanUnits: 1,
      priceCents: 700, unitPriceCents: 350, barcode: '09403142001514',
      confidence: 'high', userCorrected: false, rawText: 'MILK 2L      7.00',
    },
    {
      id: 2, billId: 7, lineNo: 2, name: 'Bread', nameLocal: null,
      category: 'bakery', isFood: true, qty: 1, unit: 'pc', scanUnits: 1,
      priceCents: null, unitPriceCents: null, barcode: null, confidence: 'low',
      userCorrected: true, rawText: null,
    },
  ],
  ...over,
});

const backupBill = (over: Partial<BillWithItems> = {}): BackupBill =>
  toBackupBill(bill(over), ['NEW WORLD\nMILK 2L 7.00']);

describe('the backup envelope', () => {
  it('states the schema version it was written against', () => {
    const made = buildBackup([], {}, new Date('2026-09-28T03:00:00Z'));

    expect(made.schema_version).toBe(EXPORT_SCHEMA_VERSION);
    expect(made.exported_at).toBe('2026-09-28T03:00:00.000Z');
  });

  it('carries the preferences beside the bills', () => {
    const made = buildBackup([backupBill()], { 'privacy.mapPreviews': false });

    expect(made.bills).toHaveLength(1);
    expect(made.preferences).toEqual({ 'privacy.mapPreviews': false });
  });

  /** Copies, so a later mutation of the ledger cannot reach a written file. */
  it('does not alias the arrays it was handed', () => {
    const bills = [backupBill()];
    const made = buildBackup(bills, {});

    bills.length = 0;
    expect(made.bills).toHaveLength(1);
  });
});

describe('what a bill exports as', () => {
  /**
   * The three the spec names explicitly, because each looks redundant and
   * none is. A dropped `scanUnits` breaks §4.9's reconciliation the next time
   * anything recomputes it.
   */
  it('keeps name_local, scan_units and unit_price_cents', () => {
    const [milk] = backupBill().items;

    expect(milk).toMatchObject({ nameLocal: null, scanUnits: 1, unitPriceCents: 350 });
  });

  /** NULL is illegible and 0 is free (§4.3); an export must not confuse them. */
  it('keeps a null price null', () => {
    const [, bread] = backupBill().items;

    expect(bread.priceCents).toBeNull();
    expect(bread.unitPriceCents).toBeNull();
  });

  it('keeps the OCR pages, in order', () => {
    expect(toBackupBill(bill(), ['page one', 'page two']).pages).toEqual(['page one', 'page two']);
  });

  /** Provenance and human review both survive a round trip, or a restore lies. */
  it('keeps the raw receipt line and whether a person corrected it', () => {
    const [milk, bread] = backupBill().items;

    expect(milk).toMatchObject({ userCorrected: false, rawText: 'MILK 2L      7.00' });
    expect(bread).toMatchObject({ userCorrected: true, rawText: null });
  });

  it('keeps the integrity flags', () => {
    expect(backupBill().parseFlags).toEqual(['low_confidence']);
  });

  /**
   * The only thing in a backup that cannot be recomputed from the receipt.
   * Lose it and a restore silently reverts every reviewed bill to unreviewed,
   * discarding work somebody did by hand.
   */
  it('keeps the human review record', () => {
    expect(backupBill()).toMatchObject({
      reviewedAt: '2026-09-11T02:00:00Z',
      reviewedFlags: ['low_confidence'],
    });
  });

  it('keeps which model read the receipt', () => {
    expect(backupBill().modelAlias).toBe('gemini-3.6-flash');
  });
});

describe('the spreadsheet formats', () => {
  it('writes one row per item, with the bill repeated onto each', () => {
    const lines = itemsCsv([backupBill()]).trim().split('\n');

    expect(lines).toHaveLength(3); // header + two items
    expect(lines[0]).toContain('scan_units');
    expect(lines[1]).toContain('Milk');
    expect(lines[2]).toContain('Bread');
  });

  it('writes one row per bill', () => {
    const lines = billsCsv([backupBill(), backupBill({ id: 8 })]).trim().split('\n');

    expect(lines).toHaveLength(3); // header + two bills
    expect(lines[1]).toContain('New World Rototuna');
  });

  /**
   * The failure that does not announce itself. A comma in a merchant name
   * shifts every later column by one, and the result looks like bad data
   * rather than a bad exporter.
   */
  it('quotes a field containing a comma', () => {
    const row = billsCsv([backupBill({ merchant: 'Smith, Grocer' })]).split('\n')[1];

    expect(row).toContain('"Smith, Grocer"');
  });

  it('doubles a quote inside a field', () => {
    const row = billsCsv([backupBill({ merchant: 'The "Big" Shop' })]).split('\n')[1];

    expect(row).toContain('"The ""Big"" Shop"');
  });

  /** OCR text runs to several lines; a raw newline would end the row early. */
  it('quotes a field containing a newline', () => {
    const row = itemsCsv([backupBill()]).split('\n')[1];

    expect(row.startsWith('7,2026-09-10,New World Rototuna')).toBe(true);
  });

  it('writes an empty field for null, not the word null', () => {
    const row = itemsCsv([backupBill()]).trim().split('\n')[2];

    expect(row).not.toContain('null');
    expect(row).toContain(',,');
  });

  it('writes a header even with nothing to report', () => {
    expect(itemsCsv([]).trim().split('\n')).toHaveLength(1);
  });
});

describe('what the file is called', () => {
  const day = new Date('2026-09-28T22:00:00Z');

  it.each([
    ['json', 'yourintelliledger-export-2026-09-28.json'],
    ['items', 'yourintelliledger-export-2026-09-28-items.csv'],
    ['bills', 'yourintelliledger-export-2026-09-28-bills.csv'],
  ] as const)('names the %s export', (kind, expected) => {
    expect(exportFilename(kind, day)).toBe(expected);
  });
});
