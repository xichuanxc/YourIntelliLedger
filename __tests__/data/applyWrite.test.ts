/**
 * Committing a confirmed write (§6.4, §6.8), against real SQLite.
 *
 * Two things are worth pinning. The field mapping, because the tool speaks
 * snake_case and the ledger speaks camelCase, and a dropped field means a
 * card that said it changed a price and did not. And that the repository's
 * own refusals survive — a bill deleted from another screen while the card
 * waited must fail loudly rather than report a success that did not happen.
 */

import { openTestDriver } from '../support/sqlite-driver';

import type { PendingWrite } from '@/agent/execute';
import { applyPendingWrite, toItemPatch } from '@/data/applyWrite';
import type { SqlDriver } from '@/data/driver';
import { createBill, getBill, listBills } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const seed = () =>
  createBill(db, {
    merchant: 'New World',
    purchasedAt: '2026-09-10',
    totalCents: 1000,
    source: 'manual',
    items: [{ name: 'Milk', category: 'dairy', qty: 1, unit: 'pc', priceCents: 1000 }],
  });

describe('the field mapping', () => {
  it('carries every field the tool offers', () => {
    expect(
      toItemPatch({ name: 'Milk 2L', category: 'dairy', qty: 2, unit: 'l', price_cents: 450 })
    ).toEqual({ name: 'Milk 2L', category: 'dairy', qty: 2, unit: 'l', priceCents: 450 });
  });

  /** A patch is partial: an absent field means "leave it", not "clear it". */
  it('leaves out what was not asked for', () => {
    expect(toItemPatch({ price_cents: 450 })).toEqual({ priceCents: 450 });
    expect(toItemPatch({})).toEqual({});
  });

  /** Zero is a value someone meant, not an absence. */
  it('keeps a zero', () => {
    expect(toItemPatch({ price_cents: 0, qty: 0 })).toEqual({ priceCents: 0, qty: 0 });
  });
});

describe('applying a write', () => {
  it('updates the item the model named', async () => {
    const billId = await seed();
    const [item] = (await getBill(db, billId))!.items;

    const write: PendingWrite = {
      name: 'update_bill_item',
      args: { bill_item_id: item.id, set: { name: 'Milk 2L', price_cents: 450 } },
    };
    await applyPendingWrite(db, write);

    const [updated] = (await getBill(db, billId))!.items;
    expect(updated.name).toBe('Milk 2L');
    expect(updated.priceCents).toBe(450);
    // Untouched fields stay as they were.
    expect(updated.category).toBe('dairy');
  });

  it('deletes the bill the model named', async () => {
    const billId = await seed();

    await applyPendingWrite(db, { name: 'delete_bill', args: { bill_id: billId } });

    expect(await getBill(db, billId)).toBeNull();
    expect(await listBills(db)).toEqual([]);
  });

  /**
   * The card may have waited while the bill was deleted from the ledger
   * screen. Reporting success then would leave the user believing a change
   * happened to something that no longer exists.
   */
  it('refuses a bill that is already gone', async () => {
    const billId = await seed();
    await applyPendingWrite(db, { name: 'delete_bill', args: { bill_id: billId } });

    await expect(
      applyPendingWrite(db, { name: 'delete_bill', args: { bill_id: billId } })
    ).rejects.toThrow();
  });

  it('refuses an item that is already gone', async () => {
    await expect(
      applyPendingWrite(db, {
        name: 'update_bill_item',
        args: { bill_item_id: 9999, set: { price_cents: 1 } },
      })
    ).rejects.toThrow();
  });
});
