/**
 * Comparable prices (§4.9).
 *
 * Most of these are real lines from the eleven-receipt corpus, because the
 * failure this guards against is subtle: a per-unit price that is wrong by a
 * factor of a thousand still looks like a price, and one derived from a
 * product's name is a reading of packaging text rather than a measurement.
 */

import corpus from '@/assets/receipts/corpus.json';
import { parseSizeFromName, unitPriceOf, type UnitPriceInput } from '@/data/unitPrice';

const item = (overrides: Partial<UnitPriceInput> = {}): UnitPriceInput => ({
  name: 'Something',
  nameLocal: null,
  qty: 1,
  unit: 'pack',
  priceCents: 100,
  unitPriceCents: null,
  ...overrides,
});

describe('the three sources, in order of trust', () => {
  /** `BANANAS 0.670 Kg @ $3.65/Kg` — the shop did the arithmetic. */
  it('prefers the rate the till printed', () => {
    expect(
      unitPriceOf(item({ name: 'Bananas', qty: 0.67, unit: 'kg', priceCents: 245, unitPriceCents: 365 }))
    ).toEqual({ cents: 365, basis: 'kilogram', source: 'printed' });
  });

  it('converts a printed rate that is per gram into one per kilogram', () => {
    expect(
      unitPriceOf(item({ qty: 250, unit: 'g', priceCents: 399, unitPriceCents: 1.6 }))
    ).toEqual({ cents: 1600, basis: 'kilogram', source: 'printed' });
  });

  /** `WL8号走地鸡蛋10个装` — the user's own example, and no guessing needed. */
  it('divides eggs out of the stored count', () => {
    expect(
      unitPriceOf(
        item({
          name: 'WOODLAND FREE RANGE EGGS',
          nameLocal: 'WL8号走地鸡蛋10个装',
          qty: 10,
          unit: 'pc',
          priceCents: 599,
        })
      )
    ).toEqual({ cents: 59.9, basis: 'item', source: 'quantity' });
  });

  /**
   * The other example, and the one that needs the name: §4.9 stores a
   * pre-packed bottle as `qty: 1, unit: 'pack'`, so the litres are only in the
   * product name.
   */
  it('reads litres off a milk bottle’s name', () => {
    expect(
      unitPriceOf(
        item({ name: 'Anchor Milk Blue Top Plastic Bottle 2L', qty: 1, unit: 'pack', priceCents: 604 })
      )
    ).toEqual({ cents: 302, basis: 'litre', source: 'name' });
  });

  it('multiplies a pack size by how many packs were bought', () => {
    // `CD Premium Ham Sausage 200g` × 2 packs = 400 g for $4.99.
    expect(
      unitPriceOf(
        item({
          name: 'CD Premium Ham Sausage 200g',
          nameLocal: '春都王中王特级火腿肠200克',
          qty: 2,
          unit: 'pack',
          priceCents: 499,
        })
      )
    ).toEqual({ cents: 1247.5, basis: 'kilogram', source: 'name' });
  });

  it('falls back to a price for the one thing, when nothing says how much', () => {
    expect(unitPriceOf(item({ name: 'Mystery Item', priceCents: 250 }))).toEqual({
      cents: 250,
      basis: 'item',
      source: 'quantity',
    });
  });

  it('has no rate for an illegible price (§4.3)', () => {
    expect(unitPriceOf(item({ priceCents: null }))).toBeNull();
  });
});

describe('reading a size out of a name', () => {
  it.each([
    ['Anchor Milk Blue Top Plastic Bottle 2L', 2, 'litre'],
    ['Janola Pwm C/Tg Eoc 750Ml', 0.75, 'litre'],
    ['MK Waterchestnut Drink 500ml', 0.5, 'litre'],
    ['Pams Cheese Edam Slices 250g', 0.25, 'kilogram'],
    ['Kwongson Yangchun Noodles 500g', 0.5, 'kilogram'],
    ['Croissants Large 3pk', 3, 'item'],
    ['Grin Floss W/Smth 80PK', 80, 'item'],
    ["Whittaker's Mini Slab Almond Gold Share Pack 12 Pack", 12, 'item'],
  ])('reads %s', (name, magnitude, basis) => {
    expect(parseSizeFromName(name)).toEqual({ magnitude, basis });
  });

  it.each([
    ['永超外婆菜208克', 0.208, 'kilogram'],
    ['康师傅竹蔗马蹄500毫升', 0.5, 'litre'],
    ['WL8号走地鸡蛋10个装', 10, 'item'],
  ])('reads the local name %s', (name, magnitude, basis) => {
    expect(parseSizeFromName(null, name)).toEqual({ magnitude, basis });
  });

  /**
   * Sizes close a product name; an earlier number is usually a brand or a
   * variant. Taking the first match would read "5" out of this.
   */
  it('takes the last size, not the first number', () => {
    expect(parseSizeFromName('Trident 5 Spice Sauce 250ml')).toEqual({
      magnitude: 0.25,
      basis: 'litre',
    });
  });

  it('finds nothing in a name that advertises nothing', () => {
    expect(parseSizeFromName('Table Carrots')).toBeNull();
    expect(parseSizeFromName('WOODLAND FREE RANGE EGGS')).toBeNull();
  });

  /**
   * A bare number is not a size. "4 Original Gluten Free Buns" says four of
   * something only if you already know buns are countable, and guessing wrong
   * gives a per-item price for a loaf.
   */
  it('ignores a number with no unit after it', () => {
    expect(parseSizeFromName('4 Original Gluten Free Buns')).toBeNull();
  });

  it('does not read a unit out of the middle of a word', () => {
    // No litres in "Original", no grams in "Gluten".
    expect(parseSizeFromName('Original Gluten Free Loaf')).toBeNull();
    expect(parseSizeFromName('Lite Blue Milk')).toBeNull();
  });
});

/**
 * Every corpus item, to catch a rule that is right on the examples above and
 * absurd on something nobody thought to write a case for.
 */
describe('across all eleven corpus receipts', () => {
  // TypeScript infers a different literal shape per receipt from the JSON, so
  // the union does not unify across bills. The runtime shape is uniform.
  const items = corpus.bills.flatMap(
    (bill) => (bill.items ?? []) as unknown as UnitPriceInput[]
  );

  it('produces a rate for every line with a legible price', () => {
    const priced = items.filter((line) => line.priceCents != null);
    const rated = priced.filter((line) => unitPriceOf(line) !== null);
    expect(rated).toHaveLength(priced.length);
  });

  it('never produces an implausible rate', () => {
    for (const line of items) {
      const rate = unitPriceOf(line);
      if (!rate) continue;
      // A tenth of a cent per kilogram, or $10,000 per litre, means a unit
      // conversion went the wrong way — the failure this whole file exists for.
      expect(rate.cents).toBeGreaterThan(0.5);
      expect(rate.cents).toBeLessThan(100_000);
    }
  });

  it('uses the printed rate for exactly the weighed lines', () => {
    const printed = items.filter((line) => unitPriceOf(line)?.source === 'printed');
    expect(printed).toHaveLength(items.filter((line) => line.unitPriceCents != null).length);
  });
});
