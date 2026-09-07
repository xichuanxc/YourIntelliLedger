import { expectRejection } from '../support/expectRejection';
import { openTestDriver } from '../support/sqlite-driver';

import type { SqlDriver } from '@/data/driver';
import { NotFoundError, ValidationError } from '@/data/errors';
import { needsReview, unreviewedFlags } from '@/data/review';
import {
  addBillItem,
  countBills,
  createBill,
  deleteBill,
  deleteBillItem,
  getBill,
  getMonthTotals,
  listBills,
  listLedger,
  updateBill,
  updateBillItem,
  markBillReviewed,
  findDuplicateBill,
} from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';
import { normaliseMerchant } from '@/data/merchant';
import type { NewBillInput } from '@/types/ledger';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const groceries: NewBillInput = {
  merchant: "PAK'nSAVE Mill Street",
  merchantAddress: '17 Mill Street, Hamilton',
  purchasedAt: '2026-07-19',
  purchasedTime: '17:42',
  totalCents: 1250,
  source: 'manual',
  items: [
    { name: 'Bananas', category: 'produce', qty: 0.67, unit: 'kg', priceCents: 245, unitPriceCents: 365 },
    { name: 'Milk 2L', category: 'dairy', priceCents: 1005 },
  ],
};

describe('createBill', () => {
  it('stores the bill, its items and the derived fields', async () => {
    const id = await createBill(db, groceries);
    const bill = await getBill(db, id);

    expect(bill).not.toBeNull();
    expect(bill!.merchant).toBe("PAK'nSAVE Mill Street");
    expect(bill!.merchantNorm).toBe('paknsave mill street');
    expect(bill!.merchantAddress).toBe('17 Mill Street, Hamilton');
    expect(bill!.purchasedAt).toBe('2026-07-19');
    expect(bill!.purchasedTime).toBe('17:42');
    expect(bill!.totalCents).toBe(1250);
    expect(bill!.currency).toBe('NZD');
    expect(bill!.source).toBe('manual');
    expect(bill!.capturePath).toBeNull();
    expect(bill!.pageCount).toBe(0);
    expect(bill!.parseFlags).toEqual([]);
    expect(bill!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
  });

  it('numbers line items in the order they were supplied', async () => {
    const id = await createBill(db, groceries);
    const bill = await getBill(db, id);

    expect(bill!.items.map((item) => [item.lineNo, item.name])).toEqual([
      [1, 'Bananas'],
      [2, 'Milk 2L'],
    ]);
  });

  it('applies the schema defaults for omitted item fields', async () => {
    const id = await createBill(db, groceries);
    const [, milk] = (await getBill(db, id))!.items;

    expect(milk.qty).toBe(1);
    expect(milk.unit).toBe('pc');
    expect(milk.scanUnits).toBe(1);
    expect(milk.isFood).toBe(true);
    expect(milk.userCorrected).toBe(false);
    expect(milk.unitPriceCents).toBeNull();
  });

  it('preserves fractional quantities for weighed goods (§4.9)', async () => {
    const id = await createBill(db, groceries);
    const [bananas] = (await getBill(db, id))!.items;

    expect(bananas.qty).toBe(0.67);
    expect(bananas.unit).toBe('kg');
    expect(bananas.unitPriceCents).toBe(365);
  });

  it('records integrity flags computed from the data being stored (§4.11)', async () => {
    const id = await createBill(db, { ...groceries, totalCents: 9999 });
    expect((await getBill(db, id))!.parseFlags).toEqual(['sum_mismatch']);
  });

  it('stores an itemless bill for a receipt with nothing to itemize (§5.1)', async () => {
    const id = await createBill(db, {
      merchant: 'Rice Bowl Cafe',
      purchasedAt: '2026-07-18',
      totalCents: 8650,
      source: 'receipt',
      capturePath: 'scanner',
      items: [],
    });

    const bill = await getBill(db, id);
    expect(bill!.items).toEqual([]);
    expect(bill!.totalCents).toBe(8650);
    // Not a sum_mismatch: an empty item list is the expected shape here.
    expect(bill!.parseFlags).toEqual([]);
  });

  it('returns null for a bill that does not exist', async () => {
    expect(await getBill(db, 404)).toBeNull();
  });
});

describe('createBill validation', () => {
  it('rejects an impossible date before touching the database', async () => {
    await expectRejection(() => createBill(db, { ...groceries, purchasedAt: '2026-02-30' }), { type: ValidationError });
    expect(await countBills(db)).toBe(0);
  });

  it('rejects a malformed time', async () => {
    await expectRejection(() => createBill(db, { ...groceries, purchasedTime: '25:00' }), { type: ValidationError });
  });

  it('rejects fractional cents — money is integers (§4.3)', async () => {
    await expectRejection(() => createBill(db, { ...groceries, totalCents: 12.5 }), { message: /whole cents/ });
  });

  it('rejects a negative discount, which would invert the sum check', async () => {
    await expectRejection(() => createBill(db, { ...groceries, discountCents: -100 }), { type: ValidationError });
  });

  it('rejects an item outside the category vocabulary (§4.7)', async () => {
    await expectRejection(() => createBill(db, {
        ...groceries,
        items: [{ name: 'Carrots', category: 'vegetables' as never }],
      }), { message: /not a valid category/ });
  });

  it('rejects an empty item name', async () => {
    await expectRejection(() => createBill(db, { ...groceries, items: [{ name: '   ', category: 'other' }] }), { message: /cannot be empty/ });
  });

  it('writes nothing when a later item fails validation', async () => {
    await expectRejection(() => createBill(db, {
        ...groceries,
        items: [
          { name: 'Good', category: 'produce', priceCents: 100 },
          { name: 'Bad', category: 'nonsense' as never },
        ],
      }), { type: ValidationError });

    expect(await countBills(db)).toBe(0);
  });
});

describe('transactional writes (spec §10 — rollback on failed receipt write)', () => {
  it('leaves no partial bill when an item insert fails mid-transaction', async () => {
    // A category that passes the TypeScript-side check but violates the
    // schema CHECK is not reachable through the public API, so drive the
    // failure through the FK instead: delete the parent bill inside the same
    // transaction the items are being written into is not possible either.
    // Instead: force a failure by making the second insert violate NOT NULL.
    const bad = {
      ...groceries,
      items: [
        { name: 'Good', category: 'produce' as const, priceCents: 100 },
        { name: 'Bad', category: 'produce' as const, priceCents: 100, qty: Number.NaN },
      ],
    };

    await expectRejection(() => createBill(db, bad));

    expect(await countBills(db)).toBe(0);
    expect(await db.all('SELECT * FROM bill_items')).toHaveLength(0);
  });
});

describe('updateBill', () => {
  it('applies a patch and re-derives merchant_norm', async () => {
    const id = await createBill(db, groceries);
    await updateBill(db, id, { merchant: '  New   World  Hamilton ' });

    const bill = await getBill(db, id);
    expect(bill!.merchant).toBe('New World Hamilton');
    expect(bill!.merchantNorm).toBe('new world hamilton');
  });

  it('leaves omitted fields alone', async () => {
    const id = await createBill(db, groceries);
    await updateBill(db, id, { purchasedAt: '2026-07-20' });

    const bill = await getBill(db, id);
    expect(bill!.purchasedAt).toBe('2026-07-20');
    expect(bill!.merchant).toBe("PAK'nSAVE Mill Street");
    expect(bill!.totalCents).toBe(1250);
  });

  it('distinguishes clearing a field from omitting it', async () => {
    const id = await createBill(db, groceries);
    await updateBill(db, id, { purchasedTime: null });
    expect((await getBill(db, id))!.purchasedTime).toBeNull();
  });

  it('recomputes integrity flags after the edit', async () => {
    const id = await createBill(db, groceries);
    expect((await getBill(db, id))!.parseFlags).toEqual([]);

    await updateBill(db, id, { totalCents: 5000 });
    expect((await getBill(db, id))!.parseFlags).toEqual(['sum_mismatch']);

    await updateBill(db, id, { totalCents: 1250 });
    expect((await getBill(db, id))!.parseFlags).toEqual([]);
  });

  it('advances updated_at but not created_at', async () => {
    const id = await createBill(db, groceries);
    const before = (await getBill(db, id))!;

    await new Promise((resolve) => setTimeout(resolve, 2));
    await updateBill(db, id, { totalCents: 1300 });

    const after = (await getBill(db, id))!;
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it('rejects an unknown bill', async () => {
    await expectRejection(() => updateBill(db, 404, { totalCents: 1 }), { type: NotFoundError });
  });

  it('rejects an invalid date without changing anything', async () => {
    const id = await createBill(db, groceries);
    await expectRejection(() => updateBill(db, id, { purchasedAt: 'yesterday' }), { type: ValidationError });
    expect((await getBill(db, id))!.purchasedAt).toBe('2026-07-19');
  });
});

describe('line item editing', () => {
  it('marks any edit as user-corrected (§5.6)', async () => {
    const id = await createBill(db, groceries);
    const [bananas] = (await getBill(db, id))!.items;
    expect(bananas.userCorrected).toBe(false);

    await updateBillItem(db, bananas.id, { category: 'other' });

    const [edited] = (await getBill(db, id))!.items;
    expect(edited.category).toBe('other');
    expect(edited.userCorrected).toBe(true);
  });

  it('recomputes the parent bill flags after an item price changes', async () => {
    const id = await createBill(db, groceries);
    const [bananas] = (await getBill(db, id))!.items;

    await updateBillItem(db, bananas.id, { priceCents: 100 });
    expect((await getBill(db, id))!.parseFlags).toEqual(['sum_mismatch']);
  });

  it('flags a bill whose item price was cleared as illegible', async () => {
    const id = await createBill(db, groceries);
    const [bananas] = (await getBill(db, id))!.items;

    await updateBillItem(db, bananas.id, { priceCents: null });
    expect((await getBill(db, id))!.parseFlags).toEqual(['missing_price']);
  });

  it('appends a new item after the highest existing line number', async () => {
    const id = await createBill(db, groceries);
    await addBillItem(db, id, { name: 'Bread', category: 'bakery', priceCents: 400 });

    const items = (await getBill(db, id))!.items;
    expect(items.map((item) => item.lineNo)).toEqual([1, 2, 3]);
    expect(items[2].name).toBe('Bread');
  });

  it('removes an item and re-checks the totals', async () => {
    const id = await createBill(db, groceries);
    const [bananas] = (await getBill(db, id))!.items;

    await deleteBillItem(db, bananas.id);

    const bill = await getBill(db, id);
    expect(bill!.items).toHaveLength(1);
    expect(bill!.parseFlags).toEqual(['sum_mismatch']);
  });

  it('rejects edits to an unknown item', async () => {
    await expectRejection(() => updateBillItem(db, 404, { qty: 2 }), { type: NotFoundError });
    await expectRejection(() => deleteBillItem(db, 404), { type: NotFoundError });
  });

  it('rejects an invalid unit without writing', async () => {
    const id = await createBill(db, groceries);
    const [bananas] = (await getBill(db, id))!.items;

    await expectRejection(() => updateBillItem(db, bananas.id, { unit: 'litres' as never }), { type: ValidationError });
    expect((await getBill(db, id))!.items[0].unit).toBe('kg');
  });
});

describe('deleteBill', () => {
  it('removes the bill and cascades its items', async () => {
    const id = await createBill(db, groceries);
    await deleteBill(db, id);

    expect(await getBill(db, id)).toBeNull();
    expect(await db.all('SELECT * FROM bill_items WHERE bill_id = ?', [id])).toHaveLength(0);
  });

  it('rejects an unknown bill rather than succeeding silently', async () => {
    await expectRejection(() => deleteBill(db, 404), { type: NotFoundError });
  });
});

describe('listing and search', () => {
  beforeEach(async () => {
    await createBill(db, groceries); // 2026-07-19, $12.50
    await createBill(db, {
      merchant: 'New World',
      purchasedAt: '2026-07-02',
      totalCents: 3000,
      source: 'manual',
      items: [{ name: 'Dried tofu', nameLocal: '豆腐干', category: 'other', priceCents: 3000 }],
    });
    await createBill(db, {
      merchant: 'The Warehouse',
      purchasedAt: '2026-06-11',
      totalCents: 2000,
      source: 'manual',
      items: [{ name: 'Batteries', category: 'household', isFood: false, priceCents: 2000 }],
    });
  });

  it('returns bills newest first', async () => {
    const bills = await listBills(db);
    expect(bills.map((bill) => bill.purchasedAt)).toEqual(['2026-07-19', '2026-07-02', '2026-06-11']);
  });

  it('includes the item count for each bill', async () => {
    const [first] = await listBills(db);
    expect(first.itemCount).toBe(2);
  });

  it('groups into months with a full-month header total', async () => {
    const months = await listLedger(db);

    expect(months.map((month) => month.month)).toEqual(['2026-07', '2026-06']);
    expect(months[0].totalCents).toBe(1250 + 3000);
    expect(months[1].totalCents).toBe(2000);
    expect(months[0].bills).toHaveLength(2);
  });

  it('sums bill totals, so an itemless bill still counts (§14.6)', async () => {
    await createBill(db, {
      merchant: 'Rice Bowl Cafe',
      purchasedAt: '2026-07-05',
      totalCents: 8650,
      source: 'receipt',
      capturePath: 'scanner',
      items: [],
    });

    const totals = await getMonthTotals(db);
    expect(totals.get('2026-07')).toBe(1250 + 3000 + 8650);
  });

  it('searches the merchant name', async () => {
    const bills = await listBills(db, { search: 'warehouse' });
    expect(bills.map((bill) => bill.merchant)).toEqual(['The Warehouse']);
  });

  it('searches item names in English and as printed (§4.10)', async () => {
    const english = await listBills(db, { search: 'dried tofu' });
    const chinese = await listBills(db, { search: '豆腐干' });

    expect(english.map((bill) => bill.id)).toEqual(chinese.map((bill) => bill.id));
    expect(english).toHaveLength(1);
  });

  it('matches substrings, which is what makes the bilingual case work', async () => {
    expect(await listBills(db, { search: '腐' })).toHaveLength(1);
    expect(await listBills(db, { search: 'atter' })).toHaveLength(1);
  });

  it('treats LIKE wildcards in the search box as literal characters', async () => {
    // Without escaping, "%" would match every bill in the ledger.
    expect(await listBills(db, { search: '%' })).toHaveLength(0);
    expect(await listBills(db, { search: '_' })).toHaveLength(0);
  });

  it('applies the search to month totals as well as to the list', async () => {
    const totals = await getMonthTotals(db, { search: 'warehouse' });
    expect([...totals.entries()]).toEqual([['2026-06', 2000]]);
  });

  it('pages without reordering', async () => {
    const page1 = await listBills(db, { limit: 2, offset: 0 });
    const page2 = await listBills(db, { limit: 2, offset: 2 });

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(1);
    expect(page2[0].purchasedAt).toBe('2026-06-11');
  });

  it('returns an empty ledger for an empty database', async () => {
    const empty = openTestDriver();
    await migrate(empty);
    expect(await listLedger(empty)).toEqual([]);
    await empty.close();
  });
});

/**
 * Clearing "needs review" (§4.11).
 *
 * `low_confidence` was unclearable: it is raised when any item has
 * `confidence = 'low'`, flags recompute on every write, but nothing could
 * change an item's confidence after the parse. A bill marked "needs review"
 * stayed marked however carefully it was reviewed.
 *
 * The line these tests hold is *which* flags may clear this way. Confidence
 * records how sure the model was, and a person vouching for a line supersedes
 * that. The numeric flags are claims about the numbers and must survive.
 */
describe('markBillReviewed', () => {
  /** Local factory: this file's shared fixture has no flagged lines. */
  const bill = (overrides: Partial<NewBillInput>): NewBillInput => ({
    merchant: 'New World',
    purchasedAt: '2026-07-19',
    totalCents: 1000,
    source: 'receipt',
    ...overrides,
  });

  const flagged = (billId: number) => getBill(db, billId).then((b) => b!);

  /**
   * The gap this replaced `confirmLowConfidenceItems` to close. Three of the
   * four flags clear only when the numbers change, and a receipt whose figures
   * genuinely do not reconcile showed "needs review" for ever with no way to
   * dismiss it.
   */
  it('lets a sum that will never add up be accepted', async () => {
    const billId = await createBill(
      db,
      bill({
        totalCents: 9999,
        items: [{ name: 'Clear', category: 'dairy', priceCents: 400, confidence: 'high' }],
      })
    );

    expect(needsReview(await flagged(billId))).toBe(true);
    await markBillReviewed(db, billId);
    expect(needsReview(await flagged(billId))).toBe(false);
  });

  /**
   * §4.11: the flags are evidence that the parse was unreliable. Accepting
   * them records who looked, and changes nothing about what was read.
   */
  it('keeps the flags and every number exactly as they were', async () => {
    const billId = await createBill(
      db,
      bill({
        totalCents: 9999,
        items: [{ name: 'Smudged', category: 'dairy', priceCents: 400, confidence: 'low' }],
      })
    );

    const before = await flagged(billId);
    await markBillReviewed(db, billId);
    const after = await flagged(billId);

    expect(after.parseFlags).toEqual(before.parseFlags);
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.items[0].priceCents).toBe(400);
    // The old implementation rewrote this to 'high', which made the record
    // claim the *model* had been confident when only a person was.
    expect(after.items[0].confidence).toBe('low');
    expect(after.reviewedAt).not.toBeNull();
  });

  it('records which flags were accepted, not merely that something was', async () => {
    const billId = await createBill(
      db,
      bill({
        totalCents: 9999,
        items: [{ name: 'Smudged', category: 'dairy', priceCents: 400, confidence: 'low' }],
      })
    );

    const accepted = await markBillReviewed(db, billId);
    expect(accepted.sort()).toEqual(['low_confidence', 'sum_mismatch']);
    expect((await flagged(billId)).reviewedFlags?.sort()).toEqual([
      'low_confidence',
      'sum_mismatch',
    ]);
  });

  /**
   * Acknowledging one problem must not silence a different one raised later,
   * or "I have checked this" becomes "never tell me anything again".
   */
  it('speaks up again when a later edit raises a new flag', async () => {
    const billId = await createBill(
      db,
      bill({
        totalCents: 9999,
        items: [{ name: 'Clear', category: 'dairy', priceCents: 400, confidence: 'high' }],
      })
    );

    await markBillReviewed(db, billId);
    expect(needsReview(await flagged(billId))).toBe(false);

    // Now make a price illegible, which raises `missing_price`.
    const itemId = (await flagged(billId)).items[0].id;
    await updateBillItem(db, itemId, { priceCents: null });

    const after = await flagged(billId);
    expect(after.parseFlags).toContain('missing_price');
    expect(needsReview(after)).toBe(true);
    // The one already accepted stays quiet.
    expect(unreviewedFlags(after)).toEqual(['missing_price']);
  });

  it('leaves an unflagged bill alone', async () => {
    const billId = await createBill(
      db,
      bill({
        totalCents: 400,
        items: [{ name: 'Clear', category: 'dairy', priceCents: 400, confidence: 'high' }],
      })
    );

    expect(await markBillReviewed(db, billId)).toEqual([]);
    expect(needsReview(await flagged(billId))).toBe(false);
  });

  it('touches only the bill it was given', async () => {
    const target = await createBill(
      db,
      bill({ totalCents: 9999, items: [{ name: 'A', category: 'dairy', priceCents: 400 }] })
    );
    const other = await createBill(
      db,
      bill({ totalCents: 9999, items: [{ name: 'B', category: 'dairy', priceCents: 400 }] })
    );

    await markBillReviewed(db, target);

    expect(needsReview(await flagged(other))).toBe(true);
  });

  it('refuses a bill that does not exist', async () => {
    await expectRejection(() => markBillReviewed(db, 9999), { type: NotFoundError });
  });
});

/**
 * Duplicate detection — not in the spec, added after watching the same
 * PAK'nSAVE receipt land in the ledger twice.
 *
 * The line these hold is where a *warning* is justified. Two identical
 * purchases are a real thing and must stay recordable, so this is advisory:
 * over-warning trains people to ignore it, and under-warning lets a
 * double-scan through silently.
 */
describe('findDuplicateBill', () => {
  const dup = (overrides: Partial<NewBillInput> = {}): NewBillInput => ({
    merchant: "PAK'nSAVE",
    purchasedAt: '2026-07-19',
    purchasedTime: '17:42',
    totalCents: 3446,
    source: 'receipt',
    items: [{ name: 'Milk', category: 'dairy', priceCents: 3446 }],
    ...overrides,
  });

  const candidateOf = (input: NewBillInput) => ({
    merchantNorm: normaliseMerchant(input.merchant ?? null),
    purchasedAt: input.purchasedAt,
    purchasedTime: input.purchasedTime ?? null,
    totalCents: input.totalCents ?? null,
  });

  it('finds the same shop, day, total and minute', async () => {
    const first = await createBill(db, dup());
    const match = await findDuplicateBill(db, candidateOf(dup()));

    expect(match?.billId).toBe(first);
    expect(match?.strength).toBe('exact');
  });

  /** Neither receipt printing a time is still an exact match on what exists. */
  it('treats two untimed receipts as exact', async () => {
    await createBill(db, dup({ purchasedTime: null }));
    const match = await findDuplicateBill(db, candidateOf(dup({ purchasedTime: null })));

    expect(match?.strength).toBe('exact');
  });

  /**
   * The same lunch twice in one day is possible, so this is graded down rather
   * than suppressed — the screen says the times differ and lets the user judge.
   */
  it('grades a different time down to same-day', async () => {
    await createBill(db, dup({ purchasedTime: '08:15' }));
    const match = await findDuplicateBill(db, candidateOf(dup({ purchasedTime: '17:42' })));

    expect(match?.strength).toBe('same-day');
  });

  it('prefers an exact match over a same-day one', async () => {
    await createBill(db, dup({ purchasedTime: '08:15' }));
    const exact = await createBill(db, dup({ purchasedTime: '17:42' }));

    const match = await findDuplicateBill(db, candidateOf(dup({ purchasedTime: '17:42' })));
    expect(match?.billId).toBe(exact);
    expect(match?.strength).toBe('exact');
  });

  it('does not match a different total', async () => {
    await createBill(db, dup({ totalCents: 3446 }));
    expect(await findDuplicateBill(db, candidateOf(dup({ totalCents: 3447 })))).toBeNull();
  });

  it('does not match a different day', async () => {
    await createBill(db, dup({ purchasedAt: '2026-07-19' }));
    expect(await findDuplicateBill(db, candidateOf(dup({ purchasedAt: '2026-07-20' })))).toBeNull();
  });

  it('does not match a different shop', async () => {
    await createBill(db, dup({ merchant: "PAK'nSAVE" }));
    expect(await findDuplicateBill(db, candidateOf(dup({ merchant: 'New World' })))).toBeNull();
  });

  /**
   * §4.8 groups on the normalised name, so two spellings of one shop are one
   * merchant — and a re-scan often reads the name slightly differently.
   */
  it('matches across spellings that normalise together', async () => {
    const first = await createBill(db, dup({ merchant: "PAK'nSAVE" }));
    const match = await findDuplicateBill(db, candidateOf(dup({ merchant: 'PAKnSAVE' })));

    expect(match?.billId).toBe(first);
  });

  /** An illegible total (§4.3) is too weak to accuse anyone of double-scanning. */
  it('never matches when the total is unknown', async () => {
    await createBill(db, dup({ totalCents: null }));
    expect(await findDuplicateBill(db, candidateOf(dup({ totalCents: null })))).toBeNull();
  });

  it('finds nothing in an empty ledger', async () => {
    expect(await findDuplicateBill(db, candidateOf(dup()))).toBeNull();
  });

  /** Editing a bill must not report the bill itself as its own duplicate. */
  it('excludes the bill being edited', async () => {
    const id = await createBill(db, dup());
    const match = await findDuplicateBill(db, { ...candidateOf(dup()), excludeBillId: id });

    expect(match).toBeNull();
  });

  it('reports enough to identify the other bill on screen', async () => {
    await createBill(db, dup({ items: [
      { name: 'A', category: 'dairy', priceCents: 1723 },
      { name: 'B', category: 'dairy', priceCents: 1723 },
    ] }));

    const match = await findDuplicateBill(db, candidateOf(dup()));
    expect(match?.merchant).toBe("PAK'nSAVE");
    expect(match?.totalCents).toBe(3446);
    expect(match?.itemCount).toBe(2);
  });
});
