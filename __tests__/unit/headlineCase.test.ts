/**
 * Casing receipt text for reading (§7).
 *
 * The whole risk here is over-reach. Shouting from a till is noise and worth
 * removing; capitals *inside* a word are a brand's own styling and removing
 * them misspells a real shop. Most of these tests are about what must survive
 * untouched.
 */

import { headlineCase } from '@/ui/headlineCase';

describe('what a till shouted', () => {
  it.each([
    ['BORMAN FRESH', 'Borman Fresh'],
    ['TABLE CARROTS', 'Table Carrots'],
    ['WELLMART HAMILTON', 'Wellmart Hamilton'],
  ])('%s reads as %s', (printed, expected) => {
    expect(headlineCase(printed)).toBe(expected);
  });

  it('lifts a name a till printed in lower case', () => {
    expect(headlineCase('garden fresh')).toBe('Garden Fresh');
  });

  it('leaves a name that was already right', () => {
    expect(headlineCase('Green Valley')).toBe('Green Valley');
  });
});

describe('names that style themselves', () => {
  /**
   * The case this exists for. Lowercasing and re-capitalising turns a real
   * shop into a misspelling, which is worse than the shouting.
   */
  it.each(['PAK’nSAVE', "PAK'nSAVE", 'McDonald', 'iPhone', 'FreshChoice'])(
    'leaves %s exactly as written',
    (name) => {
      expect(headlineCase(name)).toBe(name);
    }
  );

  it('leaves a styled name alone inside a longer one', () => {
    expect(headlineCase("PAK'nSAVE MILL STREET")).toBe("PAK'nSAVE Mill Street");
  });
});

describe('things that are not words', () => {
  /** A size is not improved by being capitalised, and is harmed by lowercasing. */
  it.each(['2L', '750Ml', '80PK', '6x70g'])('leaves %s alone', (size) => {
    expect(headlineCase(size)).toBe(size);
  });

  it('keeps a size inside a name', () => {
    expect(headlineCase('MILK 2L BLUE')).toBe('Milk 2L Blue');
  });
});

describe('the small words', () => {
  it('lowercases an article inside a name', () => {
    expect(headlineCase('SALT AND PEPPER')).toBe('Salt and Pepper');
  });

  /** `and Pepper` is not a heading. */
  it('capitalises a small word when it comes first', () => {
    expect(headlineCase('THE WAREHOUSE')).toBe('The Warehouse');
  });

  it('handles several small words', () => {
    expect(headlineCase('BAG OF CHIPS AND DIP')).toBe('Bag of Chips and Dip');
  });
});

describe('the awkward inputs', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    ['', ''],
  ])('turns %p into an empty string', (input, expected) => {
    expect(headlineCase(input)).toBe(expected);
  });

  /** A receipt's spacing sometimes separates a name from a code. */
  it('preserves the spacing as printed', () => {
    expect(headlineCase('MILK    2L')).toBe('Milk    2L');
  });

  it('copes with punctuation standing alone', () => {
    expect(headlineCase('-- SPECIAL --')).toBe('-- Special --');
  });

  it('does not spend the first-word exemption on a symbol', () => {
    expect(headlineCase('# OF ITEMS')).toBe('# Of Items');
  });
});
