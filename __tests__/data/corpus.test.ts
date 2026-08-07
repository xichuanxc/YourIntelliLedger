import { openTestDriver } from '../support/sqlite-driver';

import { CORPUS, seedCorpus } from '@/data/corpus';
import { isValidLocalDate, isValidLocalTime } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';
import { getCategoryBreakdown, getSpendSummary } from '@/data/insightsRepo';
import { countBills, getBill, getReceiptScans, listBills } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';
import { isCapturePath, isCategory, isConfidence, isSource, isUnit } from '@/types/vocabulary';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

/**
 * `scripts/build-receipt-corpus.js` is plain Node with no TypeScript runner, so
 * it duplicates the §4.7 vocabularies as string sets. These tests re-check the
 * committed fixture against the real ones, so that duplication cannot drift
 * silently — which is the whole risk of having copied them.
 */
describe('the committed corpus fixture', () => {
  it('carries the eleven prototype receipts', () => {
    expect(CORPUS.bills).toHaveLength(11);
    expect(CORPUS.schema_version).toBe(1);
  });

  it('uses only values from the real closed vocabularies (§4.7)', () => {
    for (const bill of CORPUS.bills) {
      expect(isSource(bill.source)).toBe(true);
      expect(isCapturePath(bill.capturePath)).toBe(true);

      for (const item of bill.items) {
        expect(isCategory(item.category)).toBe(true);
        expect(isUnit(item.unit)).toBe(true);
        if (item.confidence !== null) expect(isConfidence(item.confidence)).toBe(true);
      }
    }
  });

  it('has valid dates and times', () => {
    for (const bill of CORPUS.bills) {
      expect(isValidLocalDate(bill.purchasedAt)).toBe(true);
      if (bill.purchasedTime !== null) expect(isValidLocalTime(bill.purchasedTime)).toBe(true);
    }
  });

  it('keeps money as whole cents (§4.3)', () => {
    for (const bill of CORPUS.bills) {
      if (bill.totalCents !== null) expect(Number.isInteger(bill.totalCents)).toBe(true);
      expect(Number.isInteger(bill.discountCents)).toBe(true);
      for (const item of bill.items) {
        if (item.priceCents !== null) expect(Number.isInteger(item.priceCents)).toBe(true);
        if (item.unitPriceCents !== null) {
          expect(Number.isInteger(item.unitPriceCents)).toBe(true);
        }
      }
    }
  });

  it('includes a genuinely itemless bill — the §5.1 shape', () => {
    const itemless = CORPUS.bills.filter((bill) => bill.items.length === 0);
    expect(itemless).toHaveLength(1);
    expect(itemless[0].merchant).toBe('TAIER CBD');
    expect(itemless[0].totalCents).toBeGreaterThan(0);
  });

  it('carries cached OCR text for every receipt (§4.6)', () => {
    for (const bill of CORPUS.bills) {
      expect(bill.pages.length).toBeGreaterThan(0);
      expect(bill.pages[0].ocrText.length).toBeGreaterThan(50);
    }
  });

  it('includes non-Latin item or receipt text, which §4.10 search depends on', () => {
    const hasCjk = (text: string) => /[一-鿿]/.test(text);
    const anywhere = CORPUS.bills.some(
      (bill) =>
        bill.pages.some((page) => hasCjk(page.ocrText)) ||
        bill.items.some((item) => hasCjk(item.name) || hasCjk(item.nameLocal ?? ''))
    );
    expect(anywhere).toBe(true);
  });
});

describe('seedCorpus', () => {
  it('inserts every bill, item and page', async () => {
    const result = await seedCorpus(db);

    expect(result.billsInserted).toBe(11);
    expect(result.itemsInserted).toBe(41);
    expect(result.pagesInserted).toBe(11);
    expect(await countBills(db)).toBe(11);
  });

  it('derives merchant_norm through the repository rather than trusting the fixture', async () => {
    await seedCorpus(db);
    const bills = await listBills(db, { search: "PAK'nSAVE" });
    expect(bills.length).toBeGreaterThan(0);

    const detail = await getBill(db, bills[0].id);
    expect(detail!.merchantNorm).toBe('paknsave');
  });

  it('computes integrity flags at write time (§4.11)', async () => {
    await seedCorpus(db);
    const bills = await listBills(db, { limit: 50 });

    // Every flag present must be one the repository derived — the fixture
    // carries none of its own.
    for (const bill of bills) {
      for (const flag of bill.parseFlags) {
        expect(['sum_mismatch', 'unit_mismatch', 'low_confidence', 'missing_price']).toContain(flag);
      }
    }
  });

  it('stores the OCR text so a receipt can be re-parsed without re-scanning', async () => {
    await seedCorpus(db);
    const [first] = await listBills(db, { limit: 1 });
    const scans = await getReceiptScans(db, first.id);

    expect(scans).toHaveLength(1);
    expect(scans[0].length).toBeGreaterThan(50);
  });

  it('leaves existing bills alone by default', async () => {
    await seedCorpus(db);
    await seedCorpus(db);
    expect(await countBills(db)).toBe(22);
  });

  it('replaces everything when asked', async () => {
    await seedCorpus(db);
    const result = await seedCorpus(db, { replaceExisting: true });

    expect(result.deleted).toBe(11);
    expect(await countBills(db)).toBe(11);
  });

  it('produces a ledger the insights queries can summarise', async () => {
    await seedCorpus(db);
    const period = { from: '2025-01-01', to: '2026-12-31' };

    const summary = await getSpendSummary(db, period);
    expect(summary.billCount).toBe(11);
    expect(summary.itemCount).toBe(41);
    expect(summary.totalCents).toBeGreaterThan(0);

    // The restaurant bill has no items, so it must land in the remainder
    // rather than vanish from the category chart (§14.6).
    const breakdown = await getCategoryBreakdown(db, period);
    expect(breakdown.unitemisedCents).toBeGreaterThan(0);
    expect(
      breakdown.categories.reduce((sum, c) => sum + c.totalCents, 0) + breakdown.unitemisedCents
    ).toBe(breakdown.totalCents);
  });

  it('search finds an item by its non-English name where one was parsed', async () => {
    await seedCorpus(db);
    // Not asserting a specific term: the corpus is real parse output, so this
    // checks the mechanism against whatever local names it actually contains.
    const withLocal = CORPUS.bills
      .flatMap((bill) => bill.items)
      .find((item) => item.nameLocal && /[一-鿿]/.test(item.nameLocal));

    if (!withLocal?.nameLocal) return; // corpus has none; nothing to assert
    const hits = await listBills(db, { search: withLocal.nameLocal });
    expect(hits.length).toBeGreaterThan(0);
  });
});
