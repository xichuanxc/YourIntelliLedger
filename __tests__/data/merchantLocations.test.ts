/**
 * Merchants that can go on a map (§4.14).
 *
 * The behaviour worth pinning is what happens at the edges: a shop whose
 * receipts only sometimes carry an address, a shop that moved, and a shop with
 * no address at all. Each has a wrong answer that looks reasonable — dropping
 * the shop's spending, pinning it at its old site, or inventing a location.
 */

import { openTestDriver } from '../support/sqlite-driver';

import type { Period } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';
import { getMerchantLocations } from '@/data/insightsRepo';
import { createBill } from '@/data/ledgerRepo';
import { migrate } from '@/data/migrate';
import type { NewBillInput } from '@/types/ledger';

let db: SqlDriver;

const SEPTEMBER: Period = { from: '2026-09-01', to: '2026-09-30' };

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

const bill = (overrides: Partial<NewBillInput> = {}): NewBillInput => ({
  merchant: 'New World',
  merchantAddress: '44 Horsham Downs Road, Rototuna, Hamilton',
  purchasedAt: '2026-09-10',
  totalCents: 1000,
  source: 'manual',
  items: [{ name: 'Milk', category: 'dairy', priceCents: 1000 }],
  ...overrides,
});

describe('placing merchants', () => {
  it('groups a shop across its bills and totals all of them', async () => {
    await createBill(db, bill({ totalCents: 1500, purchasedAt: '2026-09-02' }));
    await createBill(db, bill({ totalCents: 2500, purchasedAt: '2026-09-20' }));

    const [place] = await getMerchantLocations(db, SEPTEMBER);
    expect(place.merchant).toBe('New World');
    expect(place.totalCents).toBe(4000);
    expect(place.billCount).toBe(2);
  });

  /**
   * A receipt that printed no address must not cost the shop its spending —
   * the pin locates the merchant, it does not decide what counts.
   */
  it('counts a bill with no address against the shop that has one', async () => {
    await createBill(db, bill({ totalCents: 1000, purchasedAt: '2026-09-02' }));
    await createBill(db, bill({ totalCents: 3000, purchasedAt: '2026-09-03', merchantAddress: null }));

    const [place] = await getMerchantLocations(db, SEPTEMBER);
    expect(place.totalCents).toBe(4000);
    expect(place.address).toBe('44 Horsham Downs Road, Rototuna, Hamilton');
  });

  /** A shop that moved is pinned where it is now, not where it was. */
  it('takes the address from the most recent bill that carried one', async () => {
    await createBill(
      db,
      bill({ purchasedAt: '2026-09-02', merchantAddress: '1 Old Street, Hamilton' })
    );
    await createBill(
      db,
      bill({ purchasedAt: '2026-09-25', merchantAddress: '2 New Street, Hamilton' })
    );

    const [place] = await getMerchantLocations(db, SEPTEMBER);
    expect(place.address).toBe('2 New Street, Hamilton');
  });

  /** No honest pin exists, and the breakdown still shows the spending. */
  it('leaves out a merchant with no address anywhere in the period', async () => {
    await createBill(db, bill({ merchant: 'Corner Dairy', merchantAddress: null }));

    expect(await getMerchantLocations(db, SEPTEMBER)).toEqual([]);
  });

  it('orders by spend, biggest first', async () => {
    await createBill(db, bill({ merchant: 'New World', totalCents: 1000 }));
    await createBill(db, bill({ merchant: 'Countdown', totalCents: 6000 }));

    const places = await getMerchantLocations(db, SEPTEMBER);
    expect(places.map((place) => place.merchant)).toEqual(['Countdown', 'New World']);
  });

  /**
   * The limit counts mappable merchants. Applying it in SQL would return two
   * when asked for three, because the addressless ones were taken first.
   */
  it('fills the limit with merchants that can actually be placed', async () => {
    await createBill(db, bill({ merchant: 'Big Spend', totalCents: 9000, merchantAddress: null }));
    await createBill(db, bill({ merchant: 'New World', totalCents: 2000 }));
    await createBill(db, bill({ merchant: 'Countdown', totalCents: 3000 }));

    const places = await getMerchantLocations(db, SEPTEMBER, 2);
    expect(places.map((place) => place.merchant)).toEqual(['Countdown', 'New World']);
  });

  it('ignores bills outside the period', async () => {
    await createBill(db, bill({ purchasedAt: '2026-08-31', totalCents: 5000 }));
    await createBill(db, bill({ purchasedAt: '2026-09-05', totalCents: 1000 }));

    const [place] = await getMerchantLocations(db, SEPTEMBER);
    expect(place.totalCents).toBe(1000);
  });
});
