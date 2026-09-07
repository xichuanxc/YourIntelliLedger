/**
 * Whether a bill still wants a human's attention — §4.11, §5.6.
 *
 * Pure, because this is the rule the ledger row and the bill screen must agree
 * on, and two screens computing "needs review" slightly differently is exactly
 * how a list disagrees with the thing it lists.
 */

import type { ParseFlag } from '@/types/vocabulary';

export interface ReviewState {
  parseFlags: readonly ParseFlag[];
  /** The flags a person has seen and accepted, if any. */
  reviewedFlags: readonly ParseFlag[] | null;
}

/**
 * A flag that nobody has acknowledged.
 *
 * Set comparison rather than a boolean: acknowledging "the items do not add
 * up" should not also silence a `missing_price` raised by a later edit. The
 * old flag stays quiet, the new one speaks.
 */
export function unreviewedFlags(bill: ReviewState): ParseFlag[] {
  const seen = new Set(bill.reviewedFlags ?? []);
  return bill.parseFlags.filter((flag) => !seen.has(flag));
}

export function needsReview(bill: ReviewState): boolean {
  return unreviewedFlags(bill).length > 0;
}
