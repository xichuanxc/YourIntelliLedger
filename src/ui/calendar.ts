/**
 * A month as a grid, and the arithmetic a custom period needs (§7).
 *
 * The Insights presets answer "the last N weeks or months", which is the
 * common case and needs no calendar. A self-defined period does — and rather
 * than add a native date picker (and a rebuild, and a toolchain that has
 * already cost this project a day), the app draws its own, the same trade it
 * made choosing map tiles over a maps SDK.
 *
 * Pure and dependency-free, so the grid and the range rules are tested in the
 * `node` project rather than by tapping at a phone.
 */

import {
  addDays,
  addMonths,
  endOfMonth,
  monthOf,
  startOfMonth,
  startOfWeek,
  type Period,
} from '@/data/dates';
import type { LocalDate } from '@/types/ledger';

/** Six rows always, so the sheet does not change height between months. */
const WEEKS_IN_GRID = 6;
const DAYS_IN_WEEK = 7;

/**
 * Monday first, because the rest of the app already counts weeks that way —
 * `startOfWeek`, the weekly trend, and the SQL that buckets them. A calendar
 * starting on Sunday here would put a bill in a different week from the chart
 * beside it.
 */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const;

/**
 * The days to draw for `month` (`YYYY-MM`), as six rows of seven.
 *
 * Includes the days either side that share a row with this month — a grid with
 * holes in it reads as missing data. The caller dims them; `isInMonth` says
 * which they are.
 */
export function monthGrid(month: string): LocalDate[][] {
  const firstCell = startOfWeek(startOfMonth(month));

  return Array.from({ length: WEEKS_IN_GRID }, (_, week) =>
    Array.from({ length: DAYS_IN_WEEK }, (_, day) =>
      addDays(firstCell, week * DAYS_IN_WEEK + day)
    )
  );
}

/** Whether a grid cell belongs to the month being shown, or is a neighbour. */
export function isInMonth(date: LocalDate, month: string): boolean {
  return monthOf(date) === month;
}

/** The months either side, for the sheet's arrows. */
export function previousMonth(month: string): string {
  return addMonths(month, -1);
}

export function nextMonth(month: string): string {
  return addMonths(month, 1);
}

/**
 * A period from two dates picked in either order.
 *
 * People pick the end first about as often as they mean to, and refusing a
 * backwards range teaches a lesson nobody needs. Swapping is what they meant.
 */
export function orderedRange(a: LocalDate, b: LocalDate): Period {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** Whether a date falls inside a period, inclusive of both ends. */
export function withinPeriod(date: LocalDate, period: Period): boolean {
  return date >= period.from && date <= period.to;
}

/** Days from `from` to `to` inclusive. */
export function spanDays(period: Period): number {
  const ms = Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Past this many days a weekly trend has too many bars to read, and the
 * question has become "which months", not "which weeks". Ten weeks is a
 * little over the longest preset that uses weeks (`Last 4 weeks`), so a
 * custom range near that length behaves the way the preset beside it does.
 */
const WEEKLY_TREND_LIMIT_DAYS = 70;

/**
 * Past a year, a monthly trend stops being readable.
 *
 * The chart sizes its bars by how many there are, so thirteen months leaves
 * each label about twenty pixels of slot and the month names run into one
 * another. Quarters divide the same span by three and give each bar room.
 *
 * 400 days rather than 365: a range of "the last twelve months" picked by
 * hand is frequently a day or two over, and stepping it down to quarters for
 * that would be surprising.
 */
const MONTHLY_TREND_LIMIT_DAYS = 400;

/**
 * Past three years, quarters crowd the axis the way months did before them.
 *
 * Twelve quarters is already the point where a label has about thirty pixels;
 * a fourth year pushes past it. Years divide the span by four again, and four
 * characters fit where five did.
 *
 * This is the last rung. A ledger holding more than a decade of receipts is
 * not what this application is for, and twelve yearly bars covers that.
 */
const QUARTERLY_TREND_LIMIT_DAYS = 1200;

/**
 * Which unit a custom period's trend should be counted in.
 *
 * The presets carry their own — "last 4 weeks" is weekly by construction — but
 * an arbitrary range has to be told. Deriving it from the span keeps a custom
 * "1 March to 28 March" looking like the four-week preset rather than a single
 * monthly bar.
 */
export type TrendUnit = 'week' | 'month' | 'quarter' | 'year';

export function trendUnitFor(period: Period): TrendUnit {
  const days = spanDays(period);
  if (days <= WEEKLY_TREND_LIMIT_DAYS) return 'week';
  if (days <= MONTHLY_TREND_LIMIT_DAYS) return 'month';
  return days <= QUARTERLY_TREND_LIMIT_DAYS ? 'quarter' : 'year';
}

/**
 * How many months one bar of a trend covers.
 *
 * Weeks are not here: they are counted by a different query and never folded
 * out of months.
 */
export const MONTHS_PER_BAR: Record<Exclude<TrendUnit, 'week'>, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

/** The calendar quarter a month falls in, 1 to 4. */
export function quarterOf(month: string): number {
  return Math.floor((Number(month.slice(5, 7)) - 1) / 3) + 1;
}

/**
 * The last month of the quarter a month sits in.
 *
 * Quarters are aligned to the calendar, never to the period's end. Counting
 * three months back from whenever the range happens to stop would produce
 * buckets like "August to October", which is not a quarter and cannot be
 * labelled as one.
 */
export function endOfQuarterMonth(month: string): string {
  const lastMonth = quarterOf(month) * 3;
  return `${month.slice(0, 4)}-${String(lastMonth).padStart(2, '0')}`;
}

/** `Q3 26` — short enough to survive a crowded axis. */
export function formatQuarter(month: string): string {
  return `Q${quarterOf(month)} ${month.slice(2, 4)}`;
}

/**
 * The last month of the year a month sits in.
 *
 * Aligned to the calendar for the same reason quarters are: twelve months
 * counted back from an arbitrary end is not a year anybody names.
 */
export function endOfYearMonth(month: string): string {
  return `${month.slice(0, 4)}-12`;
}

/** `2026`. Four characters, which is what a crowded axis has room for. */
export function formatYear(month: string): string {
  return month.slice(0, 4);
}

/**
 * How many trend buckets a period covers, for the loader.
 *
 * Whole calendar buckets, counted inclusively — a range from late March to
 * early May touches three months, not the 1.4 its length suggests.
 */
export function trendCountFor(period: Period, unit: TrendUnit): number {
  if (unit === 'year') {
    return Number(period.to.slice(0, 4)) - Number(period.from.slice(0, 4)) + 1;
  }

  if (unit === 'quarter') {
    const [fromYear, fromMonth] = period.from.split('-').map(Number);
    const [toYear, toMonth] = period.to.split('-').map(Number);
    const fromQuarter = fromYear * 4 + Math.floor((fromMonth - 1) / 3);
    const toQuarter = toYear * 4 + Math.floor((toMonth - 1) / 3);
    return toQuarter - fromQuarter + 1;
  }

  if (unit === 'month') {
    const [fromYear, fromMonth] = period.from.split('-').map(Number);
    const [toYear, toMonth] = period.to.split('-').map(Number);
    return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
  }

  const firstWeek = startOfWeek(period.from);
  const lastWeek = startOfWeek(period.to);
  // The gap between the two Mondays, plus the week they sit in. `spanDays` is
  // inclusive, so the gap is one less than it reports — and a range that
  // starts and ends inside one week covers one week, not none.
  return Math.round((spanDays({ from: firstWeek, to: lastWeek }) - 1) / 7) + 1;
}

/** `12 Mar – 4 Jun 2026`, or `12–18 Mar 2026` when one month covers it. */
export function formatRange(period: Period): string {
  const day = (date: LocalDate) => String(Number(date.slice(8, 10)));
  const monthName = (date: LocalDate) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
  const year = (date: LocalDate) => date.slice(0, 4);

  if (period.from === period.to) {
    return `${day(period.from)} ${monthName(period.from)} ${year(period.from)}`;
  }

  if (monthOf(period.from) === monthOf(period.to)) {
    return `${day(period.from)}–${day(period.to)} ${monthName(period.to)} ${year(period.to)}`;
  }

  const sameYear = year(period.from) === year(period.to);
  const start = sameYear
    ? `${day(period.from)} ${monthName(period.from)}`
    : `${day(period.from)} ${monthName(period.from)} ${year(period.from)}`;

  return `${start} – ${day(period.to)} ${monthName(period.to)} ${year(period.to)}`;
}

/** The month a sheet should open on, given whatever is already chosen. */
export function openingMonth(period: Period | null, fallback: LocalDate): string {
  return monthOf(period?.from ?? fallback);
}

/** The last day of the month a grid is showing, for bounds checks. */
export function monthEnd(month: string): LocalDate {
  return endOfMonth(month);
}
