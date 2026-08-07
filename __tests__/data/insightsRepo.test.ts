import { openTestDriver } from '../support/sqlite-driver';

import type { Period } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';
import {
  getCategoryBreakdown,
  getDataRange,
  getLatestMonth,
  getMerchantBreakdown,
  getMonthlyTrend,
  getSpendSummary,
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
