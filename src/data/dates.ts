/**
 * Dates — spec §4.3.
 *
 * `purchased_at` is the **local calendar date as printed on the receipt** and
 * is never timezone-converted. That rules out `new Date(...).toISOString()`
 * for anything purchase-related: it would shift a late-evening NZ purchase
 * onto the previous day. Record timestamps (`created_at`/`updated_at`) are the
 * opposite — genuine instants, stored as ISO-8601 UTC.
 */

import type { LocalDate, LocalTime, UtcTimestamp } from '@/types/ledger';

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

/** True for a well-formed `YYYY-MM-DD` that is also a real calendar date. */
export function isValidLocalDate(value: string): value is LocalDate {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function isValidLocalTime(value: string): value is LocalTime {
  const match = TIME_PATTERN.exec(value);
  if (!match) return false;
  const [, hours, minutes] = match.map(Number);
  return hours <= 23 && minutes <= 59;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Today's date in the device's own timezone — not UTC's idea of today. */
export function todayLocalDate(now: Date = new Date()): LocalDate {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function nowUtc(now: Date = new Date()): UtcTimestamp {
  return now.toISOString();
}

/** `'2026-07-19'` → `'2026-07'`, the grouping key for the ledger's month headers. */
export function monthOf(date: LocalDate): string {
  return date.slice(0, 7);
}

/**
 * Formats a stored local date for display, in the device locale (§7).
 *
 * The parts are fed to `Date.UTC` and read back with `timeZone: 'UTC'` so the
 * formatter cannot shift the day — the value is a calendar date, not an
 * instant, and must render as the same day everywhere.
 */
export function formatDate(
  date: LocalDate,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }
): string {
  const match = DATE_PATTERN.exec(date);
  if (!match) return date;
  const [, year, month, day] = match.map(Number);
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

/** `'2026-07'` → `'July 2026'`, for the ledger's month headers. */
export function formatMonth(month: string): string {
  return formatDate(`${month}-01`, { month: 'long', year: 'numeric' });
}

/** `'2026-07'` → `'Jul'`, for chart axis labels where space is tight. */
export function formatMonthShort(month: string): string {
  return formatDate(`${month}-01`, { month: 'short' });
}

// ------------------------------------------------------- periods (Week 4) ---

/** An inclusive range of local calendar dates. */
export interface Period {
  from: LocalDate;
  to: LocalDate;
}

export function startOfMonth(month: string): LocalDate {
  return `${month}-01`;
}

export function endOfMonth(month: string): LocalDate {
  const [year, monthNumber] = month.split('-').map(Number);
  return `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, '0')}`;
}

/**
 * Shifts a `'YYYY-MM'` key by whole months.
 *
 * Done with integer arithmetic rather than `Date`, because a month key is a
 * calendar label, not an instant — and `new Date('2026-03-31')` minus a month
 * is the kind of expression that produces 3 March.
 */
export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const zeroBased = year * 12 + (monthNumber - 1) + delta;
  const newYear = Math.floor(zeroBased / 12);
  const newMonth = (zeroBased % 12) + 1;
  return `${String(newYear).padStart(4, '0')}-${String(newMonth).padStart(2, '0')}`;
}

/** The `count` months ending at `endMonth`, oldest first. */
export function monthSequence(endMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(endMonth, index - (count - 1)));
}

/**
 * The period covering `count` whole months up to and including the month of
 * `endDate` — "last 3 months" means three calendar months, not 90 days.
 */
export function periodOfLastMonths(count: number, endDate: LocalDate = todayLocalDate()): Period {
  const endMonthKey = monthOf(endDate);
  return {
    from: startOfMonth(addMonths(endMonthKey, -(count - 1))),
    to: endOfMonth(endMonthKey),
  };
}
