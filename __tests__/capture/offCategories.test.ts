import { categoryFromOffTags } from '@/capture/offCategories';

/**
 * §5.5 check 5 says an Open Food Facts hit "overrides the model's
 * name/category" without saying how, and the two vocabularies are not
 * comparable: OFF returns a deep hierarchical taxonomy, §4.7 has ten flat
 * values enforced by a SQL CHECK. An unmapped tag is not a slightly-wrong
 * category, it is a failed write — which is what these pin down.
 */
describe('categoryFromOffTags', () => {
  it('maps a real Open Food Facts tag chain to one §4.7 value', () => {
    expect(
      categoryFromOffTags([
        'en:plant-based-foods-and-beverages',
        'en:plant-based-foods',
        'en:cereals-and-potatoes',
        'en:breakfast-cereals',
      ])
    ).toBe('pantry_staple');
  });

  /**
   * The general end of an OFF chain fits nearly everything —
   * "en:plant-based-foods" is on most of the shop. Taking the *last* match
   * keeps the specific answer.
   */
  it('prefers the most specific tag, not the first that matches', () => {
    expect(
      categoryFromOffTags(['en:plant-based-foods', 'en:fresh-vegetables'])
    ).toBe('produce');
  });

  it('maps the everyday categories', () => {
    expect(categoryFromOffTags(['en:dairies', 'en:cheeses'])).toBe('dairy');
    expect(categoryFromOffTags(['en:meats', 'en:poultry'])).toBe('meat');
    expect(categoryFromOffTags(['en:breads'])).toBe('bakery');
    expect(categoryFromOffTags(['en:snacks', 'en:sweet-snacks', 'en:chocolates'])).toBe('snacks');
    expect(categoryFromOffTags(['en:beverages', 'en:juices'])).toBe('beverage');
  });

  /** A frozen pizza is frozen first — §4.7 treats it as a storage state. */
  it('lets frozen win over what the food is', () => {
    expect(categoryFromOffTags(['en:meats', 'en:frozen-foods'])).toBe('frozen');
  });

  /** "milk-drinks" and "plant-milks" both contain "milk" but are drinks. */
  it('does not call a milk drink dairy', () => {
    expect(categoryFromOffTags(['en:beverages', 'en:plant-based-milks'])).toBe('beverage');
  });

  /**
   * The important one. Returning `other` for an unrecognised tag would be
   * worse than not looking up at all — the model read the line in the context
   * of a real receipt, and `other` throws that away for a taxonomy gap.
   */
  it('returns null rather than "other" when nothing maps', () => {
    expect(categoryFromOffTags(['en:some-tag-nobody-has-mapped'])).toBeNull();
  });

  it('returns null for missing or empty tags', () => {
    expect(categoryFromOffTags(undefined)).toBeNull();
    expect(categoryFromOffTags([])).toBeNull();
  });

  it('is not confused by language prefixes or case', () => {
    expect(categoryFromOffTags(['fr:Produits-Laitiers', 'EN:CHEESES'])).toBe('dairy');
  });

  it('only ever returns values the §4.7 CHECK constraint accepts', () => {
    const allowed = [
      'produce', 'dairy', 'meat', 'bakery', 'snacks',
      'frozen', 'pantry_staple', 'beverage', 'household', 'other',
    ];
    const samples = [
      ['en:cheeses'], ['en:frozen-foods'], ['en:beverages'], ['en:breads'],
      ['en:cleaning-products'], ['en:fresh-fruits'], ['en:pastas'], ['en:crisps'],
    ];

    for (const tags of samples) {
      const category = categoryFromOffTags(tags);
      expect(category === null || allowed.includes(category)).toBe(true);
    }
  });
});
