/**
 * Erasing everything (§15.2), against real SQLite.
 *
 * The thing worth testing is not that bills disappear -- one DELETE does that
 * -- but that the places spending *leaks into* are emptied too. A wipe that
 * left the product cache holding a shopping list, or the conversation holding
 * the user's own words, would report success and be a lie.
 */

import { openTestDriver } from '../support/sqlite-driver';

import { appendMessage, getConversation } from '@/data/conversationRepo';
import type { SqlDriver } from '@/data/driver';
import { CONFIRM_PHRASE, confirmationMatches, eraseEverything, type CacheClears } from '@/data/eraseAll';
import { createBill, getReceiptScans, listBills, replaceReceiptScans } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';
import { logQuery } from '@/data/telemetryRepo';

let db: SqlDriver;

/** Records which caches were asked to clear, so the test can insist on all five. */
function spyCaches(): CacheClears & { cleared: string[] } {
  const cleared: string[] = [];
  return {
    cleared,
    preferences: () => cleared.push('preferences'),
    products: () => cleared.push('products'),
    geocodes: () => cleared.push('geocodes'),
    catalog: () => cleared.push('catalog'),
    hubConfig: () => cleared.push('hubConfig'),
  };
}

const seed = () =>
  createBill(db, {
    merchant: "PAK'nSAVE Mill Street",
    purchasedAt: '2026-09-10',
    totalCents: 1000,
    source: 'receipt',
    items: [{ name: 'Milk', category: 'dairy', qty: 1, unit: 'pc', priceCents: 1000 }],
  });

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

describe('what an erase removes', () => {
  it('takes the bills, and their items and pages with them', async () => {
    const billId = await seed();
    await replaceReceiptScans(db, billId, ['MILK 2L $10.00']);

    const summary = await eraseEverything(db, spyCaches());

    expect(summary.bills).toBe(1);
    expect(await listBills(db)).toEqual([]);
    expect(await getReceiptScans(db, billId)).toEqual([]);
    // The cascade, checked directly rather than trusted.
    const items = await db.all('SELECT id FROM bill_items');
    expect(items).toEqual([]);
  });

  /** §15.3 keeps no question text here, but the usage pattern is still theirs. */
  it('takes the query log', async () => {
    await logQuery(db, {
      route: 'fastpath', outcome: 'ok', latencyMs: 12,
      tokensIn: null, tokensOut: null, modelAlias: null,
    });

    const summary = await eraseEverything(db, spyCaches());

    expect(summary.queryLogRows).toBe(1);
    expect(await db.all('SELECT id FROM query_log')).toEqual([]);
  });

  /** The one store that holds the user's own sentences verbatim. */
  it('takes the saved conversation', async () => {
    await appendMessage(db, { role: 'user', text: 'how much did I spend on milk' });

    await eraseEverything(db, spyCaches());

    expect(await getConversation(db)).toEqual([]);
  });

  /**
   * The caches are the easy ones to forget: neither is a row the user
   * created, and between them they reconstruct what was bought and where.
   */
  it('clears every cache, not merely the database', async () => {
    const caches = spyCaches();

    await eraseEverything(db, caches);

    expect(caches.cleared.sort()).toEqual(
      ['catalog', 'geocodes', 'hubConfig', 'preferences', 'products'].sort()
    );
  });

  it('reports nothing deleted when there was nothing there', async () => {
    const summary = await eraseEverything(db, spyCaches());
    expect(summary).toEqual({ bills: 0, queryLogRows: 0 });
  });

  it('can be run twice without complaint', async () => {
    await seed();
    await eraseEverything(db, spyCaches());
    await expect(eraseEverything(db, spyCaches())).resolves.toEqual({
      bills: 0,
      queryLogRows: 0,
    });
  });

  /**
   * A count is what lets the screen say "47 bills deleted" instead of "done".
   * An irreversible action should report what it actually did.
   */
  it('counts what it removed', async () => {
    await seed();
    await seed();
    await seed();

    expect((await eraseEverything(db, spyCaches())).bills).toBe(3);
  });
});

describe('the phrase that has to be typed', () => {
  it('accepts the word', () => {
    expect(confirmationMatches(CONFIRM_PHRASE)).toBe(true);
  });

  /** Forgiving about how it was typed... */
  it('forgives case and stray spaces', () => {
    expect(confirmationMatches('  delete ')).toBe(true);
    expect(confirmationMatches('Delete')).toBe(true);
  });

  /** ...and unforgiving about anything that is not the word. */
  it.each(['', 'del', 'deleted', 'DELETE ALL', 'yes'])('refuses %p', (typed) => {
    expect(confirmationMatches(typed)).toBe(false);
  });
});
