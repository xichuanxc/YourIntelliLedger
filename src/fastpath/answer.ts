/**
 * Intent → answer, without a model (§6.6).
 *
 * Every number here comes from the same repositories the Insights screen
 * reads. That is the point: if a fastpath computed its own totals, the Ask tab
 * and the Insights tab could disagree about "this month", which is a worse bug
 * than any this module saves. It also means the itemless-bill rule (§14.6)
 * holds for free — `getSpendSummary` sums printed bill totals, while
 * `getCategoryBreakdown` sums item prices and reports the remainder that
 * belongs to no category.
 *
 * ## What gets a chart
 *
 * Only answers with a comparison in them. A single number is already stated in
 * the sentence, and `planRender` turns a one-value series into a stat tile
 * whose label falls back to the series label — which, for money, has to be the
 * currency code. A tile reading "NZD $214.30" underneath a sentence that just
 * said it is noise, so scalar answers render as text alone.
 *
 * Values in a render block are **major units** with the currency code as the
 * series label, because that pair is how `planRender` recognises money.
 */

import type { AnswerEnvelope, RenderSpec } from '@/agent/envelope';
import type { BillReference } from '@/agent/execute';
import { endOfMonth, formatDayMonth, formatMonthShort, monthOf, startOfMonth, type Period } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';
import {
  getCategoryBreakdown,
  getDataRange,
  getMerchantBreakdown,
  getMonthlyTrend,
  getSpendSummary,
} from '@/data/insightsRepo';
import { listBills } from '@/data/ledgerRepo';
import { normaliseMerchant } from '@/data/merchant';
import { formatMoney } from '@/data/money';
import type { FastpathIntent } from '@/fastpath/match';
import type { PhrasePeriod } from '@/fastpath/datePhrase';
import type { LocalDate } from '@/types/ledger';
import { CATEGORY_LABELS } from '@/types/vocabulary';

export interface FastpathContext {
  db: SqlDriver;
  /** Passed in, never read from a clock, so answers are testable. */
  today: LocalDate;
}

export interface FastpathAnswer {
  envelope: AnswerEnvelope;
  /** Only list-shaped answers vouch for links — see `execute.ts`. */
  references: BillReference[];
  /**
   * The currency the amounts were computed in — set only when there is a
   * chart. `planRender` needs it to tell money from counts, and the fastpath
   * skips the §6.3 catalog that normally supplies it. A text-only answer has
   * already formatted its own money and needs nothing.
   */
  currency?: string;
}

/** How many merchants a "where do I shop" chart can show before it blurs. */
const MERCHANT_CHART_LIMIT = 8;
/** Enough to find the shop someone named without scanning the whole ledger. */
const MERCHANT_SEARCH_LIMIT = 50;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * The period as it belongs in a sentence.
 *
 * The parser's labels are bare ("this month", "June", "the last 3 months")
 * because they are also used for matching. Reading them back to someone needs
 * the preposition that makes each one a phrase.
 */
function asPhrase(label: string): string {
  if (label.startsWith('the last')) return `over ${label}`;
  // A capitalised label is a month name; everything else already reads as an
  // adverbial ("this month", "yesterday").
  return /^[A-Z]/.test(label) ? `in ${label}` : label;
}

interface Window {
  period: Period;
  /** Reads as a phrase: "this month", "in June", "in total". */
  label: string;
}

/**
 * The window to answer over, or null when the ledger is empty.
 *
 * A question with no period in it is about everything, so the window becomes
 * the ledger's own span rather than an arbitrary default — answering "how much
 * have I spent" about the current month would silently narrow the question.
 */
async function windowFor(db: SqlDriver, phrase: PhrasePeriod | null): Promise<Window | null> {
  if (phrase) return { period: phrase.period, label: asPhrase(phrase.label) };

  const range = await getDataRange(db);
  if (!range.firstBill || !range.lastBill) return null;
  return { period: { from: range.firstBill, to: range.lastBill }, label: 'in total' };
}

const NO_BILLS: FastpathAnswer = {
  envelope: { text: 'There are no bills on this phone yet, so there is nothing to add up.' },
  references: [],
};

/** One series of amounts, labelled the way `planRender` recognises money. */
function moneyChart(
  type: RenderSpec['type'],
  title: string,
  currency: string,
  labels: string[],
  cents: number[]
): RenderSpec {
  return {
    type,
    title,
    x: { values: labels },
    series: [{ label: currency, values: cents.map((value) => value / 100) }],
  };
}

async function answerTotal(
  period: PhrasePeriod | null,
  countOnly: boolean,
  { db }: FastpathContext
): Promise<FastpathAnswer | null> {
  const window = await windowFor(db, period);
  if (!window) return NO_BILLS;

  const summary = await getSpendSummary(db, window.period);
  if (summary.billCount === 0) {
    return { envelope: { text: `You have no bills ${window.label}.` }, references: [] };
  }

  const money = formatMoney(summary.totalCents, summary.currency);
  return {
    envelope: {
      text: countOnly
        ? `You have ${plural(summary.billCount, 'bill')} ${window.label}, totalling ${money}.`
        : `You spent ${money} ${window.label}, across ${plural(summary.billCount, 'bill')}.`,
    },
    references: [],
  };
}

async function answerCategory(
  intent: Extract<FastpathIntent, { kind: 'category_spend' }>,
  { db }: FastpathContext
): Promise<FastpathAnswer | null> {
  const window = await windowFor(db, intent.period);
  if (!window) return NO_BILLS;

  const breakdown = await getCategoryBreakdown(db, window.period);
  const summary = await getSpendSummary(db, window.period);
  const row = breakdown.categories.find((entry) => entry.category === intent.category);
  const name = CATEGORY_LABELS[intent.category].toLowerCase();

  if (!row || row.totalCents === 0) {
    return {
      envelope: { text: `Nothing on your receipts ${window.label} was categorised as ${name}.` },
      references: [],
    };
  }

  // §14.6's gap, said out loud. Categories live on items, so an itemless bill
  // contributes to the total and to no category — quoting a category figure
  // without mentioning that would invite the user to add them up and find
  // them short.
  const gap =
    breakdown.unitemisedCents > 0
      ? ` ${formatMoney(breakdown.unitemisedCents, summary.currency)} of your spending ${window.label} is on receipts whose items were not itemised, so it belongs to no category.`
      : '';

  return {
    envelope: {
      text:
        `You spent ${formatMoney(row.totalCents, summary.currency)} on ${name} ${window.label}, ` +
        `across ${plural(row.itemCount, 'item')}.${gap}`,
    },
    references: [],
  };
}

async function answerMerchant(
  intent: Extract<FastpathIntent, { kind: 'merchant_spend' }>,
  { db }: FastpathContext
): Promise<FastpathAnswer | null> {
  const window = await windowFor(db, intent.period);
  if (!window) return NO_BILLS;

  const term = normaliseMerchant(intent.term);
  // §4.8 strips punctuation, so a term can normalise away to nothing. An empty
  // term would match every shop.
  if (!term) return null;

  const merchants = await getMerchantBreakdown(db, window.period, MERCHANT_SEARCH_LIMIT);
  const hit = merchants.find((entry) => entry.merchantNorm?.includes(term));
  // Not a shop this ledger knows. Declining hands it to the agent, which can
  // search line items and ask what was meant.
  if (!hit) return null;

  const summary = await getSpendSummary(db, window.period);
  return {
    envelope: {
      text:
        `You spent ${formatMoney(hit.totalCents, summary.currency)} at ` +
        `${hit.merchant ?? intent.term} ${window.label}, across ${plural(hit.billCount, 'bill')}.`,
    },
    references: [],
  };
}

async function answerRecentBills(
  intent: Extract<FastpathIntent, { kind: 'recent_bills' }>,
  { db }: FastpathContext
): Promise<FastpathAnswer | null> {
  const bills = await listBills(db, { limit: intent.count });
  if (bills.length === 0) return NO_BILLS;

  const lines = bills.map((bill) => {
    const shop = bill.merchant ?? 'an unnamed shop';
    return `• ${formatDayMonth(bill.purchasedAt)} — ${shop}: ${formatMoney(bill.totalCents, bill.currency)}`;
  });

  return {
    envelope: {
      text: `Your ${bills.length === 1 ? 'most recent bill' : `last ${bills.length} bills`}:\n${lines.join('\n')}`,
    },
    // A list names real bills, so each shop can lead to its receipt.
    references: bills
      .filter((bill): bill is typeof bill & { merchant: string } => bill.merchant !== null)
      .map((bill) => ({ billId: bill.id, label: bill.merchant })),
  };
}

async function answerMonthVsMonth({ db, today }: FastpathContext): Promise<FastpathAnswer | null> {
  const current = monthOf(today);
  const [previous, latest] = await getMonthlyTrend(db, 2, current);
  const summary = await getSpendSummary(db, {
    from: startOfMonth(previous.month),
    to: endOfMonth(latest.month),
  });

  if (summary.billCount === 0) return NO_BILLS;

  const difference = latest.totalCents - previous.totalCents;
  const direction = difference === 0 ? 'the same as' : difference > 0 ? 'more than' : 'less than';
  const gap =
    difference === 0
      ? ''
      : ` — ${formatMoney(Math.abs(difference), summary.currency)} ${difference > 0 ? 'more' : 'less'}`;

  return {
    envelope: {
      text:
        `So far this month you have spent ${formatMoney(latest.totalCents, summary.currency)}, ` +
        `${direction} the ${formatMoney(previous.totalCents, summary.currency)} you spent last month${gap}. ` +
        `This month is not over yet, so it is not a like-for-like comparison.`,
      render: moneyChart(
        'bar',
        'This month against last',
        summary.currency,
        [formatMonthShort(previous.month), formatMonthShort(latest.month)],
        [previous.totalCents, latest.totalCents]
      ),
    },
    references: [],
    currency: summary.currency,
  };
}

async function answerTopCategory(
  period: PhrasePeriod | null,
  { db }: FastpathContext
): Promise<FastpathAnswer | null> {
  const window = await windowFor(db, period);
  if (!window) return NO_BILLS;

  const breakdown = await getCategoryBreakdown(db, window.period);
  const summary = await getSpendSummary(db, window.period);
  const spent = breakdown.categories.filter((entry) => entry.totalCents > 0);
  if (spent.length === 0) {
    return {
      envelope: { text: `None of your receipts ${window.label} have categorised items on them.` },
      references: [],
    };
  }

  const top = spent[0];
  return {
    envelope: {
      text:
        `Your biggest category ${window.label} was ${CATEGORY_LABELS[top.category].toLowerCase()}, ` +
        `at ${formatMoney(top.totalCents, summary.currency)}.`,
      // A donut past eight slices becomes a bar in `planRender`; there are ten
      // categories, so that rule does the deciding rather than this file.
      render: moneyChart(
        'donut',
        `Spending by category, ${window.label}`,
        summary.currency,
        spent.map((entry) => CATEGORY_LABELS[entry.category]),
        spent.map((entry) => entry.totalCents)
      ),
    },
    references: [],
    currency: summary.currency,
  };
}

async function answerTopMerchant(
  period: PhrasePeriod | null,
  { db }: FastpathContext
): Promise<FastpathAnswer | null> {
  const window = await windowFor(db, period);
  if (!window) return NO_BILLS;

  const merchants = await getMerchantBreakdown(db, window.period, MERCHANT_CHART_LIMIT);
  const named = merchants.filter((entry) => entry.merchant !== null);
  if (named.length === 0) return NO_BILLS;

  const summary = await getSpendSummary(db, window.period);
  const top = named[0];

  return {
    envelope: {
      text:
        `You spent most at ${top.merchant} ${window.label} — ` +
        `${formatMoney(top.totalCents, summary.currency)} across ${plural(top.billCount, 'bill')}.`,
      render: moneyChart(
        'bar',
        `Spending by shop, ${window.label}`,
        summary.currency,
        named.map((entry) => entry.merchant as string),
        named.map((entry) => entry.totalCents)
      ),
    },
    references: [],
    currency: summary.currency,
  };
}

/**
 * Answers a matched intent, or returns null to hand the question back.
 *
 * Null is a real outcome, not an error: a merchant this ledger has never seen
 * is better answered by the agent, which can look inside line items.
 */
export async function answerFastpath(
  intent: FastpathIntent,
  context: FastpathContext
): Promise<FastpathAnswer | null> {
  switch (intent.kind) {
    case 'total':
      return answerTotal(intent.period, false, context);
    case 'bill_count':
      return answerTotal(intent.period, true, context);
    case 'category_spend':
      return answerCategory(intent, context);
    case 'merchant_spend':
      return answerMerchant(intent, context);
    case 'recent_bills':
      return answerRecentBills(intent, context);
    case 'month_vs_month':
      return answerMonthVsMonth(context);
    case 'top_category':
      return answerTopCategory(intent.period, context);
    case 'top_merchant':
      return answerTopMerchant(intent.period, context);
  }
}
