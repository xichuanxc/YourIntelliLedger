/**
 * Answering without a model (§6.6), against real SQLite.
 *
 * Two properties matter more than any individual sentence.
 *
 * **The numbers must match the rest of the app.** Every figure comes from the
 * same repositories the Insights screen reads, so a fastpath total and an
 * Insights total cannot disagree. The tests assert cents, taken from the
 * render series, rather than formatted strings — `formatMoney` goes through
 * `Intl`, and asserting its output would make this suite depend on the node
 * locale.
 *
 * **A fastpath must decline rather than guess.** Returning null hands the
 * question to the agent, which still answers it correctly.
 */

import { openTestDriver } from '../support/sqlite-driver';

import type { SqlDriver } from '@/data/driver';
import { createBill } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';
import { tryFastpath } from '@/fastpath';
import type { LocalDate } from '@/types/ledger';
import type { NewBillInput } from '@/types/ledger';

let db: SqlDriver;

const TODAY = '2026-09-14' as LocalDate;
const ask = (question: string) => tryFastpath(question, { db, today: TODAY });

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const bill = (overrides: Partial<NewBillInput> = {}): NewBillInput => ({
  merchant: 'New World',
  purchasedAt: '2026-09-10',
  totalCents: 1000,
  source: 'manual',
  items: [{ name: 'Milk', category: 'dairy', priceCents: 1000 }],
  ...overrides,
});

/** The amounts a render block is plotting, back in cents. */
const plotted = (result: Awaited<ReturnType<typeof ask>>) =>
  result?.envelope.render?.series?.[0].values.map((value) => Math.round(value * 100));

describe('totals', () => {
  it('adds up a month from printed bill totals', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-02', totalCents: 1500 }));
    await createBill(db, bill({ purchasedAt: '2026-09-20', totalCents: 2500 }));
    // August, so outside "this month".
    await createBill(db, bill({ purchasedAt: '2026-08-30', totalCents: 9900 }));

    const result = await ask('how much did I spend this month?');

    expect(result?.intent).toBe('total');
    expect(result?.envelope.text).toContain('2 bills');
    // 40.00, not 139.00 — August must not leak in.
    expect(result?.envelope.text).toMatch(/40\.00/);
  });

  /**
   * The itemless-bill rule (§14.6). A receipt whose total was legible but
   * whose items were not still belongs in a plain total.
   */
  it('counts a bill with no items at all', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-05', totalCents: 3000, items: [] }));

    const result = await ask('how much did I spend this month?');
    expect(result?.envelope.text).toMatch(/30\.00/);
  });

  it('answers about the whole ledger when no period is named', async () => {
    await createBill(db, bill({ purchasedAt: '2025-01-05', totalCents: 1000 }));
    await createBill(db, bill({ purchasedAt: '2026-09-05', totalCents: 2000 }));

    const result = await ask('how much have I spent in total');
    expect(result?.envelope.text).toMatch(/30\.00/);
  });

  it('says so plainly when there are no bills', async () => {
    const result = await ask('how much did I spend this month?');
    expect(result?.envelope.text).toMatch(/no bills/i);
  });
});

describe('categories', () => {
  it('sums item prices for the category asked about', async () => {
    await createBill(
      db,
      bill({
        purchasedAt: '2026-09-03',
        totalCents: 2000,
        items: [
          { name: 'Milk', category: 'dairy', priceCents: 700 },
          { name: 'Cheese', category: 'dairy', priceCents: 800 },
          { name: 'Apples', category: 'produce', priceCents: 500 },
        ],
      })
    );

    const result = await ask('how much did I spend on dairy this month');
    expect(result?.intent).toBe('category_spend');
    expect(result?.envelope.text).toMatch(/15\.00/);
    expect(result?.envelope.text).toContain('dairy');
  });

  /**
   * The §14.6 gap, said out loud: categories live on items, so an itemless
   * bill belongs to no category. Quoting a category figure without mentioning
   * it invites the user to add them up and find them short.
   */
  it('names the spending that belongs to no category', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-03', totalCents: 1000 }));
    await createBill(db, bill({ purchasedAt: '2026-09-04', totalCents: 4000, items: [] }));

    const result = await ask('how much did I spend on dairy this month');
    expect(result?.envelope.text).toMatch(/not itemised/i);
    expect(result?.envelope.text).toMatch(/40\.00/);
  });

  it('does not pretend a category is missing data', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-03' }));

    const result = await ask('how much did I spend on meat this month');
    expect(result?.envelope.text).toMatch(/nothing/i);
  });
});

describe('merchants', () => {
  it('matches a shop however it was spelled', async () => {
    await createBill(db, bill({ merchant: "PAK'nSAVE Mill Street", totalCents: 4200 }));

    const result = await ask('how much did I spend at paknsave');
    expect(result?.intent).toBe('merchant_spend');
    expect(result?.envelope.text).toMatch(/42\.00/);
  });

  /** A shop this ledger has never seen belongs to the agent, not here. */
  it('declines a shop that is not in the ledger', async () => {
    await createBill(db, bill({ merchant: 'New World' }));
    expect(await ask('how much did I spend at Aldi')).toBeNull();
  });
});

describe('recent bills', () => {
  it('lists them newest first, and links each to its receipt', async () => {
    await createBill(db, bill({ merchant: 'New World', purchasedAt: '2026-09-01' }));
    await createBill(db, bill({ merchant: 'Countdown', purchasedAt: '2026-09-11' }));

    const result = await ask('show me my last 2 bills');

    expect(result?.intent).toBe('recent_bills');
    expect(result?.envelope.text.indexOf('Countdown')).toBeLessThan(
      result!.envelope.text.indexOf('New World')
    );
    expect(result?.references.map((reference) => reference.label)).toEqual([
      'Countdown',
      'New World',
    ]);
  });
});

describe('this month against last', () => {
  it('compares the two months and plots both', async () => {
    await createBill(db, bill({ purchasedAt: '2026-08-10', totalCents: 5000 }));
    await createBill(db, bill({ purchasedAt: '2026-09-10', totalCents: 2000 }));

    const result = await ask('this month vs last month');

    expect(result?.intent).toBe('month_vs_month');
    expect(plotted(result)).toEqual([5000, 2000]);
    expect(result?.envelope.text).toMatch(/less/);
    // An incomplete month compared against a whole one is not like-for-like,
    // and the answer has to say so.
    expect(result?.envelope.text).toMatch(/not over yet/i);
  });
});

describe('superlatives', () => {
  it('names the biggest category and charts the breakdown', async () => {
    await createBill(
      db,
      bill({
        purchasedAt: '2026-09-03',
        totalCents: 3000,
        items: [
          { name: 'Steak', category: 'meat', priceCents: 2000 },
          { name: 'Milk', category: 'dairy', priceCents: 1000 },
        ],
      })
    );

    const result = await ask('what do I spend the most on this month?');

    expect(result?.intent).toBe('top_category');
    expect(result?.envelope.text).toContain('meat');
    expect(plotted(result)).toEqual([2000, 1000]);
  });

  it('names the shop with the most spend', async () => {
    await createBill(db, bill({ merchant: 'New World', totalCents: 1000 }));
    await createBill(db, bill({ merchant: 'Countdown', totalCents: 6000 }));

    const result = await ask('which shop do I spend most at this month?');

    expect(result?.intent).toBe('top_merchant');
    expect(result?.envelope.text).toContain('Countdown');
  });
});

/**
 * The wiring, not the generator — that has its own suite. This checks a real
 * answer off a real database carries the suggestions the chips read, which is
 * the part that would silently do nothing if they were attached in the wrong
 * place.
 */
describe('suggesting what to ask next', () => {
  it('carries followups the fastpath can answer', async () => {
    await createBill(db, bill({ purchasedAt: '2026-09-05', totalCents: 2500 }));

    const result = await ask('how much did I spend this month?');

    expect(result?.envelope.followups?.length).toBeGreaterThan(0);
    for (const followup of result!.envelope.followups!) {
      expect(await ask(followup)).not.toBeNull();
    }
  });

  /** Offering more questions about an empty ledger is noise. */
  it('offers nothing when there was nothing to add up', async () => {
    const result = await ask('how much did I spend this month?');

    expect(result?.envelope.text).toMatch(/no bills/i);
    expect(result?.envelope.followups).toBeUndefined();
  });
});

describe('handing back to the agent', () => {
  it('returns null for a question it cannot answer', async () => {
    await createBill(db, bill());
    expect(await ask('what is the cheapest milk I have bought')).toBeNull();
    expect(await ask('why did I spend so much')).toBeNull();
  });

  /** §6.8's budget. The bar is p95 < 100 ms; a seeded query is far under it. */
  it('answers well inside the latency budget', async () => {
    await createBill(db, bill());
    const result = await ask('how much did I spend this month?');
    expect(result!.latencyMs).toBeLessThan(100);
  });
});
