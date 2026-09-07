/**
 * §14.6 — spec to SQL.
 *
 * Two of these tests are the reason the file exists.
 *
 * **The itemless bill.** §5.1 makes a bill with a legible total but no legible
 * items a normal outcome, and such a bill has zero rows in `bill_items`. A
 * plain "how much did I spend" that joins through items drops it silently, so
 * every monthly total comes out low by exactly the itemless bills — no error,
 * no empty result, just wrong numbers a user has no way to catch. The mixed
 * fixture below has one itemised and one itemless bill in the same month, and
 * asserts the plain total is the sum of `total_cents` and *not* the sum of
 * items.
 *
 * **No user-supplied literals.** §14.6 requires this as a test as well as a
 * lint rule, so the SQL is searched for the values it was given.
 */

import { openTestDriver } from '../support/sqlite-driver';

import { compileQuery } from '@/agent/compile';
import { validateToolCall, type ValidatedQuery, type ValidationContext } from '@/agent/validate';
import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';

const context: ValidationContext = { today: '2026-07-15', firstBill: '2026-01-01' };

/** Goes through the validator, because nothing else may produce a spec. */
function spec(args: unknown): ValidatedQuery {
  const result = validateToolCall('query_ledger', args, context);
  if (!result.ok) throw new Error('fixture did not validate: ' + result.message);
  if (result.call.name !== 'query_ledger') throw new Error('wrong tool');
  return result.call.args;
}

function compile(args: unknown) {
  return compileQuery(spec(args));
}

// ------------------------------------------------------------- fixtures ---

const NOW = '2026-07-20T00:00:00.000Z';

async function insertBill(
  db: SqlDriver,
  bill: { id: number; merchant: string; norm: string; date: string; total: number }
): Promise<void> {
  await db.run(
    `INSERT INTO bills (id, merchant, merchant_norm, purchased_at, total_cents, source,
                        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'receipt', ?, ?)`,
    [bill.id, bill.merchant, bill.norm, bill.date, bill.total, NOW, NOW]
  );
}

async function insertItem(
  db: SqlDriver,
  item: {
    billId: number;
    line: number;
    name: string;
    nameLocal?: string | null;
    category: string;
    price: number;
  }
): Promise<void> {
  await db.run(
    `INSERT INTO bill_items (bill_id, line_no, name, name_local, category, price_cents)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [item.billId, item.line, item.name, item.nameLocal ?? null, item.category, item.price]
  );
}

/**
 * June holds one itemised bill ($50, items $20 + $30) and one itemless bill
 * ($40). The plain June total is therefore $90, while the sum of June's items
 * is $50 — and the gap is the whole point.
 */
async function seed(db: SqlDriver): Promise<void> {
  await insertBill(db, {
    id: 1,
    merchant: "PAK'nSAVE Mill Street",
    norm: 'paknsave mill street',
    date: '2026-06-05',
    total: 5000,
  });
  await insertItem(db, { billId: 1, line: 1, name: 'milk 2l', category: 'dairy', price: 2000 });
  await insertItem(db, { billId: 1, line: 2, name: 'beef mince', category: 'meat', price: 3000 });

  await insertBill(db, {
    id: 2,
    merchant: 'Countdown',
    norm: 'countdown',
    date: '2026-06-12',
    total: 4000,
  });
  // Deliberately no items — a receipt whose total was legible and whose lines
  // were not (§5.1).

  await insertBill(db, {
    id: 3,
    merchant: 'Countdown',
    norm: 'countdown',
    date: '2026-07-02',
    total: 1000,
  });
  await insertItem(db, {
    billId: 3,
    line: 1,
    name: 'dried tofu',
    nameLocal: '豆腐干',
    category: 'produce',
    price: 1000,
  });
}

describe('against a real database', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = openTestDriver();
    await migrate(db);
    await seed(db);
  });

  afterEach(async () => {
    await db.close();
  });

  async function run<T>(args: unknown): Promise<T[]> {
    const compiled = compile(args);
    return db.all<T>(compiled.sql, compiled.params);
  }

  it('counts itemless bills in a plain total (§14.6)', async () => {
    const rows = await run<{ value: number }>({
      metric: 'sum_amount',
      time_range: { unit: 'month', last: 2 },
      filters: [],
    });
    // $50 itemised + $40 itemless + $10 in July = $100. Joining through
    // bill_items would give $60 and look entirely plausible.
    expect(rows[0].value).toBe(10000);
  });

  it('still totals the itemless bill when grouped by month', async () => {
    const rows = await run<{ bucket: string; value: number }>({
      metric: 'sum_amount',
      dimension: 'month',
      time_range: { unit: 'month', last: 2 },
      sort: 'date_asc',
    });
    expect(rows).toEqual([
      { bucket: '2026-06', value: 9000 },
      { bucket: '2026-07', value: 1000 },
    ]);
  });

  it('and when grouped by merchant', async () => {
    const rows = await run<{ bucket: string; value: number }>({
      metric: 'sum_amount',
      dimension: 'merchant',
      time_range: { unit: 'month', last: 2 },
    });
    expect(rows).toEqual([
      { bucket: 'countdown', value: 5000 },
      { bucket: 'paknsave mill street', value: 5000 },
    ]);
  });

  /**
   * The category breakdown legitimately misses the itemless bill — only items
   * carry a category, so there is nothing to attribute. Asserted so the gap is
   * a documented difference rather than a suspected bug.
   */
  it('a category breakdown covers only itemised spend, by definition', async () => {
    const rows = await run<{ bucket: string; value: number }>({
      metric: 'sum_amount',
      dimension: 'category',
      time_range: { unit: 'month', last: 2 },
    });
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    expect(total).toBe(6000);
    expect(rows).toEqual([
      { bucket: 'meat', value: 3000 },
      { bucket: 'dairy', value: 2000 },
      { bucket: 'produce', value: 1000 },
    ]);
  });

  it('does not multiply a bill by its items when filtering on one', async () => {
    // Bill 1 has two items. A join would return it twice and double $50.
    const rows = await run<{ value: number }>({
      metric: 'sum_amount',
      filters: [{ field: 'merchant', op: 'eq', value: "PAK'nSAVE Mill Street" }],
    });
    expect(rows[0].value).toBe(5000);
  });

  it('lists bills narrowed by an item filter without counting them twice', async () => {
    const rows = await run<{ id: number; total_cents: number }>({
      metric: 'list_bills',
      filters: [{ field: 'category', op: 'in', value: ['dairy', 'meat'] }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 1, total_cents: 5000 });
  });

  it('matches a local-language name as well as the English one (§4.7)', async () => {
    const byLocal = await run<{ id: number }>({
      metric: 'list_items',
      filters: [{ field: 'name', op: 'contains', value: '豆腐干' }],
    });
    const byEnglish = await run<{ id: number }>({
      metric: 'list_items',
      filters: [{ field: 'name', op: 'contains', value: 'tofu' }],
    });
    expect(byLocal).toHaveLength(1);
    expect(byEnglish).toEqual(byLocal);
  });

  it('normalises the merchant the model typed the way §4.8 stored it', async () => {
    const rows = await run<{ value: number }>({
      metric: 'count',
      // Apostrophe, casing and spacing all differ from `merchant_norm`.
      filters: [{ field: 'merchant', op: 'eq', value: "pak'n save mill street" }],
    });
    // Normalisation drops punctuation but not the space, so this is a
    // different shop name and finds nothing — the honest answer.
    expect(rows[0].value).toBe(0);

    const exact = await run<{ value: number }>({
      metric: 'count',
      filters: [{ field: 'merchant', op: 'eq', value: "PAK'NSAVE Mill Street" }],
    });
    expect(exact[0].value).toBe(1);
  });

  it('treats % in a search as a character, not a wildcard', async () => {
    await insertBill(db, {
      id: 4,
      merchant: '50% Off Store',
      norm: '50 off store',
      date: '2026-07-03',
      total: 100,
    });
    // A term that normalises away must match nothing. The tempting
    // implementation binds an empty string, and `LIKE '%' || '' || '%'`
    // matches *every* row — a filter the user asked for silently becoming no
    // filter at all. This test caught exactly that.
    const wildcard = await run<{ value: number }>({
      metric: 'count',
      filters: [{ field: 'merchant', op: 'contains', value: '%' }],
    });
    expect(wildcard[0].value).toBe(0);

    // But a term that survives normalisation still finds the shop, punctuation
    // and all: '50%' normalises to '50', and the stored form is '50 off store'.
    const real = await run<{ value: number }>({
      metric: 'count',
      filters: [{ field: 'merchant', op: 'contains', value: '50%' }],
    });
    expect(real[0].value).toBe(1);

    const literal = await run<{ id: number; name: string }>({
      metric: 'list_items',
      filters: [{ field: 'name', op: 'contains', value: '%' }],
    });
    expect(literal).toEqual([]);
  });

  it('applies a default limit so an unbounded list cannot flood the prompt', async () => {
    const compiled = compile({ metric: 'list_items' });
    expect(compiled.params.at(-1)).toBe(50);
  });

  it('returns null, not zero, for the average of nothing', async () => {
    const rows = await run<{ value: number | null }>({
      metric: 'avg_amount',
      filters: [{ field: 'merchant', op: 'eq', value: 'Nowhere Ltd' }],
    });
    expect(rows[0].value).toBeNull();
  });
});

describe('the statement itself', () => {
  it('binds every value and interpolates none (§14.6)', () => {
    const compiled = compile({
      metric: 'sum_amount',
      dimension: 'month',
      filters: [
        { field: 'merchant', op: 'contains', value: "'; DROP TABLE bills;--" },
        { field: 'name', op: 'in', value: ['sentinel-alpha', 'sentinel-beta'] },
        { field: 'category', op: 'eq', value: 'meat' },
      ],
      time_range: { unit: 'month', last: 3 },
      limit: 10,
    });

    for (const literal of ['DROP', 'sentinel-alpha', 'sentinel-beta', '2026-05-01']) {
      expect(compiled.sql).not.toContain(literal);
    }
    // `meat` is a validated enum, so it is bound rather than written in.
    expect(compiled.params).toContain('meat');
    expect(compiled.sql.split('?')).toHaveLength(compiled.params.length + 1);
  });

  it('reports which source the numbers came from', () => {
    expect(compile({ metric: 'sum_amount' })).toMatchObject({ grain: 'bill', shape: 'scalar' });
    expect(compile({ metric: 'sum_amount', dimension: 'category' })).toMatchObject({
      grain: 'item',
      shape: 'groups',
    });
    expect(compile({ metric: 'list_bills' })).toMatchObject({ grain: 'bill', shape: 'bills' });
    expect(compile({ metric: 'list_items' })).toMatchObject({ grain: 'item', shape: 'items' });
  });

  it('sums bill totals unless an item column is actually needed', () => {
    expect(compile({ metric: 'sum_amount', dimension: 'month' }).sql).toContain(
      'SUM(bills.total_cents)'
    );
    expect(
      compile({
        metric: 'sum_amount',
        filters: [{ field: 'name', op: 'contains', value: 'milk' }],
      }).sql
    ).toContain('SUM(bill_items.price_cents)');
  });

  it('reaches item filters through EXISTS when the question is about bills', () => {
    const compiled = compile({
      metric: 'list_bills',
      filters: [{ field: 'category', op: 'eq', value: 'meat' }],
    });
    expect(compiled.sql).toContain('EXISTS (SELECT 1 FROM bill_items');
    expect(compiled.sql).not.toContain('JOIN bill_items');
  });

  it('orders deterministically so a limit does not return a different slice each time', () => {
    expect(compile({ metric: 'list_bills' }).sql).toContain('bills.id DESC');
    expect(compile({ metric: 'list_items' }).sql).toContain('bill_items.id DESC');
    expect(compile({ metric: 'count', dimension: 'category' }).sql).toContain('bucket ASC');
  });
});
