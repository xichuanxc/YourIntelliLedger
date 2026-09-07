/**
 * §6.3's data catalog.
 *
 * The tests worth having here are the two that would fail silently in
 * production: that the cache invalidates on every kind of write (a stale
 * catalog tells the model the ledger ends in July for as long as it lives),
 * and that the thing stays inside its token budget (it sits in front of every
 * conversation, so a merchant list that grows without bound is paid for on
 * every turn).
 */

import { openTestDriver } from '../support/sqlite-driver';

import {
  MAX_MERCHANTS,
  createMemoryCatalogCache,
  getDataCatalog,
  renderCatalog,
  type CatalogCache,
} from '@/agent/catalog';
import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';
import { normaliseMerchant } from '@/data/merchant';
import { CATEGORIES } from '@/types/vocabulary';

const NOW = '2026-07-20T00:00:00.000Z';

let nextId = 1;

async function addBill(
  db: SqlDriver,
  merchant: string | null,
  date: string,
  total = 1000,
  currency = 'NZD'
): Promise<number> {
  const id = nextId++;
  await db.run(
    `INSERT INTO bills (id, merchant, merchant_norm, purchased_at, total_cents, currency,
                        source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'receipt', ?, ?)`,
    [id, merchant, normaliseMerchant(merchant), date, total, currency, NOW, NOW]
  );
  return id;
}

async function addItem(db: SqlDriver, billId: number, name: string): Promise<void> {
  await db.run(
    `INSERT INTO bill_items (bill_id, line_no, name, category, price_cents)
     VALUES (?, 1, ?, 'other', 100)`,
    [billId, name]
  );
}

describe('the catalog itself', () => {
  let db: SqlDriver;
  let cache: CatalogCache;

  beforeEach(async () => {
    nextId = 1;
    db = openTestDriver();
    await migrate(db);
    cache = createMemoryCatalogCache();
  });

  afterEach(async () => {
    await db.close();
  });

  it('describes an empty ledger without pretending it has data', async () => {
    const catalog = await getDataCatalog(db, cache);
    expect(catalog).toEqual({
      categories: CATEGORIES,
      merchants_top: [],
      data_range: { first_bill: null, last_bill: null },
      currency: 'NZD',
      bill_count: 0,
    });
  });

  /**
   * §14.1 does not enumerate categories anywhere the model can see — the
   * filter `value` is untyped — so this list is the only place it learns them.
   * Listing only the categories with spending would let it conclude `frozen`
   * is not askable, when the true answer is "nothing yet".
   */
  it('offers the whole vocabulary, not just the categories in use', async () => {
    await addBill(db, 'Countdown', '2026-06-01');
    const catalog = await getDataCatalog(db, cache);
    expect(catalog.categories).toEqual(CATEGORIES);
  });

  it('reports the range and count', async () => {
    await addBill(db, 'Countdown', '2026-02-03');
    await addBill(db, 'New World', '2026-07-19');
    const catalog = await getDataCatalog(db, cache);
    expect(catalog).toMatchObject({
      data_range: { first_bill: '2026-02-03', last_bill: '2026-07-19' },
      bill_count: 2,
    });
  });

  it('groups one shop into one entry but names it as printed (§4.8)', async () => {
    await addBill(db, "PAK'nSAVE Mill Street", '2026-06-01');
    await addBill(db, "pak'nsave mill street", '2026-06-08');
    await addBill(db, "PAK'nSAVE Mill Street", '2026-07-01');
    const catalog = await getDataCatalog(db, cache);
    // One entry, spelled the way the most recent receipt printed it — these
    // strings are echoed back to the user, so the normalised form would read
    // as a bug.
    expect(catalog.merchants_top).toEqual(["PAK'nSAVE Mill Street"]);
  });

  it('ranks by how often a shop appears', async () => {
    await addBill(db, 'Countdown', '2026-06-01');
    await addBill(db, 'Countdown', '2026-06-02');
    await addBill(db, 'New World', '2026-06-03');
    const catalog = await getDataCatalog(db, cache);
    expect(catalog.merchants_top).toEqual(['Countdown', 'New World']);
  });

  it('keeps the list short enough to pay for on every turn', async () => {
    for (let i = 0; i < MAX_MERCHANTS + 5; i += 1) {
      await addBill(db, 'Shop number ' + i, '2026-06-01');
    }
    const catalog = await getDataCatalog(db, cache);
    expect(catalog.merchants_top).toHaveLength(MAX_MERCHANTS);
  });

  it('stays inside §6.3’s ~100-token budget with a realistic ledger', async () => {
    const merchants = [
      "PAK'nSAVE Mill Street",
      'Countdown Hamilton East',
      'New World Te Rapa',
      'The Warehouse Te Rapa',
      'Chemist Warehouse',
      'Asian Food Market',
      'Bunnings Warehouse',
      'Night n Day',
    ];
    for (const [index, merchant] of merchants.entries()) {
      await addBill(db, merchant, '2026-0' + ((index % 6) + 1) + '-05');
    }
    const rendered = renderCatalog(await getDataCatalog(db, cache));
    // Roughly four characters to a token, so ~500 characters is the budget.
    expect(rendered.length).toBeLessThan(520);
  });

  it('skips merchantless bills rather than listing an empty name', async () => {
    await addBill(db, null, '2026-06-01');
    await addBill(db, 'Countdown', '2026-06-02');
    const catalog = await getDataCatalog(db, cache);
    expect(catalog.merchants_top).toEqual(['Countdown']);
  });

  it('reports the currency most bills are in', async () => {
    await addBill(db, 'Countdown', '2026-06-01', 1000, 'NZD');
    await addBill(db, 'Coles', '2026-06-02', 1000, 'AUD');
    await addBill(db, 'Woolworths', '2026-06-03', 1000, 'AUD');
    expect((await getDataCatalog(db, cache)).currency).toBe('AUD');
  });
});

/**
 * §6.3 says "invalidated on bill write". The stamp is derived from the data
 * rather than bumped by a hook, so these cases also cover the write path
 * nobody has written yet.
 */
describe('invalidation', () => {
  let db: SqlDriver;
  let cache: CatalogCache;

  beforeEach(async () => {
    nextId = 1;
    db = openTestDriver();
    await migrate(db);
    cache = createMemoryCatalogCache();
    await addBill(db, 'Countdown', '2026-06-01');
    await getDataCatalog(db, cache);
  });

  afterEach(async () => {
    await db.close();
  });

  it('serves the cache while the ledger has not moved', async () => {
    const spy = jest.spyOn(db, 'all');
    await getDataCatalog(db, cache);
    // The stamp query uses `get`, so a cache hit issues no `all` at all.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each([
    ['a new bill', async (database: SqlDriver) => void (await addBill(database, 'New World', '2026-07-01'))],
    ['a deleted bill', async (database: SqlDriver) => void (await database.run('DELETE FROM bills WHERE id = 1'))],
    ['a new item', async (database: SqlDriver) => void (await addItem(database, 1, 'milk'))],
    [
      'an edited bill',
      async (database: SqlDriver) =>
        void (await database.run('UPDATE bills SET updated_at = ? WHERE id = 1', [
          '2026-08-01T00:00:00.000Z',
        ])),
    ],
  ])('rebuilds after %s', async (_label, mutate) => {
    const before = cache.read()!.stamp;
    await mutate(db);
    await getDataCatalog(db, cache);
    expect(cache.read()!.stamp).not.toBe(before);
  });

  it('reflects the change rather than the stale answer', async () => {
    await addBill(db, 'New World', '2026-07-19');
    const catalog = await getDataCatalog(db, cache);
    expect(catalog).toMatchObject({
      bill_count: 2,
      data_range: { last_bill: '2026-07-19' },
    });
  });
});
