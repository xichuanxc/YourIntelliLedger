/**
 * Ledger domain types — the shape the rest of the app sees.
 *
 * These are *not* the raw SQLite rows (those live in `src/data/rows.ts` and
 * never escape the data layer). Money is integer cents everywhere, per
 * §4.3 — no `number` in this file ever holds dollars.
 */

import type {
  Category,
  CapturePath,
  Confidence,
  ParseFlag,
  Source,
  Unit,
} from '@/types/vocabulary';

/** A local calendar date, `YYYY-MM-DD`, exactly as printed (§4.3). */
export type LocalDate = string;
/** A local wall-clock time, `HH:MM` (§4.3). */
export type LocalTime = string;
/** ISO-8601 UTC instant, used for record timestamps only (§4.3). */
export type UtcTimestamp = string;

export interface BillItem {
  id: number;
  billId: number;
  /** Printed order — display and audit; not a stable identifier. */
  lineNo: number;
  name: string;
  /** Non-English name as printed; searched alongside `name` (§4.10). */
  nameLocal: string | null;
  category: Category;
  isFood: boolean;
  /** Consumable quantity — genuinely fractional for weighed goods (§4.9). */
  qty: number;
  unit: Unit;
  /** What the till counted, which is not the item count (§4.9). */
  scanUnits: number;
  /** NULL means illegible, never zero (§4.3). */
  priceCents: number | null;
  /** Cents per `unit`; only for lines the till itself weighed (§4.9). */
  unitPriceCents: number | null;
  barcode: string | null;
  confidence: Confidence | null;
  userCorrected: boolean;
  /** Verbatim OCR for this line — cold, shown as secondary text on review. */
  rawText: string | null;
}

export interface Bill {
  id: number;
  merchant: string | null;
  /** Normalised for grouping; derived, never entered by hand (§4.8). */
  merchantNorm: string | null;
  /** Printed store address, unresolved by design (§4.14). */
  merchantAddress: string | null;
  purchasedAt: LocalDate;
  purchasedTime: LocalTime | null;
  /** Printed TOTAL, GST-inclusive. NULL when illegible. */
  totalCents: number | null;
  /** Unattached promo deductions, stored as a positive magnitude. */
  discountCents: number;
  currency: string;
  /** Printed scan-unit count, if the receipt shows one. */
  unitsSold: number | null;
  source: Source;
  capturePath: CapturePath | null;
  /** Receipt images on disk under `receipts/{id}/` (§4.5). */
  pageCount: number;
  modelAlias: string | null;
  createdAt: UtcTimestamp;
  updatedAt: UtcTimestamp;
  /** Integrity-check results; never silently corrected (§4.11). */
  parseFlags: ParseFlag[];
  /** When a person confirmed they had looked at the flags, or null. */
  reviewedAt: UtcTimestamp | null;
  /** Which flags that confirmation covered — see `data/review.ts`. */
  reviewedFlags: ParseFlag[] | null;
}

/** A bill with its line items. An itemless bill has `items: []` (§5.1). */
export interface BillWithItems extends Bill {
  items: BillItem[];
}

/**
 * What a caller supplies to create a bill. Derived fields (`merchantNorm`,
 * `parseFlags`, timestamps, `id`) are the repository's job, not the caller's.
 */
export interface NewBillInput {
  merchant?: string | null;
  merchantAddress?: string | null;
  purchasedAt: LocalDate;
  purchasedTime?: LocalTime | null;
  totalCents?: number | null;
  discountCents?: number;
  currency?: string;
  unitsSold?: number | null;
  source: Source;
  capturePath?: CapturePath | null;
  modelAlias?: string | null;
  items?: NewBillItemInput[];
  /**
   * Cached OCR text, one entry per page in capture order (§4.6). Written in
   * the same transaction as the bill, so a receipt can never end up stored
   * without the text it was parsed from.
   */
  ocrPages?: string[];
}

export interface NewBillItemInput {
  name: string;
  nameLocal?: string | null;
  category: Category;
  isFood?: boolean;
  qty?: number;
  unit?: Unit;
  scanUnits?: number;
  priceCents?: number | null;
  unitPriceCents?: number | null;
  barcode?: string | null;
  confidence?: Confidence | null;
  rawText?: string | null;
  /**
   * Set when the user changed this line on the review screen (§5.6). It is the
   * corpus a future `parse_corrections` table (§4.11) would be built from, so
   * it records a real correction, never a value that merely passed through.
   */
  userCorrected?: boolean;
}

/** Patch shape for editing a bill. Omitted keys are left alone. */
export type BillPatch = Partial<
  Pick<
    Bill,
    | 'merchant'
    | 'merchantAddress'
    | 'purchasedAt'
    | 'purchasedTime'
    | 'totalCents'
    | 'discountCents'
    | 'currency'
    | 'unitsSold'
  >
>;

/** Patch shape for editing one line item. Any edit sets `userCorrected` (§5.6). */
export type BillItemPatch = Partial<
  Pick<
    BillItem,
    | 'name'
    | 'nameLocal'
    | 'category'
    | 'isFood'
    | 'qty'
    | 'unit'
    | 'scanUnits'
    | 'priceCents'
    | 'unitPriceCents'
    | 'barcode'
  >
>;

/** One row of the ledger list: the bill plus the few aggregates it shows. */
export interface BillSummary {
  id: number;
  merchant: string | null;
  purchasedAt: LocalDate;
  purchasedTime: LocalTime | null;
  totalCents: number | null;
  currency: string;
  source: Source;
  itemCount: number;
  parseFlags: ParseFlag[];
  /** Which flags a person has accepted — see `data/review.ts`. */
  reviewedFlags: ParseFlag[] | null;
}

/** A calendar month of bills with its header total (§7 ledger screen). */
export interface LedgerMonth {
  /** `YYYY-MM`. */
  month: string;
  totalCents: number;
  bills: BillSummary[];
}
