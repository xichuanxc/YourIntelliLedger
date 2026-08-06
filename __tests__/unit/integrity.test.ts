import { computeParseFlags, type IntegrityItem } from '@/data/integrity';

const item = (overrides: Partial<IntegrityItem> = {}): IntegrityItem => ({
  priceCents: 500,
  scanUnits: 1,
  confidence: 'high',
  ...overrides,
});

describe('computeParseFlags (spec §4.11)', () => {
  it('flags nothing when the receipt reconciles', () => {
    expect(
      computeParseFlags({
        totalCents: 1000,
        discountCents: 0,
        unitsSold: 2,
        items: [item(), item()],
      })
    ).toEqual([]);
  });

  it('tolerates rounding up to 5 cents, and flags beyond it', () => {
    const withTotal = (totalCents: number) =>
      computeParseFlags({ totalCents, discountCents: 0, unitsSold: null, items: [item()] });

    expect(withTotal(505)).toEqual([]);
    expect(withTotal(495)).toEqual([]);
    expect(withTotal(506)).toEqual(['sum_mismatch']);
    expect(withTotal(494)).toEqual(['sum_mismatch']);
  });

  it('subtracts discounts, which are stored as a positive magnitude', () => {
    // Two $5 items, $1 off, $9 printed total — this reconciles.
    expect(
      computeParseFlags({
        totalCents: 900,
        discountCents: 100,
        unitsSold: null,
        items: [item(), item()],
      })
    ).toEqual([]);
  });

  it('checks Σ scan_units, not the item count (§4.9)', () => {
    // One multibuy line: one item, two scan units. Checking the item count
    // here is what v2.1 of the parsing prompt got wrong — it would have
    // flagged every multibuy receipt.
    const multibuy = [item({ priceCents: 1398, scanUnits: 2 })];
    expect(
      computeParseFlags({ totalCents: 1398, discountCents: 0, unitsSold: 2, items: multibuy })
    ).toEqual([]);
    expect(
      computeParseFlags({ totalCents: 1398, discountCents: 0, unitsSold: 1, items: multibuy })
    ).toEqual(['unit_mismatch']);
  });

  it('flags low-confidence lines', () => {
    expect(
      computeParseFlags({
        totalCents: 1000,
        discountCents: 0,
        unitsSold: null,
        items: [item(), item({ confidence: 'low' })],
      })
    ).toEqual(['low_confidence']);
  });

  it('flags a missing price and does not double-report it as a sum mismatch', () => {
    // NULL is an illegible price, not zero (§4.3) — so the sum is unknowable
    // and `missing_price` is the honest single flag.
    expect(
      computeParseFlags({
        totalCents: 1000,
        discountCents: 0,
        unitsSold: null,
        items: [item(), item({ priceCents: null })],
      })
    ).toEqual(['missing_price']);
  });

  it('treats a zero price as free, not missing', () => {
    expect(
      computeParseFlags({
        totalCents: 500,
        discountCents: 0,
        unitsSold: null,
        items: [item(), item({ priceCents: 0 })],
      })
    ).toEqual([]);
  });

  describe('itemless bills (spec §5.1, §5.5)', () => {
    it('skips the sum check rather than reporting a mismatch against zero items', () => {
      // A restaurant bill: real printed total, nothing to itemize honestly.
      expect(
        computeParseFlags({ totalCents: 8650, discountCents: 0, unitsSold: null, items: [] })
      ).toEqual([]);
    });

    it('skips the unit check too', () => {
      expect(
        computeParseFlags({ totalCents: 8650, discountCents: 0, unitsSold: 3, items: [] })
      ).toEqual([]);
    });
  });

  it('skips the sum check when the total itself was illegible', () => {
    expect(
      computeParseFlags({ totalCents: null, discountCents: 0, unitsSold: null, items: [item()] })
    ).toEqual([]);
  });

  it('reports every applicable flag at once', () => {
    expect(
      computeParseFlags({
        totalCents: 5000,
        discountCents: 0,
        unitsSold: 9,
        items: [item({ confidence: 'low' }), item({ priceCents: null })],
      })
    ).toEqual(['unit_mismatch', 'low_confidence', 'missing_price']);
  });
});
