/**
 * When a flagged bill still wants attention (§4.11, §5.6).
 *
 * The rule the ledger row and the bill screen share, so the list cannot
 * disagree with the thing it lists.
 */

import { needsReview, unreviewedFlags } from '@/data/review';

describe('needsReview', () => {
  it('is quiet about a bill that was never flagged', () => {
    expect(needsReview({ parseFlags: [], reviewedFlags: null })).toBe(false);
  });

  it('asks for attention when nobody has looked', () => {
    expect(needsReview({ parseFlags: ['sum_mismatch'], reviewedFlags: null })).toBe(true);
  });

  it('goes quiet once the flags have been accepted', () => {
    expect(
      needsReview({ parseFlags: ['sum_mismatch'], reviewedFlags: ['sum_mismatch'] })
    ).toBe(false);
  });

  /**
   * The reason this is a set and not a boolean. Accepting "the items do not
   * add up" must not also silence a missing price raised by a later edit, or
   * "I have checked this" quietly becomes "never tell me anything again".
   */
  it('speaks up for a flag nobody has seen, while staying quiet about the rest', () => {
    const bill = {
      parseFlags: ['sum_mismatch', 'missing_price'] as const,
      reviewedFlags: ['sum_mismatch'] as const,
    };
    expect(needsReview(bill)).toBe(true);
    expect(unreviewedFlags(bill)).toEqual(['missing_price']);
  });

  /** Fixing the numbers is still the better outcome, and needs no dismissal. */
  it('is quiet when a flag has gone away on its own', () => {
    expect(needsReview({ parseFlags: [], reviewedFlags: ['sum_mismatch'] })).toBe(false);
  });

  it('does not mind an acknowledgement of something no longer flagged', () => {
    expect(
      unreviewedFlags({ parseFlags: ['missing_price'], reviewedFlags: ['sum_mismatch'] })
    ).toEqual(['missing_price']);
  });
});
