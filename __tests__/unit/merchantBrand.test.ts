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

import { BRAND_COLOURS, brandColour, brandOf, shortMerchantName } from '@/ui/merchantBrand';

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

/**
 * A map label with no room for the branch (§4.14).
 *
 * The pin is already sitting on the branch, so the branch is the part a
 * reader can spare. What must survive is the half that says which shop this
 * is — losing that was what left bare amounts on the map.
 */
describe('a shop without its branch', () => {
  it.each([
    ["PAK'nSAVE Mill Street", 'paknsave mill street', "PAK'nSAVE"],
    ['New World Rototuna', 'new world rototuna', 'New World'],
    ['Countdown Te Rapa', 'countdown te rapa', 'Woolworths'],
  ])('writes %s as the name on the sign', (printed, norm, expected) => {
    expect(shortMerchantName(norm, printed)).toBe(expected);
  });

  /** Countdown and Woolworths are one chain, so both shorten the same way. */
  it('does not care which name the receipt used for a rebranded chain', () => {
    expect(shortMerchantName('woolworths te rapa', 'Woolworths Te Rapa')).toBe(
      shortMerchantName('countdown te rapa', 'Countdown Te Rapa')
    );
  });

  /**
   * An independent shop has no branch. Taking its last word off does not
   * shorten a name, it renames the shop — "Garden Fresh" is not "Garden".
   */
  it.each(['Wellmart Hamilton', 'BORMAN FRESH', 'Garden Fresh', 'The Warehouse'])(
    'leaves %s whole, because it is not a chain',
    (printed) => {
      expect(shortMerchantName(null, printed)).toBe(printed);
    }
  );

  /**
   * Unchanged means there was nothing to take off, and the caller uses that
   * to skip offering a form no shorter than the one it already has.
   */
  it('returns a one-word name unchanged', () => {
    expect(shortMerchantName(null, 'Wellmart')).toBe('Wellmart');
  });

  it('copes with a name that is only spaces', () => {
    expect(shortMerchantName(null, '   ')).toBe('   ');
  });
});
