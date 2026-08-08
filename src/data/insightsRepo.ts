/**
 * Aggregate queries behind the Insights screen (§7, Week 4).
 *
 * Separate from `ledgerRepo` because the questions are different — one reads
 * bills, the other summarises them — and separate from the agent's `compile.ts`
 * (§14.6) because that module answers a *constrained model-supplied spec*,
 * while these are fixed queries the UI owns. §2.1 lists both, and merging them
 * would drag the query-validator's constraints into a screen that has none.
 *
 * **The rule that matters here** (§14.6): period and merchant totals sum
 * `bills.total_cents`. Only the category breakdown goes through `bill_items`,
 * because only items carry a category — and that difference is surfaced as
 * `unitemisedCents` rather than left to quietly undercount.
 */

import type { Period } from '@/data/dates';
import { addMonths, endOfMonth, monthOf, monthSequence, startOfMonth } from '@/data/dates';
import type { SqlDriver, SqlValue } from '@/data/driver';
import type { LocalDate } from '@/types/ledger';
import type {
  CategoryBreakdown,
  CategoryItem,
  CategoryTotal,
  DataRange,
  MerchantBill,
  MerchantTotal,
  MonthTotal,
  SpendSummary,
  UnitemisedBill,
} from '@/types/insights';
import type { Category, Unit } from '@/types/vocabulary';

const DEFAULT_CURRENCY = 'NZD';

function periodParams(period: Period): SqlValue[] {
  return [period.from, period.to];
}

/**
 * Headline figures for a period.
 *
 * `SUM` over no rows is NULL in SQLite, not 0, so every total is coalesced —
 * but `averageBillCents` stays NULL when there are no bills, because the
 * average of nothing is genuinely unknown and rendering it as $0.00 would be a
 * small lie on an empty screen.
 */
export async function getSpendSummary(db: SqlDriver, period: Period): Promise<SpendSummary> {
  const bills = await db.get<{
    bill_count: number;
    total_cents: number | null;
    first_at: string | null;
    last_at: string | null;
  }>(
    `SELECT COUNT(*) AS bill_count,
            SUM(total_cents) AS total_cents,
            MIN(purchased_at) AS first_at,
            MAX(purchased_at) AS last_at
       FROM bills
      WHERE purchased_at BETWEEN ? AND ?`,
    periodParams(period)
  );

  const items = await db.get<{ item_count: number }>(
    `SELECT COUNT(*) AS item_count
       FROM bill_items i
       JOIN bills b ON b.id = i.bill_id
      WHERE b.purchased_at BETWEEN ? AND ?`,
    periodParams(period)
  );

  // Mixed-currency ledgers are out of scope for v1, but picking the most-used
  // currency is more honest than assuming NZD when the data says otherwise.
  const currency = await db.get<{ currency: string }>(
    `SELECT currency
       FROM bills
      WHERE purchased_at BETWEEN ? AND ?
      GROUP BY currency
      ORDER BY COUNT(*) DESC, currency
      LIMIT 1`,
    periodParams(period)
  );

  const billCount = bills?.bill_count ?? 0;
  const totalCents = bills?.total_cents ?? 0;

  return {
    totalCents,
    billCount,
    itemCount: items?.item_count ?? 0,
    averageBillCents: billCount > 0 ? Math.round(totalCents / billCount) : null,
    firstBill: bills?.first_at ?? null,
    lastBill: bills?.last_at ?? null,
    currency: currency?.currency ?? DEFAULT_CURRENCY,
  };
}

/**
 * Spend per category, plus the remainder no category explains.
 *
 * `SUM` skips NULL prices, so an illegible line (§4.3) is excluded from its
 * category rather than counted as zero — it then shows up inside
 * `unitemisedCents`, which is the honest place for "we don't know".
 */
export async function getCategoryBreakdown(
  db: SqlDriver,
  period: Period
): Promise<CategoryBreakdown> {
  const rows = await db.all<{ category: Category; total_cents: number | null; item_count: number }>(
    `SELECT i.category,
            SUM(i.price_cents) AS total_cents,
            COUNT(*) AS item_count
       FROM bill_items i
       JOIN bills b ON b.id = i.bill_id
      WHERE b.purchased_at BETWEEN ? AND ?
      GROUP BY i.category
      ORDER BY total_cents DESC, i.category`,
    periodParams(period)
  );

  const categories: CategoryTotal[] = rows.map((row) => ({
    category: row.category,
    totalCents: row.total_cents ?? 0,
    itemCount: row.item_count,
  }));

  const summary = await getSpendSummary(db, period);
  const itemised = categories.reduce((sum, entry) => sum + entry.totalCents, 0);

  return {
    categories,
    unitemisedCents: summary.totalCents - itemised,
    totalCents: summary.totalCents,
  };
}

/**
 * Top merchants by spend, grouped on `merchant_norm` (§4.8).
 *
 * `MAX(merchant)` picks a display name from the group. Where OCR produced two
 * spellings that normalise the same, this shows one of them — the §4.8
 * limitation, visible rather than papered over.
 */
export async function getMerchantBreakdown(
  db: SqlDriver,
  period: Period,
  limit = 8
): Promise<MerchantTotal[]> {
  const rows = await db.all<{
    merchant: string | null;
    merchant_norm: string | null;
    total_cents: number | null;
    bill_count: number;
  }>(
    `SELECT MAX(merchant) AS merchant,
            merchant_norm,
            SUM(total_cents) AS total_cents,
            COUNT(*) AS bill_count
       FROM bills
      WHERE purchased_at BETWEEN ? AND ?
      GROUP BY merchant_norm
      ORDER BY total_cents DESC, merchant_norm
      LIMIT ?`,
    [...periodParams(period), limit]
  );

  return rows.map((row) => ({
    merchant: row.merchant,
    merchantNorm: row.merchant_norm,
    totalCents: row.total_cents ?? 0,
    billCount: row.bill_count,
  }));
}

/**
 * Month-over-month spend, with empty months present as zeros.
 *
 * A month with no bills must still occupy its slot: a trend chart that closes
 * the gap would show a flat line across a month you spent nothing, which reads
 * as continuity rather than absence.
 */
export async function getMonthlyTrend(
  db: SqlDriver,
  months: number,
  endMonth: string
): Promise<MonthTotal[]> {
  const from = startOfMonth(addMonths(endMonth, -(months - 1)));
  const to = endOfMonth(endMonth);

  const rows = await db.all<{ month: string; total_cents: number | null; bill_count: number }>(
    `SELECT strftime('%Y-%m', purchased_at) AS month,
            SUM(total_cents) AS total_cents,
            COUNT(*) AS bill_count
       FROM bills
      WHERE purchased_at BETWEEN ? AND ?
      GROUP BY month`,
    [from, to]
  );

  const byMonth = new Map(rows.map((row) => [row.month, row]));

  return monthSequence(endMonth, months).map((month) => ({
    month,
    totalCents: byMonth.get(month)?.total_cents ?? 0,
    billCount: byMonth.get(month)?.bill_count ?? 0,
  }));
}

/**
 * The items behind one category slice, newest first (§7 drill-down).
 *
 * Ordered by date descending because that is the question being asked — "what
 * did I buy, and when" — with the item name as a stable tiebreak so two lines
 * on the same receipt do not swap places between renders.
 *
 * Illegible prices are kept, as NULL. They are excluded from the category
 * total by `getCategoryBreakdown`'s `SUM`, so hiding them here would leave a
 * list that quietly fails to add up to the figure that led the user into it.
 */
export async function getCategoryItems(
  db: SqlDriver,
  period: Period,
  category: Category
): Promise<CategoryItem[]> {
  const rows = await db.all<{
    bill_id: number;
    purchased_at: LocalDate;
    merchant: string | null;
    name: string;
    qty: number;
    unit: Unit;
    price_cents: number | null;
  }>(
    `SELECT i.bill_id, b.purchased_at, b.merchant, i.name, i.qty, i.unit, i.price_cents
       FROM bill_items i
       JOIN bills b ON b.id = i.bill_id
      WHERE b.purchased_at BETWEEN ? AND ?
        AND i.category = ?
      ORDER BY b.purchased_at DESC, i.name`,
    [...periodParams(period), category]
  );

  return rows.map((row) => ({
    billId: row.bill_id,
    purchasedAt: row.purchased_at,
    merchant: row.merchant,
    name: row.name,
    qty: row.qty,
    unit: row.unit,
    priceCents: row.price_cents,
  }));
}

/**
 * The bills behind one merchant slice, newest first.
 *
 * `merchantNorm` is the §4.8 grouping key, and NULL is a real value — bills
 * that recorded no merchant group together. `IS` rather than `=` because in
 * SQL `NULL = NULL` is NULL, so an equality test would silently return nothing
 * for exactly that group.
 */
export async function getMerchantBills(
  db: SqlDriver,
  period: Period,
  merchantNorm: string | null
): Promise<MerchantBill[]> {
  const rows = await db.all<{
    id: number;
    purchased_at: LocalDate;
    merchant: string | null;
    total_cents: number;
    item_count: number;
  }>(
    `SELECT b.id, b.purchased_at, b.merchant, b.total_cents,
            (SELECT COUNT(*) FROM bill_items i WHERE i.bill_id = b.id) AS item_count
       FROM bills b
      WHERE b.purchased_at BETWEEN ? AND ?
        AND b.merchant_norm IS ?
      ORDER BY b.purchased_at DESC, b.id DESC`,
    [...periodParams(period), merchantNorm]
  );

  return rows.map((row) => ({
    billId: row.id,
    purchasedAt: row.purchased_at,
    merchant: row.merchant,
    totalCents: row.total_cents,
    itemCount: row.item_count,
  }));
}

/**
 * The bills behind the "Not itemised" slice, largest shortfall first.
 *
 * This is the one drill-down that is not a simple filter. The remainder is
 * `totalCents - itemisedCents` across the whole period (§14.6), so the honest
 * per-row unit is each bill's own shortfall — not "bills with no items", which
 * would miss a partly itemised receipt and a per-line discount alike.
 *
 * Ordered by shortfall rather than date: the question here is "what is making
 * up that half of my spending", and the answer is usually one or two bills.
 * Rows where the items already account for the total are excluded — a
 * remainder of zero explains nothing.
 */
export async function getUnitemisedBills(
  db: SqlDriver,
  period: Period
): Promise<UnitemisedBill[]> {
  const rows = await db.all<{
    id: number;
    purchased_at: LocalDate;
    merchant: string | null;
    total_cents: number;
    itemised_cents: number | null;
  }>(
    `SELECT b.id, b.purchased_at, b.merchant, b.total_cents,
            (SELECT SUM(i.price_cents) FROM bill_items i WHERE i.bill_id = b.id) AS itemised_cents
       FROM bills b
      WHERE b.purchased_at BETWEEN ? AND ?
      ORDER BY (b.total_cents - COALESCE(itemised_cents, 0)) DESC, b.purchased_at DESC`,
    periodParams(period)
  );

  return rows
    .map((row) => {
      const itemisedCents = row.itemised_cents ?? 0;
      return {
        billId: row.id,
        purchasedAt: row.purchased_at,
        merchant: row.merchant,
        totalCents: row.total_cents,
        itemisedCents,
        remainderCents: row.total_cents - itemisedCents,
      };
    })
    .filter((row) => row.remainderCents > 0);
}

/** What the ledger spans, irrespective of any selected period. */
export async function getDataRange(db: SqlDriver): Promise<DataRange> {
  const row = await db.get<{ first_at: string | null; last_at: string | null; n: number }>(
    'SELECT MIN(purchased_at) AS first_at, MAX(purchased_at) AS last_at, COUNT(*) AS n FROM bills'
  );
  return {
    firstBill: row?.first_at ?? null,
    lastBill: row?.last_at ?? null,
    billCount: row?.n ?? 0,
  };
}

/** The month key the Insights screen should default to — the newest with data. */
export async function getLatestMonth(db: SqlDriver): Promise<string | null> {
  const range = await getDataRange(db);
  return range.lastBill ? monthOf(range.lastBill) : null;
}
