/**
 * One place, one pin (§4.14).
 *
 * The case this exists for: a shop whose name OCR read two different ways is
 * two merchants in the database and one shop in the world. On a map that was
 * two pins on the same spot, each showing part of what was spent there —
 * which is worse than wrong, because both numbers look plausible.
 */

import type { GeoPoint } from '@/maps/geocode';
import { mergeSpots, type LocatedMerchant } from '@/maps/spots';
import type { MerchantLocation } from '@/types/insights';

const HAMILTON: GeoPoint = { lat: -37.7871, lon: 175.2793 };
/** Same building, as a second geocode of a differently-printed address. */
const HAMILTON_NEARLY: GeoPoint = { lat: -37.78712, lon: 175.27932 };
const TE_RAPA: GeoPoint = { lat: -37.7421, lon: 175.2312 };

const at = (
  point: GeoPoint,
  merchant: string | null,
  totalCents: number,
  billCount = 1
): LocatedMerchant => ({
  point,
  location: {
    merchant,
    merchantNorm: merchant?.toLowerCase().replace(/[^a-z0-9]+/g, '') ?? null,
    address: 'an address',
    totalCents,
    billCount,
  } satisfies MerchantLocation,
});

describe('merging what sits in one place', () => {
  it('keeps separate places separate', () => {
    const spots = mergeSpots([at(HAMILTON, 'New World', 1000), at(TE_RAPA, 'Countdown', 2000)]);
    expect(spots).toHaveLength(2);
  });

  /** The reported problem: one shop, two spellings, two pins. */
  it('merges one shop that OCR read two ways', () => {
    const spots = mergeSpots([
      at(HAMILTON, 'New World Rototuna', 3000, 2),
      at(HAMILTON, 'New World, Rototuna', 1500, 1),
    ]);

    expect(spots).toHaveLength(1);
    expect(spots[0].totalCents).toBe(4500);
    expect(spots[0].billCount).toBe(3);
  });

  it('merges addresses that geocode a few metres apart', () => {
    const spots = mergeSpots([at(HAMILTON, 'New World', 1000), at(HAMILTON_NEARLY, 'New World', 500)]);
    expect(spots).toHaveLength(1);
    expect(spots[0].totalCents).toBe(1500);
  });

  /**
   * Two real shops in one mall. Merging is not a compromise here: a map
   * answers "what did I spend at this place", and the answer is the sum.
   */
  it('sums two different shops at one address, and names the bigger', () => {
    const spots = mergeSpots([at(HAMILTON, 'Chemist Warehouse', 2000), at(HAMILTON, 'Bakers Delight', 6000)]);

    expect(spots[0].totalCents).toBe(8000);
    expect(spots[0].label).toBe('Bakers Delight');
    expect(spots[0].merchants).toEqual(['Bakers Delight', 'Chemist Warehouse']);
  });
});

describe('what the pin is named and coloured by', () => {
  it('takes the biggest spender, whatever order they arrived in', () => {
    const spots = mergeSpots([at(HAMILTON, 'Small Shop', 100), at(HAMILTON, 'Big Shop', 9000)]);

    expect(spots[0].label).toBe('Big Shop');
    expect(spots[0].merchantNorm).toBe('bigshop');
  });

  it('does not repeat a name that arrived twice', () => {
    const spots = mergeSpots([at(HAMILTON, 'New World', 100), at(HAMILTON, 'New World', 900)]);
    expect(spots[0].merchants).toEqual(['New World']);
  });

  it('has something to call a shop with no recorded name', () => {
    const spots = mergeSpots([at(HAMILTON, null, 100)]);
    expect(spots[0].label).toBe('Unnamed shop');
  });
});

describe('order', () => {
  it('puts the biggest place first, so the largest pin draws first', () => {
    const spots = mergeSpots([
      at(TE_RAPA, 'Small', 100),
      at(HAMILTON, 'Large', 5000),
    ]);

    expect(spots.map((spot) => spot.label)).toEqual(['Large', 'Small']);
  });

  it('has nothing to merge when there is nothing', () => {
    expect(mergeSpots([])).toEqual([]);
  });
});
