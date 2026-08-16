import { enrichWithProductData } from '@/capture/enrichBarcodes';
import type { OffProduct } from '@/capture/openFoodFacts';
import type { ParsedItem, ParsedReceipt } from '@/capture/parseContract';
import { createMemoryProductCache, type ProductCache } from '@/capture/productCache';

const item = (overrides: Partial<ParsedItem> = {}): ParsedItem => ({
  name: 'CHEFS WRLD NDLS',
  name_local: null,
  category: 'other',
  is_food: true,
  qty: 1,
  unit: 'pc',
  scan_units: 1,
  price_cents: 198,
  unit_price_cents: null,
  barcode: null,
  confidence: 'high',
  ...overrides,
});

const receipt = (items: ParsedItem[]): ParsedReceipt => ({
  merchant: 'PAK’nSAVE',
  merchant_address: null,
  purchased_at: '2026-07-19',
  purchased_time: null,
  currency: 'NZD',
  total_cents: 198,
  discount_cents: 0,
  units_sold: null,
  itemless: false,
  items,
});

/** Nothing here may reach the network. */
const found = (product: OffProduct) => async () => product;
const notFound = async () => null;

let cache: ProductCache;
beforeEach(() => {
  cache = createMemoryProductCache();
});

describe('enrichWithProductData (§5.5 check 5)', () => {
  it('replaces an abbreviated till description with the real product name', async () => {
    const result = await enrichWithProductData(
      receipt([item({ barcode: '9400547002344' })]),
      { lookup: found({ name: 'Chefs World Wet Pad Thai Noodles', category: 'pantry_staple' }), cache }
    );

    expect(result.receipt.items[0].name).toBe('Chefs World Wet Pad Thai Noodles');
    expect(result.receipt.items[0].category).toBe('pantry_staple');
    expect(result.enrichedIndices).toEqual([0]);
  });

  /**
   * §5.5 is explicit: a hit overrides name and category "but never
   * `name_local`". That is what the receipt printed in its own script, and no
   * product database knows it.
   */
  it('never touches name_local', async () => {
    const result = await enrichWithProductData(
      receipt([item({ barcode: '9400547002344', name_local: '泰式炒河粉' })]),
      { lookup: found({ name: 'Wet Pad Thai Noodles', category: 'pantry_staple' }), cache }
    );

    expect(result.receipt.items[0].name_local).toBe('泰式炒河粉');
  });

  /**
   * The mapping returns null rather than guessing, and null must not become
   * `other` — the model read the line in the context of a real receipt.
   */
  it('keeps the model category when the database has none that maps', async () => {
    const result = await enrichWithProductData(
      receipt([item({ barcode: '9400547002344', category: 'snacks' })]),
      { lookup: found({ name: 'Something', category: null }), cache }
    );

    expect(result.receipt.items[0].category).toBe('snacks');
    expect(result.receipt.items[0].name).toBe('Something');
  });

  it('keeps the model name when the database has none', async () => {
    const result = await enrichWithProductData(
      receipt([item({ barcode: '9400547002344', name: 'CHEFS WRLD NDLS' })]),
      { lookup: found({ name: null, category: 'pantry_staple' }), cache }
    );

    expect(result.receipt.items[0].name).toBe('CHEFS WRLD NDLS');
    expect(result.receipt.items[0].category).toBe('pantry_staple');
  });

  it('leaves an item untouched when the product is not in the database', async () => {
    const before = item({ barcode: '9400547002344' });
    const result = await enrichWithProductData(receipt([before]), { lookup: notFound, cache });

    expect(result.receipt.items[0]).toEqual(before);
    expect(result.enrichedIndices).toEqual([]);
  });

  it('does not look up an item with no barcode', async () => {
    let calls = 0;
    await enrichWithProductData(receipt([item({ barcode: null })]), {
      cache,
      lookup: async () => {
        calls += 1;
        return null;
      },
    });

    expect(calls).toBe(0);
  });

  /** §5.5 "so repeat purchases and offline scans resolve without a network call". */
  it('asks once for a barcode and serves the rest from cache', async () => {
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return { name: 'Milk 2L', category: 'dairy' as const };
    };

    const two = receipt([item({ barcode: '9400547002344' }), item({ barcode: '9400547002344' })]);
    const result = await enrichWithProductData(two, { lookup, cache });

    expect(calls).toBe(1);
    expect(result.receipt.items.map((i) => i.name)).toEqual(['Milk 2L', 'Milk 2L']);
  });

  /**
   * Misses cache too. Open Food Facts is food-first and thin on New Zealand
   * groceries, so a miss is the common case — without this, every unknown item
   * re-queries on every parse, the worst load for the least benefit.
   */
  it('remembers a miss rather than asking again', async () => {
    let calls = 0;
    const lookup = async () => {
      calls += 1;
      return null;
    };

    await enrichWithProductData(receipt([item({ barcode: '9400547002344' })]), { lookup, cache });
    await enrichWithProductData(receipt([item({ barcode: '9400547002344' })]), { lookup, cache });

    expect(calls).toBe(1);
  });

  /**
   * §8.4 gives the review screen six seconds, and this is a free,
   * community-funded service — a 40-line receipt of unknowns must not become
   * 40 sequential round-trips.
   */
  it('caps live lookups per receipt', async () => {
    let calls = 0;
    const items = Array.from({ length: 10 }, (_, i) =>
      item({ barcode: `940054700${String(i).padStart(4, '0')}` })
    );

    await enrichWithProductData(receipt(items), {
      cache,
      maxLookups: 3,
      lookup: async () => {
        calls += 1;
        return null;
      },
    });

    expect(calls).toBe(3);
  });

  it('reports nothing enriched when the database only confirms what was there', async () => {
    const result = await enrichWithProductData(
      receipt([item({ barcode: '9400547002344', name: 'Milk 2L', category: 'dairy' })]),
      { lookup: found({ name: 'Milk 2L', category: 'dairy' }), cache }
    );

    expect(result.enrichedIndices).toEqual([]);
  });

  /** An enrichment failure must never cost the user their parsed receipt. */
  it('leaves the receipt intact when the lookup throws', async () => {
    const before = item({ barcode: '9400547002344' });
    const result = await enrichWithProductData(receipt([before]), {
      cache,
      lookup: async () => {
        throw new Error('offline');
      },
    }).catch(() => null);

    expect(result).not.toBeNull();
    expect(result!.receipt.items[0]).toEqual(before);
  });
});
