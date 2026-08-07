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
import type {
  CategoryBreakdown,
  CategoryTotal,
  DataRange,
  MerchantTotal,
  MonthTotal,
  SpendSummary,
} from '@/types/insights';
import type { Category } from '@/types/vocabulary';

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
