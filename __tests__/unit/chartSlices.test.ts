import { MAX_SLICES, sharePercentages, toSlices, type SliceInput } from '@/ui/chartSlices';

const input = (key: string, valueCents: number, neutral = false): SliceInput => ({
  key,
  label: key,
  valueCents,
  neutral,
});

describe('toSlices', () => {
  it('sorts largest first and computes share', () => {
    const slices = toSlices([input('a', 100), input('b', 300)]);
    expect(slices.map((s) => s.key)).toEqual(['b', 'a']);
    expect(slices[0].share).toBeCloseTo(0.75, 6);
    expect(slices[1].share).toBeCloseTo(0.25, 6);
  });

  it('keeps everything when it fits', () => {
    const slices = toSlices([input('a', 5), input('b', 4), input('c', 3)]);
    expect(slices).toHaveLength(3);
    expect(slices.every((s) => s.mergedCount === 1)).toBe(true);
  });

  it('folds the tail once there are too many (§6.7, at-a-glance limit)', () => {
    const many = Array.from({ length: 10 }, (_, i) => input(`c${i}`, 100 - i));
    const slices = toSlices(many);

    expect(slices).toHaveLength(MAX_SLICES);
    const folded = slices[slices.length - 1];
    expect(folded.label).toBe('Everything else');
    expect(folded.mergedCount).toBe(10 - (MAX_SLICES - 1));
  });

  /**
   * The folded tail is still categorised spending, just aggregated. Marking it
   * neutral gave it the same grey as "Not itemised", which made two different
   * meanings indistinguishable in the ring — caught by looking at the rendered
   * chart, not by any assertion.
   */
  it('marks the folded tail as folded, not neutral, so it keeps a hue', () => {
    const many = Array.from({ length: 10 }, (_, i) => input(`c${i}`, 100 - i));
    const folded = toSlices(many)[MAX_SLICES - 1];

    expect(folded.folded).toBe(true);
    expect(folded.neutral).toBeFalsy();
  });

  it('keeps the folded tail and the neutral remainder as separate slices', () => {
    const many = [
      ...Array.from({ length: 10 }, (_, i) => input(`c${i}`, 100 - i)),
      input('not-itemised', 500, true),
    ];
    const slices = toSlices(many);

    const neutrals = slices.filter((s) => s.neutral);
    const folds = slices.filter((s) => s.folded);
    expect(neutrals).toHaveLength(1);
    expect(folds).toHaveLength(1);
    expect(neutrals[0].key).toBe('not-itemised');
  });

  it('folds by value, so the tail is genuinely the small ones', () => {
    const many = Array.from({ length: 8 }, (_, i) => input(`c${i}`, (i + 1) * 10));
    const slices = toSlices(many);

    // Biggest kept, smallest folded.
    expect(slices[0].key).toBe('c7');
    const folded = slices[slices.length - 1];
    expect(folded.valueCents).toBe(10 + 20 + 30); // c0 + c1 + c2
  });

  it('shares always sum to 1', () => {
    const many = Array.from({ length: 9 }, (_, i) => input(`c${i}`, 7 * (i + 1)));
    const total = toSlices(many).reduce((sum, s) => sum + s.share, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  /**
   * The remainder is where §14.6's undercount becomes visible — folding it into
   * a tail would undo the reason it is reported.
   */
  it('never folds a neutral slice away', () => {
    const many = [
      ...Array.from({ length: 10 }, (_, i) => input(`c${i}`, 100)),
      input('not-itemised', 5, true),
    ];
    const slices = toSlices(many);

    expect(slices).toHaveLength(MAX_SLICES);
    expect(slices.some((s) => s.key === 'not-itemised')).toBe(true);
    // Even though it is the smallest value of the lot.
    expect(slices.find((s) => s.key === 'not-itemised')!.valueCents).toBe(5);
  });

  it('puts the neutral slice last, where a leftover belongs', () => {
    const slices = toSlices([input('remainder', 500, true), input('a', 100), input('b', 200)]);
    expect(slices.map((s) => s.key)).toEqual(['b', 'a', 'remainder']);
  });

  it('drops zero and negative entries a donut cannot draw', () => {
    // A negative remainder is a data problem for the warning line to state in
    // words, not a wedge.
    const slices = toSlices([input('a', 100), input('zero', 0), input('negative', -50)]);
    expect(slices.map((s) => s.key)).toEqual(['a']);
  });

  it('returns nothing for an empty or all-zero breakdown', () => {
    expect(toSlices([])).toEqual([]);
    expect(toSlices([input('a', 0)])).toEqual([]);
  });

  it('honours a custom cap and label', () => {
    const slices = toSlices([input('a', 4), input('b', 3), input('c', 2), input('d', 1)], {
      maxSlices: 3,
      foldedLabel: 'Other spend',
    });
    expect(slices).toHaveLength(3);
    expect(slices[2].label).toBe('Other spend');
  });
});

describe('sharePercentages', () => {
  it('sums to exactly 100 rather than 99 or 101', () => {
    // Three equal thirds: naive rounding gives 33/33/33 = 99.
    const slices = toSlices([input('a', 1), input('b', 1), input('c', 1)]);
    const percentages = sharePercentages(slices);

    expect(percentages.reduce((sum, p) => sum + p, 0)).toBe(100);
    expect(percentages.sort()).toEqual([33, 33, 34]);
  });

  it('gives the leftover point to the largest fraction', () => {
    const slices = toSlices([input('a', 50), input('b', 25), input('c', 25)]);
    expect(sharePercentages(slices)).toEqual([50, 25, 25]);
  });

  it('handles an awkward split without drifting', () => {
    const slices = toSlices([input('a', 1), input('b', 1), input('c', 1), input('d', 1), input('e', 1), input('f', 1)]);
    const percentages = sharePercentages(slices);
    expect(percentages.reduce((sum, p) => sum + p, 0)).toBe(100);
  });

  it('is empty for no slices', () => {
    expect(sharePercentages([])).toEqual([]);
  });
});
