/**
 * Measuring whether two chart colours can be told apart.
 *
 * The chart draws from two palettes that were chosen independently — the
 * supermarket chains' own colours and the validated categorical set — so the
 * question "are these two the same colour?" had to stop being a matter of
 * opinion. The figures below are the ones that decided which palette hues the
 * donut now skips.
 */

import { CHART_PALETTE } from '@/ui/chartPalette';
import { colourDistance } from '@/ui/colourDistance';
import { BRAND_COLOURS } from '@/ui/merchantBrand';

describe('what the measure says about itself', () => {
  it('finds no distance between a colour and itself', () => {
    expect(colourDistance('#F2C200', '#F2C200')).toBe(0);
  });

  it('does not care which way round the pair is given', () => {
    expect(colourDistance('#2A78D6', '#D6001C')).toBeCloseTo(
      colourDistance('#D6001C', '#2A78D6'),
      10
    );
  });

  it('reads black and white as about as far apart as colours get', () => {
    expect(colourDistance('#000000', '#FFFFFF')).toBeGreaterThan(90);
  });

  /** RGB distance would call these neighbours; an eye does not. */
  it('separates two hues of similar brightness', () => {
    expect(colourDistance('#2A78D6', '#1BAF7A')).toBeGreaterThan(20);
  });
});

describe('the clashes this exists to catch', () => {
  const light = CHART_PALETTE.light;

  it("puts the palette's amber on top of PAK'nSAVE's yellow", () => {
    expect(colourDistance(light[3], BRAND_COLOURS.paknsave)).toBeLessThan(12);
  });

  it("puts the palette's dark green on top of Woolworths' green", () => {
    expect(colourDistance(light[5], BRAND_COLOURS.woolworths)).toBeLessThan(12);
  });

  /** Not every pairing is a clash, or the palette would have nothing left. */
  it('leaves the blue clear of all three chains', () => {
    for (const brand of ['paknsave', 'new-world', 'woolworths'] as const) {
      expect(colourDistance(light[0], BRAND_COLOURS[brand])).toBeGreaterThan(20);
    }
  });

  /** The three chains must also be distinct from each other. */
  it.each([
    ['paknsave', 'new-world'],
    ['paknsave', 'woolworths'],
    ['new-world', 'woolworths'],
  ] as const)('keeps %s and %s apart', (one, other) => {
    expect(colourDistance(BRAND_COLOURS[one], BRAND_COLOURS[other])).toBeGreaterThan(20);
  });
});
