import { cleanMerchant, normaliseMerchant } from '@/data/merchant';

describe('normaliseMerchant (spec §4.8)', () => {
  it('lowercases, trims and collapses repeated spaces', () => {
    expect(normaliseMerchant('  New   World  ')).toBe('new world');
  });

  it('retains branch detail — different branches are different stores', () => {
    // The worked example in §4.8.
    expect(normaliseMerchant("PAK'nSAVE Mill Street")).toBe('paknsave mill street');
    expect(normaliseMerchant("PAK'nSAVE Hamilton")).toBe('paknsave hamilton');
    expect(normaliseMerchant("PAK'nSAVE Mill Street")).not.toBe(
      normaliseMerchant("PAK'nSAVE Hamilton")
    );
  });

  it('drops punctuation and casing differences', () => {
    expect(normaliseMerchant('The Warehouse.')).toBe(normaliseMerchant('THE WAREHOUSE'));
    expect(normaliseMerchant('New World — Hamilton')).toBe('new world hamilton');
  });

  it('does not converge spacing variants — the known §4.8 limitation', () => {
    // "PAK'nSAVE" and "PAK n SAVE" normalise differently, so OCR variation can
    // still yield two merchants for one shop. v1 accepts this; the mitigation
    // is editing the merchant on the bill detail screen, and the fix is the v2
    // merchant_aliases table.
    expect(normaliseMerchant("PAK'nSAVE")).toBe('paknsave');
    expect(normaliseMerchant('PAK n SAVE')).toBe('pak n save');
  });

  it('keeps non-Latin script rather than stripping it', () => {
    expect(normaliseMerchant('大华超市 Tai Wah')).toBe('大华超市 tai wah');
  });

  it('is idempotent — normalising a normalised name changes nothing', () => {
    const once = normaliseMerchant("PAK'nSAVE Mill Street");
    expect(normaliseMerchant(once)).toBe(once);
  });

  it('returns null for absent or punctuation-only input', () => {
    expect(normaliseMerchant(null)).toBeNull();
    expect(normaliseMerchant(undefined)).toBeNull();
    expect(normaliseMerchant('   ')).toBeNull();
    expect(normaliseMerchant('---')).toBeNull();
  });
});

describe('cleanMerchant', () => {
  it('collapses whitespace but preserves case and punctuation', () => {
    expect(cleanMerchant("  PAK'nSAVE   Mill  Street ")).toBe("PAK'nSAVE Mill Street");
  });

  it('returns null for an empty name', () => {
    expect(cleanMerchant('  ')).toBeNull();
  });
});
