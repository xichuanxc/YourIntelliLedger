import { openTestDriver } from '../support/sqlite-driver';

import type { Period } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';
import {
  getCategoryBreakdown,
  getCategoryItems,
  getDataRange,
  getLatestMonth,
  getMerchantBills,
  getMerchantBreakdown,
  getMonthlyTrend,
  getSpendSummary,
  getWeeklyTrend,
  getUnitemisedBills,
} from '@/data/insightsRepo';
import { createBill } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';
import type { NewBillInput } from '@/types/ledger';

let db: SqlDriver;

const JUNE: Period = { from: '2026-06-01', to: '2026-06-30' };
const JULY: Period = { from: '2026-07-01', to: '2026-07-31' };
const Q2_Q3: Period = { from: '2026-05-01', to: '2026-07-31' };

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const bill = (overrides: Partial<NewBillInput> = {}): NewBillInput => ({
  merchant: 'New World',
  purchasedAt: '2026-07-10',
  totalCents: 1000,
  source: 'manual',
  items: [{ name: 'Milk', category: 'dairy', priceCents: 1000 }],
  ...overrides,
});

describe('getSpendSummary', () => {
  it('sums bill totals across the period', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-02', totalCents: 1000 }));
    await createBill(db, bill({ purchasedAt: '2026-07-20', totalCents: 2500 }));

    const summary = await getSpendSummary(db, JULY);
    expect(summary.totalCents).toBe(3500);
    expect(summary.billCount).toBe(2);
    expect(summary.averageBillCents).toBe(1750);
    expect(summary.firstBill).toBe('2026-07-02');
    expect(summary.lastBill).toBe('2026-07-20');
  });

  it('includes both period boundaries', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-01', totalCents: 100 }));
    await createBill(db, bill({ purchasedAt: '2026-07-31', totalCents: 200 }));
    await createBill(db, bill({ purchasedAt: '2026-06-30', totalCents: 999 }));
    await createBill(db, bill({ purchasedAt: '2026-08-01', totalCents: 999 }));

    expect((await getSpendSummary(db, JULY)).totalCents).toBe(300);
  });

  it('reports zeros and a null average for an empty period', async () => {
    const summary = await getSpendSummary(db, JULY);
    expect(summary.totalCents).toBe(0);
    expect(summary.billCount).toBe(0);
    // Not 0 — the average of no bills is unknown, and $0.00 would be a lie.
    expect(summary.averageBillCents).toBeNull();
    expect(summary.firstBill).toBeNull();
    expect(summary.currency).toBe('NZD');
  });

  it('counts line items across the period', async () => {
    await createBill(db, bill({ items: [
      { name: 'Milk', category: 'dairy', priceCents: 400 },
      { name: 'Bread', category: 'bakery', priceCents: 600 },
    ] }));
    expect((await getSpendSummary(db, JULY)).itemCount).toBe(2);
  });

  it('reports the most-used currency in the period', async () => {
    await createBill(db, bill({ currency: 'AUD' }));
    await createBill(db, bill({ currency: 'AUD' }));
    await createBill(db, bill({ currency: 'NZD' }));
    expect((await getSpendSummary(db, JULY)).currency).toBe('AUD');
  });
});

describe('getCategoryBreakdown', () => {
  it('groups item spend by category, biggest first', async () => {
    await createBill(db, bill({
      totalCents: 1500,
      items: [
        { name: 'Milk', category: 'dairy', priceCents: 400 },
        { name: 'Cheese', category: 'dairy', priceCents: 500 },
        { name: 'Bread', category: 'bakery', priceCents: 600 },
      ],
    }));

    const breakdown = await getCategoryBreakdown(db, JULY);
    expect(breakdown.categories).toEqual([
      { category: 'dairy', totalCents: 900, itemCount: 2 },
      { category: 'bakery', totalCents: 600, itemCount: 1 },
    ]);
    expect(breakdown.unitemisedCents).toBe(0);
    expect(breakdown.totalCents).toBe(1500);
  });

  it('puts an itemless bill in the unitemised remainder, not nowhere (§5.1, §14.6)', async () => {
    await createBill(db, bill({ totalCents: 1000 }));
    await createBill(db, bill({
      merchant: 'Rice Bowl Cafe',
      totalCents: 8650,
      source: 'receipt',
      capturePath: 'scanner',
      items: [],
    }));

    const breakdown = await getCategoryBreakdown(db, JULY);

    // The categories alone would undercount by the whole restaurant bill.
    expect(breakdown.categories).toEqual([{ category: 'dairy', totalCents: 1000, itemCount: 1 }]);
    expect(breakdown.unitemisedCents).toBe(8650);
    // The breakdown reconciles with the headline figure.
    expect(
      breakdown.categories.reduce((s, c) => s + c.totalCents, 0) + breakdown.unitemisedCents
    ).toBe(breakdown.totalCents);
  });

  it('excludes an illegible price from its category and leaves it in the remainder', async () => {
    await createBill(db, bill({
      totalCents: 1000,
      items: [
        { name: 'Milk', category: 'dairy', priceCents: 400 },
        { name: 'Smudged', category: 'bakery', priceCents: null },
      ],
    }));

    const breakdown = await getCategoryBreakdown(db, JULY);
    const bakery = breakdown.categories.find((c) => c.category === 'bakery');

    // Counted as an item, but contributes no money — NULL is unknown, not zero.
    expect(bakery).toEqual({ category: 'bakery', totalCents: 0, itemCount: 1 });
    expect(breakdown.unitemisedCents).toBe(600);
  });

  it('reports a negative remainder rather than hiding it', async () => {
    // Items sum above the printed total — possible with per-line discounts.
    await createBill(db, bill({
      totalCents: 500,
      items: [{ name: 'Milk', category: 'dairy', priceCents: 900 }],
    }));

    expect((await getCategoryBreakdown(db, JULY)).unitemisedCents).toBe(-400);
  });

  it('is empty for a period with no bills', async () => {
    const breakdown = await getCategoryBreakdown(db, JULY);
    expect(breakdown.categories).toEqual([]);
    expect(breakdown.totalCents).toBe(0);
    expect(breakdown.unitemisedCents).toBe(0);
  });

  it('ignores items belonging to bills outside the period', async () => {
    await createBill(db, bill({ purchasedAt: '2026-06-15', totalCents: 5000 }));
    expect((await getCategoryBreakdown(db, JULY)).categories).toEqual([]);
  });
});

describe('getMerchantBreakdown', () => {
  it('groups by normalised merchant and orders by spend', async () => {
    await createBill(db, bill({ merchant: "PAK'nSAVE Mill Street", totalCents: 3000 }));
    await createBill(db, bill({ merchant: "PAK'NSAVE Mill Street", totalCents: 2000 }));
    await createBill(db, bill({ merchant: 'New World', totalCents: 4000 }));

    const merchants = await getMerchantBreakdown(db, JULY);

    expect(merchants).toHaveLength(2);
    expect(merchants[0]).toMatchObject({ merchantNorm: 'paknsave mill street', totalCents: 5000, billCount: 2 });
    expect(merchants[1]).toMatchObject({ merchantNorm: 'new world', totalCents: 4000, billCount: 1 });
  });

  it('keeps different branches apart (§4.8)', async () => {
    await createBill(db, bill({ merchant: "PAK'nSAVE Mill Street", totalCents: 1000 }));
    await createBill(db, bill({ merchant: "PAK'nSAVE Hamilton", totalCents: 1000 }));
    expect(await getMerchantBreakdown(db, JULY)).toHaveLength(2);
  });

  it('groups unnamed merchants together', async () => {
    await createBill(db, bill({ merchant: null, totalCents: 700 }));
    await createBill(db, bill({ merchant: null, totalCents: 300 }));

    const merchants = await getMerchantBreakdown(db, JULY);
    expect(merchants).toEqual([
      { merchant: null, merchantNorm: null, totalCents: 1000, billCount: 2 },
    ]);
  });

  it('honours the limit', async () => {
    for (const name of ['A', 'B', 'C', 'D']) {
      await createBill(db, bill({ merchant: name }));
    }
    expect(await getMerchantBreakdown(db, JULY, 2)).toHaveLength(2);
  });
});

describe('getMonthlyTrend', () => {
  it('returns one entry per month, oldest first', async () => {
    await createBill(db, bill({ purchasedAt: '2026-05-10', totalCents: 100 }));
    await createBill(db, bill({ purchasedAt: '2026-07-10', totalCents: 300 }));

    const trend = await getMonthlyTrend(db, 3, '2026-07');
    expect(trend.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(trend.map((m) => m.totalCents)).toEqual([100, 0, 300]);
  });

  it('keeps an empty month as a zero rather than closing the gap', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-10', totalCents: 300 }));

    const trend = await getMonthlyTrend(db, 3, '2026-07');
    expect(trend[1]).toEqual({ month: '2026-06', totalCents: 0, billCount: 0 });
  });

  it('crosses a year boundary correctly', async () => {
    await createBill(db, bill({ purchasedAt: '2025-12-10', totalCents: 100 }));
    await createBill(db, bill({ purchasedAt: '2026-01-10', totalCents: 200 }));

    const trend = await getMonthlyTrend(db, 3, '2026-01');
    expect(trend.map((m) => m.month)).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(trend.map((m) => m.totalCents)).toEqual([0, 100, 200]);
  });

  it('includes February month-ends', async () => {
    await createBill(db, bill({ purchasedAt: '2024-02-29', totalCents: 500 }));
    const trend = await getMonthlyTrend(db, 1, '2024-02');
    expect(trend).toEqual([{ month: '2024-02', totalCents: 500, billCount: 1 }]);
  });

  it('counts bills per month alongside the total', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-01', totalCents: 100 }));
    await createBill(db, bill({ purchasedAt: '2026-07-02', totalCents: 100 }));
    expect((await getMonthlyTrend(db, 1, '2026-07'))[0].billCount).toBe(2);
  });
});

describe('getDataRange and getLatestMonth', () => {
  it('reports the span of the whole ledger', async () => {
    await createBill(db, bill({ purchasedAt: '2026-05-04' }));
    await createBill(db, bill({ purchasedAt: '2026-07-19' }));

    expect(await getDataRange(db)).toEqual({
      firstBill: '2026-05-04',
      lastBill: '2026-07-19',
      billCount: 2,
    });
    expect(await getLatestMonth(db)).toBe('2026-07');
  });

  it('handles an empty ledger', async () => {
    expect(await getDataRange(db)).toEqual({ firstBill: null, lastBill: null, billCount: 0 });
    expect(await getLatestMonth(db)).toBeNull();
  });
});

describe('multi-month periods', () => {
  it('aggregates across months', async () => {
    await createBill(db, bill({ purchasedAt: '2026-05-10', totalCents: 100 }));
    await createBill(db, bill({ purchasedAt: '2026-06-10', totalCents: 200 }));
    await createBill(db, bill({ purchasedAt: '2026-07-10', totalCents: 300 }));

    expect((await getSpendSummary(db, Q2_Q3)).totalCents).toBe(600);
    expect((await getSpendSummary(db, JUNE)).totalCents).toBe(200);
  });
});

/**
 * The drill-downs (§7): what is behind one slice of a donut.
 *
 * The property that matters throughout is **reconciliation** — a detail list
 * has to add up to the figure the user tapped to reach it. A list that quietly
 * disagrees with the chart above it is worse than no list, because it looks
 * authoritative. Each of these therefore checks the sum against the aggregate
 * query that drew the slice, not against a hardcoded number.
 */
describe('getCategoryItems', () => {
  it('adds up to the category total that was tapped', async () => {
    await createBill(
      db,
      bill({
        purchasedAt: '2026-07-02',
        totalCents: 900,
        items: [
          { name: 'Milk', category: 'dairy', priceCents: 500 },
          { name: 'Cheese', category: 'dairy', priceCents: 400 },
        ],
      })
    );
    await createBill(
      db,
      bill({
        purchasedAt: '2026-07-20',
        totalCents: 300,
        items: [{ name: 'Apples', category: 'produce', priceCents: 300 }],
      })
    );

    const items = await getCategoryItems(db, JULY, 'dairy');
    const breakdown = await getCategoryBreakdown(db, JULY);
    const dairy = breakdown.categories.find((entry) => entry.category === 'dairy')!;

    expect(items).toHaveLength(2);
    expect(items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0)).toBe(dairy.totalCents);
  });

  it('returns newest first, so the list reads as a history', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-02', items: [{ name: 'Old', category: 'dairy', priceCents: 100 }] }));
    await createBill(db, bill({ purchasedAt: '2026-07-25', items: [{ name: 'New', category: 'dairy', priceCents: 100 }] }));

    const items = await getCategoryItems(db, JULY, 'dairy');
    expect(items.map((item) => item.name)).toEqual(['New', 'Old']);
  });

  it('carries the bill each item came from, so a row can be opened', async () => {
    const billId = await createBill(db, bill({ merchant: "PAK'nSAVE" }));
    const [item] = await getCategoryItems(db, JULY, 'dairy');

    expect(item.billId).toBe(billId);
    expect(item.merchant).toBe("PAK'nSAVE");
  });

  /**
   * `getCategoryBreakdown`'s SUM skips NULL prices, so an illegible line is
   * absent from the category total. Dropping it here too would leave a list
   * that adds up but silently omits a purchase the user can see on the bill.
   */
  it('keeps an illegible price as unknown rather than hiding the line', async () => {
    await createBill(
      db,
      bill({
        totalCents: 500,
        items: [
          { name: 'Milk', category: 'dairy', priceCents: 500 },
          { name: 'Smudged', category: 'dairy', priceCents: null },
        ],
      })
    );

    const items = await getCategoryItems(db, JULY, 'dairy');
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.name === 'Smudged')!.priceCents).toBeNull();
  });

  it('excludes items outside the period', async () => {
    await createBill(db, bill({ purchasedAt: '2026-06-15' }));
    expect(await getCategoryItems(db, JULY, 'dairy')).toEqual([]);
  });
});

describe('getMerchantBills', () => {
  it('adds up to the merchant total that was tapped', async () => {
    await createBill(db, bill({ merchant: "PAK'nSAVE", purchasedAt: '2026-07-02', totalCents: 1000 }));
    await createBill(db, bill({ merchant: 'PAKnSAVE', purchasedAt: '2026-07-20', totalCents: 2500 }));
    await createBill(db, bill({ merchant: 'Countdown', purchasedAt: '2026-07-11', totalCents: 700 }));

    const [top] = await getMerchantBreakdown(db, JULY, 1);
    const bills = await getMerchantBills(db, JULY, top.merchantNorm);

    expect(bills.reduce((sum, row) => sum + row.totalCents, 0)).toBe(top.totalCents);
    expect(bills).toHaveLength(top.billCount);
  });

  /**
   * §4.8 groups on the normalised name, so two spellings are one merchant.
   * The drill-down has to use the same key or it would show a subset of the
   * bills that produced the slice.
   *
   * These two converge because §4.8 *drops* punctuation rather than replacing
   * it with a space — "PAK n SAVE" would not join them, which is the
   * normalisation's known limitation rather than a bug in this query.
   */
  it('groups the spellings that normalise together, as the chart does', async () => {
    await createBill(db, bill({ merchant: "PAK'nSAVE", totalCents: 1000 }));
    await createBill(db, bill({ merchant: 'PAKnSAVE', totalCents: 2000 }));

    const [top] = await getMerchantBreakdown(db, JULY, 1);
    expect(top.merchantNorm).toBe('paknsave');
    expect(await getMerchantBills(db, JULY, top.merchantNorm)).toHaveLength(2);
  });

  /**
   * `merchant_norm = NULL` is never true in SQL, so an equality test would
   * return nothing for exactly the group that needs `IS`.
   */
  it('finds the bills that recorded no merchant at all', async () => {
    await createBill(db, bill({ merchant: null, totalCents: 400 }));
    await createBill(db, bill({ merchant: 'New World', totalCents: 400 }));

    const bills = await getMerchantBills(db, JULY, null);
    expect(bills).toHaveLength(1);
    expect(bills[0].merchant).toBeNull();
  });

  it('returns newest first and counts each bill’s items', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-02', totalCents: 100, items: [] }));
    await createBill(
      db,
      bill({
        purchasedAt: '2026-07-25',
        totalCents: 300,
        items: [
          { name: 'A', category: 'dairy', priceCents: 100 },
          { name: 'B', category: 'dairy', priceCents: 200 },
        ],
      })
    );

    const bills = await getMerchantBills(db, JULY, 'new world');
    expect(bills.map((row) => row.itemCount)).toEqual([2, 0]);
  });
});

describe('getUnitemisedBills', () => {
  /** The whole reason the slice exists (§14.6) — so this must reconcile. */
  it('adds up to the remainder the chart reported', async () => {
    await createBill(db, bill({ purchasedAt: '2026-07-02', totalCents: 5000, items: [] }));
    await createBill(
      db,
      bill({
        purchasedAt: '2026-07-11',
        totalCents: 1000,
        items: [{ name: 'Milk', category: 'dairy', priceCents: 600 }],
      })
    );

    const rows = await getUnitemisedBills(db, JULY);
    const { unitemisedCents } = await getCategoryBreakdown(db, JULY);

    expect(rows.reduce((sum, row) => sum + row.remainderCents, 0)).toBe(unitemisedCents);
  });

  /**
   * Not the same as "bills with no items": a partly itemised receipt, a
   * discount, or an illegible price opens the same gap.
   */
  it('includes a partly itemised bill, not only itemless ones', async () => {
    await createBill(
      db,
      bill({
        totalCents: 1000,
        items: [{ name: 'Milk', category: 'dairy', priceCents: 600 }],
      })
    );

    const [row] = await getUnitemisedBills(db, JULY);
    expect(row.itemisedCents).toBe(600);
    expect(row.remainderCents).toBe(400);
  });

  it('leaves out bills whose items already account for the total', async () => {
    await createBill(db, bill({ totalCents: 1000, items: [{ name: 'Milk', category: 'dairy', priceCents: 1000 }] }));
    expect(await getUnitemisedBills(db, JULY)).toEqual([]);
  });

  /** The question is "what is making up that share", so the biggest leads. */
  it('orders by shortfall, largest first', async () => {
    await createBill(db, bill({ merchant: 'Small', totalCents: 300, items: [] }));
    await createBill(db, bill({ merchant: 'Large', totalCents: 9000, items: [] }));

    const rows = await getUnitemisedBills(db, JULY);
    expect(rows.map((row) => row.merchant)).toEqual(['Large', 'Small']);
  });

  it('is empty when everything in the period is fully itemised', async () => {
    await createBill(db, bill({ totalCents: 1000, items: [{ name: 'Milk', category: 'dairy', priceCents: 1000 }] }));
    expect(await getUnitemisedBills(db, JULY)).toEqual([]);
  });
});

/**
 * Weeks run Monday to Sunday, matching `startOfWeek` and the Monday key the
 * query computes. 2026-09-07 is a Monday, so the fixtures below sit either
 * side of a boundary on purpose.
 */
describe('getWeeklyTrend', () => {
  it('buckets bills into Monday-start weeks', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-07', totalCents: 1000 })); // Mon
    await createBill(db, bill({ purchasedAt: '2026-09-13', totalCents: 500 })); // Sun, same week
    await createBill(db, bill({ purchasedAt: '2026-09-14', totalCents: 300 })); // Mon, next week

    const trend = await getWeeklyTrend(db, 2, '2026-09-14');
    expect(trend).toEqual([
      { weekStart: '2026-09-07', totalCents: 1500, billCount: 2 },
      { weekStart: '2026-09-14', totalCents: 300, billCount: 1 },
    ]);
  });

  it('returns a zero bar for a week with no bills rather than omitting it', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-14', totalCents: 300 }));

    const trend = await getWeeklyTrend(db, 3, '2026-09-14');
    expect(trend.map((week) => week.totalCents)).toEqual([0, 0, 300]);
    expect(trend.map((week) => week.weekStart)).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
    ]);
  });

  /**
   * The reason the query does not use `strftime('%W')`: that counts weeks
   * within a year, so 31 December and 1 January land in different buckets even
   * when they are the same Monday-to-Sunday week.
   */
  it('keeps a week that straddles new year in one bucket', async () => {
    await createBill(db, bill({ purchasedAt: '2026-12-31', totalCents: 400 })); // Thu
    await createBill(db, bill({ purchasedAt: '2027-01-01', totalCents: 600 })); // Fri

    const trend = await getWeeklyTrend(db, 1, '2027-01-01');
    expect(trend).toEqual([{ weekStart: '2026-12-28', totalCents: 1000, billCount: 2 }]);
  });

  it('excludes bills outside the window', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-06', totalCents: 999 })); // Sun before
    await createBill(db, bill({ purchasedAt: '2026-09-08', totalCents: 100 }));

    const trend = await getWeeklyTrend(db, 1, '2026-09-08');
    expect(trend).toEqual([{ weekStart: '2026-09-07', totalCents: 100, billCount: 1 }]);
  });
});
