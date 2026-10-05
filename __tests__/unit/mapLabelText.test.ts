/**
 * What a map label says, and how much room it asks for (§4.14).
 *
 * Two things have to hold. The width has to be an over-estimate rather than
 * an under-estimate, because a chip measured too narrow is drawn on top of
 * its neighbour. And the forms have to run most complete first, each one
 * genuinely narrower than the last, so that a shop gives up as little of its
 * name as the crowd actually requires.
 */

import {
  LABEL_MAX_WIDTH,
  formText,
  formWidth,
  labelFormsFor,
  labelWidthFor,
  textWidth,
} from '@/maps/labelText';

describe('estimating how wide a chip is', () => {
  it('counts a capital as wider than a lower-case letter', () => {
    expect(textWidth('MM')).toBeGreaterThan(textWidth('mm'));
  });

  /** Receipts shout, and a clipped amount is worse than a roomy chip. */
  it('is not fooled by a name in capitals', () => {
    // The old flat average; the estimate must still reach it for capitals.
    expect(textWidth('BORMAN FRESH')).toBeGreaterThanOrEqual('BORMAN FRESH'.length * 8);
  });

  it('grows with the text', () => {
    expect(textWidth('Wellmart Hamilton')).toBeGreaterThan(textWidth('Wellmart'));
  });

  it('measures nothing as nothing', () => {
    expect(textWidth('')).toBe(0);
  });

  it('never asks for more than the ceiling', () => {
    expect(labelWidthFor('A shop with an implausibly long trading name  $1,234')).toBe(
      LABEL_MAX_WIDTH
    );
  });

  it('leaves room for the padding on both sides', () => {
    expect(labelWidthFor('$7')).toBeGreaterThan(textWidth('$7'));
  });
});

describe('writing a form out', () => {
  it('puts the amount after the name', () => {
    expect(formText({ name: 'Wellmart', amount: '$68' })).toBe('Wellmart  $68');
  });

  it('writes the amount alone when there is no name', () => {
    expect(formText({ name: null, amount: '$68' })).toBe('$68');
  });
});

describe('the forms a shop offers', () => {
  const forms = (label: string, norm: string | null = null) =>
    labelFormsFor(label, norm, '$46');

  it('offers the printed name first', () => {
    expect(forms("PAK'nSAVE Mill Street", 'paknsave mill street')[0]).toEqual({
      name: "PAK'nSAVE Mill Street",
      amount: '$46',
    });
  });

  it('offers the amount alone last, and only last', () => {
    const all = forms("PAK'nSAVE Mill Street", 'paknsave mill street');

    expect(all[all.length - 1]).toEqual({ name: null, amount: '$46' });
    expect(all.slice(0, -1).every((form) => form.name !== null)).toBe(true);
  });

  it('offers the name without its branch in between', () => {
    const all = forms("PAK'nSAVE Mill Street", 'paknsave mill street');

    expect(all[1].name).toBe("PAK'nSAVE");
  });

  /**
   * A shop with no branch to drop has only its full name and the amount. It
   * is not given a cut-down "The Ware…" in between: the map pans, so a label
   * that does not fit is better read by moving the map than by mangling it.
   */
  it('leaves a shop with no branch its full name and nothing in between', () => {
    expect(forms('The Warehouse').map((form) => form.name)).toEqual(['The Warehouse', null]);
  });

  it('never offers the same text twice', () => {
    const texts = forms('Wellmart').map(formText);

    expect(new Set(texts).size).toBe(texts.length);
  });

  /** Each form must actually be an improvement on the one before it. */
  it.each([
    ["PAK'nSAVE Mill Street", 'paknsave mill street'],
    ['New World Rototuna', 'new world rototuna'],
    ['The Warehouse', null],
    ['Wellmart Hamilton', null],
    ['Wellmart', null],
  ])('offers %s in ever-narrower forms', (label, norm) => {
    const widths = forms(label, norm).map(formWidth);

    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeLessThan(widths[i - 1]);
    }
  });
});

/**
 * Dropping a word that names a kind of shop rather than a shop.
 *
 * The case this exists for: "Fruit City Supermarket" with its amount wants
 * about 207pt against a 190pt ceiling, on a map around 350pt wide. It never
 * fitted anywhere, and because it is not a chain it had no branch to drop —
 * so the map showed an amount with no shop against it.
 */
describe('dropping a word that only says what kind of shop it is', () => {
  const names = (label: string, norm: string | null = null) =>
    labelFormsFor(label, norm, '$18').map((form) => form.name);

  it('offers the shop without its "Supermarket"', () => {
    expect(names('Fruit City Supermarket')).toEqual([
      'Fruit City Supermarket',
      'Fruit City',
      null,
    ]);
  });

  /**
   * The "Garden" rule. Shortening must not produce a different shop, so what
   * is left has to be a name in its own right — two words at least.
   */
  it('refuses when only one word would be left', () => {
    expect(names('Island Supermarket')).toEqual(['Island Supermarket', null]);
  });

  it('leaves a name whose last word is part of it', () => {
    expect(names('Garden Fresh Produce')).toEqual(['Garden Fresh Produce', null]);
  });

  it('does not find a generic word inside a single word', () => {
    expect(names('Wellmart')).toEqual(['Wellmart', null]);
  });

  /** A middle word is how the shop is known; only the tail is spare. */
  it('leaves a generic word that is not at the end', () => {
    expect(names('Fresh Food Mart Hamilton')).toEqual(['Fresh Food Mart Hamilton', null]);
  });

  it('still drops a chain branch before anything else', () => {
    const all = names("PAK'nSAVE Mill Street", 'paknsave mill street');

    expect(all[1]).toBe("PAK'nSAVE");
  });
});
