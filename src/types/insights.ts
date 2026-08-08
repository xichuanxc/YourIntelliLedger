/**
 * Aggregate shapes for the Insights screen (spec §7, Week 4).
 *
 * Money is integer cents here as everywhere else (§4.3). Every total is
 * reported as stored — nothing is smoothed, and gaps are named rather than
 * hidden, in the same spirit as the §4.11 integrity flags.
 */

import type { LocalDate } from '@/types/ledger';
import type { Category, Unit } from '@/types/vocabulary';

export interface SpendSummary {
  totalCents: number;
  billCount: number;
  itemCount: number;
  /** NULL when there are no bills — an average of nothing is not zero. */
  averageBillCents: number | null;
  firstBill: LocalDate | null;
  lastBill: LocalDate | null;
  /** The most-used currency in the period; 'NZD' when there is no data. */
  currency: string;
}

export interface CategoryTotal {
  category: Category;
  totalCents: number;
  itemCount: number;
}

/**
 * Category spend, plus the part of the total that no category can account for.
 *
 * Categories live on `bill_items`, so an **itemless bill** (§5.1) contributes
 * to the period total while belonging to no category at all. Discounts and any
 * gap between a printed total and its summed items land in the same place.
 * `unitemisedCents` is that remainder, reported explicitly so the breakdown
 * adds up to `totalCents` instead of quietly disagreeing with the headline
 * figure — the §14.6 undercount, made visible rather than repeated.
 *
 * It can be negative when items sum to more than the printed total (a receipt
 * whose discount is attached per-line, say). That is left as-is; the screen
 * decides how to present it.
 */
export interface CategoryBreakdown {
  categories: CategoryTotal[];
  unitemisedCents: number;
  totalCents: number;
}

export interface MerchantTotal {
  /** As printed, for display. NULL when the bill recorded no merchant. */
  merchant: string | null;
  /** The grouping key (§4.8). */
  merchantNorm: string | null;
  totalCents: number;
  billCount: number;
}

/**
 * One line behind a category slice — an item, with the bill it came from.
 *
 * Categories live on items, so drilling into a category is drilling into
 * items, not bills. The merchant and date come along because "Produce, $31.12"
 * is only useful once you can see it was four visits to two shops.
 */
export interface CategoryItem {
  billId: number;
  purchasedAt: LocalDate;
  merchant: string | null;
  name: string;
  qty: number;
  unit: Unit;
  /** NULL for an illegible price (§4.3) — excluded from the category's total. */
  priceCents: number | null;
}

/** One line behind a merchant slice — a bill, since merchants live on bills. */
export interface MerchantBill {
  billId: number;
  purchasedAt: LocalDate;
  merchant: string | null;
  totalCents: number;
  itemCount: number;
}

/**
 * One line behind the "Not itemised" slice.
 *
 * The remainder is not "bills with no items" — a bill can be partly itemised,
 * and a discount or an illegible price opens the same gap. So this reports the
 * shortfall *per bill*: what the receipt totalled, what its items account for,
 * and the difference. Summed, `remainderCents` is `unitemisedCents`.
 */
export interface UnitemisedBill {
  billId: number;
  purchasedAt: LocalDate;
  merchant: string | null;
  totalCents: number;
  itemisedCents: number;
  remainderCents: number;
}

export interface MonthTotal {
  /** `'YYYY-MM'`. */
  month: string;
  totalCents: number;
  billCount: number;
}

/** What the ledger actually spans — also the basis of the §6.3 data catalog. */
export interface DataRange {
  firstBill: LocalDate | null;
  lastBill: LocalDate | null;
  billCount: number;
}
