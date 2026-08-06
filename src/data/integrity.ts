/**
 * Integrity checks — spec §4.11, computed at save time in the repository.
 *
 * These never correct anything. They record what looks wrong in
 * `bills.parse_flags`, which drives the review-screen banner (§5.6) and lets a
 * later query surface "receipts worth re-checking". A silent correction would
 * destroy the evidence that the parse was unreliable.
 */

import type { NewBillItemInput } from '@/types/ledger';
import type { ParseFlag } from '@/types/vocabulary';

/** §4.11 / §5.5: the printed total and the summed items may differ by rounding. */
export const SUM_TOLERANCE_CENTS = 5;

export interface IntegrityInput {
  totalCents: number | null | undefined;
  /** Positive magnitude of unattached promo deductions. */
  discountCents: number;
  unitsSold: number | null | undefined;
  items: readonly IntegrityItem[];
}

export interface IntegrityItem {
  priceCents?: number | null;
  scanUnits?: number;
  confidence?: 'high' | 'low' | null;
}

export function computeParseFlags(input: IntegrityInput): ParseFlag[] {
  const flags: ParseFlag[] = [];
  const { items, totalCents, discountCents, unitsSold } = input;

  const anyPriceMissing = items.some((item) => item.priceCents == null);

  // Itemless bills skip the sum and unit checks entirely (§5.5): summing zero
  // items against a real printed total is the expected shape of a
  // restaurant/service receipt, not a mismatch.
  if (items.length > 0) {
    // A missing price makes the sum unknowable, so `missing_price` below is
    // the honest flag. Raising `sum_mismatch` as well would just be a second
    // alarm for the same defect.
    if (totalCents != null && !anyPriceMissing) {
      const itemsTotal = items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);
      // Discounts are stored as a positive magnitude, so they subtract.
      if (Math.abs(itemsTotal - discountCents - totalCents) > SUM_TOLERANCE_CENTS) {
        flags.push('sum_mismatch');
      }
    }

    // Σ scan_units, not the item count — a multibuy line is one item but two
    // scan units, and getting this backwards flags every multibuy receipt
    // (§4.9).
    if (unitsSold != null) {
      const scanned = items.reduce((sum, item) => sum + (item.scanUnits ?? 1), 0);
      if (scanned !== unitsSold) flags.push('unit_mismatch');
    }
  }

  if (items.some((item) => item.confidence === 'low')) flags.push('low_confidence');
  if (anyPriceMissing) flags.push('missing_price');

  return flags;
}

/** Convenience overload for the shape the repository already has in hand. */
export function computeParseFlagsForInput(
  bill: { totalCents?: number | null; discountCents?: number; unitsSold?: number | null },
  items: readonly NewBillItemInput[]
): ParseFlag[] {
  return computeParseFlags({
    totalCents: bill.totalCents,
    discountCents: bill.discountCents ?? 0,
    unitsSold: bill.unitsSold,
    items,
  });
}
