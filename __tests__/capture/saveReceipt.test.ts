import { openTestDriver } from '../support/sqlite-driver';

import type { ParsedItem, ParsedReceipt } from '@/capture/parseContract';
import { saveReviewedReceipt, toNewBillInput } from '@/capture/saveReceipt';
import type { SqlDriver } from '@/data/driver';
import { getBill, getReceiptScans } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const item = (overrides: Partial<ParsedItem> = {}): ParsedItem => ({
  name: 'Anchor Milk 2L',
  name_local: null,
  category: 'dairy',
  is_food: true,
  qty: 1,
  unit: 'pack',
  scan_units: 1,
  price_cents: 604,
  unit_price_cents: null,
  barcode: null,
  confidence: 'high',
  ...overrides,
});

const receipt = (items: ParsedItem[], overrides: Partial<ParsedReceipt> = {}): ParsedReceipt => ({
  merchant: "PAK'nSAVE Mill Street",
  merchant_address: '17 Mill Street, Hamilton',
  purchased_at: '2026-07-05',
  purchased_time: '12:44',
  currency: 'NZD',
  total_cents: items.reduce((sum, i) => sum + (i.price_cents ?? 0), 0),
  discount_cents: 0,
  units_sold: null,
  itemless: items.length === 0,
  items,
  ...overrides,
});

const reviewed = (r: ParsedReceipt, overrides = {}) => ({
  receipt: r,
  correctedIndices: new Set<number>(),
  excludedIndices: new Set<number>(),
  capturePath: 'scanner' as const,
  modelAlias: 'gemini-3.6-flash',
  ocrPages: ['MILK 6.04\nTOTAL 6.04'],
  ...overrides,
});

describe('saveReviewedReceipt (§5.1 single transaction)', () => {
  it('stores the bill, its items and the cached OCR text together', async () => {
    const id = await saveReviewedReceipt(db, reviewed(receipt([item()])));
    const bill = await getBill(db, id);

    expect(bill!.merchant).toBe("PAK'nSAVE Mill Street");
    expect(bill!.source).toBe('receipt');
    expect(bill!.capturePath).toBe('scanner');
    expect(bill!.modelAlias).toBe('gemini-3.6-flash');
    expect(bill!.items).toHaveLength(1);
    expect(await getReceiptScans(db, id)).toEqual(['MILK 6.04\nTOTAL 6.04']);
  });

  it('derives merchant_norm through the repository (§4.8)', async () => {
    const id = await saveReviewedReceipt(db, reviewed(receipt([item()])));
    expect((await getBill(db, id))!.merchantNorm).toBe('paknsave mill street');
  });

  it('marks only the lines the user edited as corrected (§5.6)', async () => {
    const id = await saveReviewedReceipt(
      db,
      reviewed(receipt([item(), item({ name: 'Bread' })]), {
        correctedIndices: new Set([1]),
      })
    );

    const items = (await getBill(db, id))!.items;
    expect(items[0].userCorrected).toBe(false);
    expect(items[1].userCorrected).toBe(true);
  });

  it('leaves excluded lines out entirely', async () => {
    const id = await saveReviewedReceipt(
      db,
      reviewed(receipt([item(), item({ name: 'Bread' }), item({ name: 'Cheese' })]), {
        excludedIndices: new Set([1]),
      })
    );

    const items = (await getBill(db, id))!.items;
    expect(items.map((i) => i.name)).toEqual(['Anchor Milk 2L', 'Cheese']);
    // Line numbers are re-sequenced, so the stored order stays contiguous.
    expect(items.map((i) => i.lineNo)).toEqual([1, 2]);
  });

  it('stores an itemless bill with its total and no lines (§5.1)', async () => {
    const id = await saveReviewedReceipt(
      db,
      reviewed(
        receipt([], { merchant: 'TAIER CBD', total_cents: 15140, itemless: true }),
        { capturePath: 'gallery' }
      )
    );

    const bill = await getBill(db, id);
    expect(bill!.items).toEqual([]);
    expect(bill!.totalCents).toBe(15140);
    expect(bill!.parseFlags).toEqual([]);
  });

  it('recomputes flags from what is stored, not from the parse (§4.11)', async () => {
    // The user removed a line during review, so the remaining items no longer
    // sum to the printed total. The flag must describe the saved state.
    const id = await saveReviewedReceipt(
      db,
      reviewed(receipt([item({ price_cents: 500 }), item({ price_cents: 500 })]), {
        excludedIndices: new Set([1]),
      })
    );

    expect((await getBill(db, id))!.parseFlags).toContain('sum_mismatch');
  });

  it('writes nothing when the bill is invalid — no orphaned scans', async () => {
    await expect(
      saveReviewedReceipt(
        db,
        reviewed(receipt([item()], { purchased_at: '2026-02-30' }))
      )
    ).rejects.toThrow();

    expect(await db.all('SELECT * FROM bills')).toHaveLength(0);
    expect(await db.all('SELECT * FROM receipt_scans')).toHaveLength(0);
    expect(await db.all('SELECT * FROM bill_items')).toHaveLength(0);
  });

  it('keeps multi-page OCR text in capture order (§5.2)', async () => {
    const id = await saveReviewedReceipt(
      db,
      reviewed(receipt([item()]), { ocrPages: ['page one', 'page two'] })
    );
    expect(await getReceiptScans(db, id)).toEqual(['page one', 'page two']);
  });
});

describe('toNewBillInput', () => {
  it('converts the model contract to domain fields', () => {
    const input = toNewBillInput(reviewed(receipt([item({ name_local: '牛奶' })])));

    expect(input.source).toBe('receipt');
    expect(input.merchantAddress).toBe('17 Mill Street, Hamilton');
    expect(input.purchasedTime).toBe('12:44');
    expect(input.items?.[0].nameLocal).toBe('牛奶');
    expect(input.items?.[0].scanUnits).toBe(1);
  });
});
