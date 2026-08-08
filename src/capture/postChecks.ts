/**
 * Post-checks — spec §5.5. Code, not prompt.
 *
 * These run after `parse_receipt` and before the review screen. **Each failure
 * sets a flag rather than blocking**: the numbers stay exactly as parsed, and
 * the review screen (§5.6) shows the user what looks wrong. Silently correcting
 * a total would destroy the evidence that the parse was unreliable.
 *
 * Checks 2 and 3 (sum, units) are the same arithmetic as the §4.11 integrity
 * flags, so they go through `computeParseFlags` rather than being reimplemented
 * here — one definition, checked at parse time and again at save time.
 *
 * Check 5 (barcode → Open Food Facts) is deliberately absent: it needs network
 * and the MMKV cache, and unlike the rest it cannot run offline. It belongs
 * with the capture module's networked half.
 */

import { computeParseFlags } from '@/data/integrity';
import type { ParsedItem, ParsedReceipt } from '@/capture/parseContract';
import type { ParseFlag } from '@/types/vocabulary';

/** §5.5 #6: a weighed line's own arithmetic, allowing for cash rounding. */
export const WEIGHED_TOLERANCE_CENTS = 5;

export interface ItemIssue {
  index: number;
  /** `invalid_barcode` clears the barcode; `rate_mismatch` only warns. */
  kind: 'invalid_barcode' | 'rate_mismatch';
  message: string;
}

export interface PostCheckResult {
  /** §4.11 flags, recorded on the bill. */
  flags: ParseFlag[];
  /** Per-line problems, surfaced on the review screen. */
  issues: ItemIssue[];
  /** The receipt with barcode corrections applied (§5.5 #4). */
  receipt: ParsedReceipt;
}

/**
 * GTIN-8/12/13/14 check digit, the standard mod-10 weighting.
 *
 * §5.5 #4 makes this consequential rather than cosmetic: an invalid barcode is
 * cleared and the line marked low confidence, because a wrong barcode would
 * otherwise be used for an Open Food Facts lookup that silently overwrites the
 * item's name and category with a different product's.
 */
export function isValidGtin(barcode: string): boolean {
  if (!/^\d+$/.test(barcode)) return false;
  if (![8, 12, 13, 14].includes(barcode.length)) return false;

  const digits = [...barcode].map(Number);
  const check = digits.pop()!;

  // Weights alternate 3 and 1 from the rightmost body digit leftwards.
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * §5.5 #6. Only meaningful where the receipt printed a per-unit rate — §4.9 is
 * emphatic that a rate is never derived by dividing price by quantity, so a
 * missing rate means there is nothing to check, not a failure.
 */
export function weighedItemMatches(item: ParsedItem): boolean {
  if (item.unit_price_cents == null || item.price_cents == null) return true;
  const expected = item.qty * item.unit_price_cents;
  return Math.abs(expected - item.price_cents) <= WEIGHED_TOLERANCE_CENTS;
}

export function runPostChecks(receipt: ParsedReceipt): PostCheckResult {
  const issues: ItemIssue[] = [];

  const items = receipt.items.map((item, index) => {
    let checked = item;

    // §5.5 #4: an invalid check digit clears the barcode and drops confidence.
    if (item.barcode != null && !isValidGtin(item.barcode)) {
      issues.push({
        index,
        kind: 'invalid_barcode',
        message: `Barcode ${item.barcode} failed its check digit and was discarded.`,
      });
      checked = { ...checked, barcode: null, confidence: 'low' };
    }

    if (!weighedItemMatches(item)) {
      const expected = Math.round(item.qty * (item.unit_price_cents ?? 0));
      issues.push({
        index,
        kind: 'rate_mismatch',
        message: `${item.qty} × ${item.unit_price_cents}c is ${expected}c, but the line reads ${item.price_cents}c.`,
      });
      checked = { ...checked, confidence: 'low' };
    }

    return checked;
  });

  const corrected: ParsedReceipt = { ...receipt, items };

  // Checks 2 and 3, via the §4.11 definition. Itemless bills skip them there,
  // which is why summing zero items against a real total is not a mismatch.
  const flags = computeParseFlags({
    totalCents: corrected.total_cents,
    discountCents: corrected.discount_cents,
    unitsSold: corrected.units_sold,
    items: corrected.items.map((item) => ({
      priceCents: item.price_cents,
      scanUnits: item.scan_units,
      confidence: item.confidence,
    })),
  });

  return { flags, issues, receipt: corrected };
}
