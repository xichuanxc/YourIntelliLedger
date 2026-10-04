/**
 * Turning a breakdown into donut slices.
 *
 * ## Why there is a cap
 *
 * A donut is only readable as part-to-whole *at a glance*, and past roughly six
 * segments adjacent slices blur — which is also why §6.7 caps the agent's own
 * donut renderer and falls back to a bar. The category vocabulary has ten
 * values plus the "not itemised" remainder, so a naive pie would routinely
 * draw eleven wedges, several of them slivers.
 *
 * So the biggest slices keep their identity and the tail folds into one
 * "everything else" wedge. A ninth series is never a generated colour.
 *
 * The remainder slice is exempt from folding: "not itemised" is where §14.6's
 * undercount becomes visible, and burying it in a tail would undo the reason
 * it is reported at all.
 */

export interface SliceInput {
  key: string;
  label: string;
  valueCents: number;
  /**
   * Not an identity — an absence of one. Rendered in the neutral colour and
   * never folded away. "Not itemised" is the only such slice today.
   *
   * The folded tail is deliberately **not** neutral: it is still categorised
   * spending, merely aggregated, and giving it the same grey made it
   * indistinguishable from the remainder in the ring.
   */
  neutral?: boolean;
}

export interface Slice extends SliceInput {
  /** 0–1 share of the total. */
  share: number;
  /** How many inputs this slice stands for; > 1 only for the folded tail. */
  mergedCount: number;
  /** True for the aggregated tail, so callers can caption it. */
  folded?: boolean;
  /**
   * What the tail stands for, biggest first — set only on the folded slice.
   *
   * Without it the wedge is unaccountable. "Everything else (2)" names a sum
   * and nothing about its contents, so there is no way to tell a fold of two
   * small categories from money that should not be there at all: somebody who
   * has just deleted a bill cannot see whether this is what is left of it.
   * The labels are the answer, and they are already to hand.
   */
  members?: string[];
}

/** §6.7 and the at-a-glance limit agree on roughly this many. */
export const MAX_SLICES = 6;

export interface SliceOptions {
  maxSlices?: number;
  foldedLabel?: string;
}

/**
 * Sorts by value, keeps the largest, folds the tail.
 *
 * Zero and negative entries are dropped: a donut cannot draw them, and a
 * negative remainder (items summing above the printed total) is a data problem
 * for the warning line to state in words, not a wedge.
 */
export function toSlices(inputs: readonly SliceInput[], options: SliceOptions = {}): Slice[] {
  const maxSlices = options.maxSlices ?? MAX_SLICES;
  const foldedLabel = options.foldedLabel ?? 'Everything else';

  const usable = inputs.filter((input) => input.valueCents > 0);
  if (usable.length === 0) return [];

  const total = usable.reduce((sum, input) => sum + input.valueCents, 0);
  const withShare = (input: SliceInput, mergedCount = 1): Slice => ({
    ...input,
    share: input.valueCents / total,
    mergedCount,
  });

  // Neutral entries are held aside so the fold never swallows them, then
  // placed last — they read as the leftover they are.
  const neutrals = usable.filter((input) => input.neutral);
  const identified = usable
    .filter((input) => !input.neutral)
    .sort((a, b) => b.valueCents - a.valueCents);

  const roomForIdentified = Math.max(1, maxSlices - neutrals.length);

  if (identified.length <= roomForIdentified) {
    return [...identified.map((input) => withShare(input)), ...neutrals.map((input) => withShare(input))];
  }

  // Keep one slot for the folded tail.
  const kept = identified.slice(0, roomForIdentified - 1);
  const folded = identified.slice(roomForIdentified - 1);
  const foldedValue = folded.reduce((sum, input) => sum + input.valueCents, 0);

  return [
    ...kept.map((input) => withShare(input)),
    {
      ...withShare({ key: '__folded__', label: foldedLabel, valueCents: foldedValue }, folded.length),
      folded: true,
      members: folded.map((input) => input.label),
    },
    ...neutrals.map((input) => withShare(input)),
  ];
}

/** Whole percentages that still add to 100 — largest-remainder apportionment. */
export function sharePercentages(slices: readonly Slice[]): number[] {
  if (slices.length === 0) return [];

  const exact = slices.map((slice) => slice.share * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0);

  // Hand the leftover points to the largest fractional parts, so the column
  // sums to 100 instead of showing 99% or 101% for no visible reason.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  const result = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    result[index] += 1;
    remaining -= 1;
  }

  return result;
}
