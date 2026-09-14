/**
 * Reading a chain off a merchant name (§4.8, §4.14).
 *
 * Receipts spell their own shops inconsistently and OCR makes it worse, so the
 * matching has to survive punctuation, spacing and a branch name. The other
 * half matters just as much: a shop that is *not* one of these chains must
 * come back as `other` rather than being forced into the nearest colour, since
 * a wrong brand colour asserts something false about a shop the user knows by
 * sight.
 */

import { BRAND_COLOURS, brandColour, brandOf } from '@/ui/merchantBrand';

describe('recognising a chain', () => {
  it.each([
    ['paknsave mill street', 'paknsave'],
    ['pak n save hamilton', 'paknsave'],
    ['paknsave', 'paknsave'],
    ['new world rototuna', 'new-world'],
    ['newworld', 'new-world'],
    ['woolworths te rapa', 'woolworths'],
    ['countdown chartwell', 'woolworths'],
  ])('reads %s as %s', (name, expected) => {
    expect(brandOf(name)).toBe(expected);
  });

  /**
   * Countdown is Woolworths mid-rebrand. Colouring them differently would
   * split one chain across two colours on the same map, and a ledger spanning
   * the rebrand holds receipts with both names.
   */
  it('treats Countdown and Woolworths as one chain', () => {
    expect(brandOf('countdown chartwell')).toBe(brandOf('woolworths te rapa'));
  });
});

describe('everything else', () => {
  it.each([
    ['the corner dairy', 'other'],
    ['bp connect te rapa', 'other'],
    ['bobs butchery', 'other'],
    ['', 'other'],
  ])('leaves %s as %s', (name, expected) => {
    expect(brandOf(name)).toBe(expected);
  });

  it('does not guess when there is no name at all', () => {
    expect(brandOf(null)).toBe('other');
    expect(brandOf(null, null)).toBe('other');
  });

  /** A bill recorded before normalisation still has its printed name. */
  it('falls back to the printed name', () => {
    expect(brandOf(null, "PAK'nSAVE Mill Street")).toBe('paknsave');
  });
});

describe('the colours themselves', () => {
  it('gives each recognised chain its own colour', () => {
    const colours = [
      brandColour('paknsave mill street'),
      brandColour('new world rototuna'),
      brandColour('woolworths te rapa'),
      brandColour('the corner dairy'),
    ];

    expect(new Set(colours).size).toBe(4);
  });

  it('draws an unrecognised shop in the neutral colour', () => {
    expect(brandColour('bobs butchery')).toBe(BRAND_COLOURS.other);
  });
});
