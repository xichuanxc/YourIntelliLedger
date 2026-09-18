/**
 * The month grid and the rules a self-defined period needs (§7).
 *
 * Two things here would be invisible if they were wrong. A grid that starts on
 * the wrong weekday still looks like a calendar, and puts every date under the
 * wrong column heading. And a custom range's trend unit decides whether "1–28
 * March" draws as four weekly bars or one monthly one — the presets carry
 * their unit, an arbitrary range has to be told.
 */

import {
  formatRange,
  isInMonth,
  monthGrid,
  orderedRange,
  spanDays,
  trendCountFor,
  trendUnitFor,
  withinPeriod,
  WEEKDAY_INITIALS,
} from '@/ui/calendar';
import type { LocalDate } from '@/types/ledger';

const d = (value: string) => value as LocalDate;

describe('the month grid', () => {
  it('always has six rows of seven, so the sheet does not jump', () => {
    for (const month of ['2026-02', '2026-03', '2026-08', '2027-01']) {
      const grid = monthGrid(month);
      expect(grid).toHaveLength(6);
      for (const week of grid) expect(week).toHaveLength(7);
    }
  });

  /**
   * Monday first, matching `startOfWeek` and the weekly trend. A Sunday-first
   * grid would put a bill in a different week from the chart beside it.
   */
  it('starts each row on a Monday', () => {
    // 1 September 2026 is a Tuesday, so the grid opens on 31 August.
    expect(monthGrid('2026-09')[0][0]).toBe('2026-08-31');
    expect(WEEKDAY_INITIALS[0]).toBe('M');
  });

  it('runs in unbroken days across the whole grid', () => {
    const days = monthGrid('2026-09').flat();
    for (let i = 1; i < days.length; i += 1) {
      const gap = Date.parse(`${days[i]}T00:00:00Z`) - Date.parse(`${days[i - 1]}T00:00:00Z`);
      expect(gap).toBe(86_400_000);
    }
  });

  /** The neighbours are drawn, not left as holes — a gap reads as missing data. */
  it('marks which cells belong to the month on show', () => {
    expect(isInMonth(d('2026-08-31'), '2026-09')).toBe(false);
    expect(isInMonth(d('2026-09-01'), '2026-09')).toBe(true);
    expect(isInMonth(d('2026-09-30'), '2026-09')).toBe(true);
    expect(isInMonth(d('2026-10-01'), '2026-09')).toBe(false);
  });

  it('covers February in a leap year', () => {
    const days = monthGrid('2028-02').flat();
    expect(days).toContain('2028-02-29');
  });
});

describe('picking two dates', () => {
  /** People pick the end first about as often as they mean to. */
  it('accepts them in either order', () => {
    const forwards = orderedRange(d('2026-03-01'), d('2026-03-28'));
    const backwards = orderedRange(d('2026-03-28'), d('2026-03-01'));

    expect(forwards).toEqual({ from: '2026-03-01', to: '2026-03-28' });
    expect(backwards).toEqual(forwards);
  });

  it('allows a single day', () => {
    expect(orderedRange(d('2026-03-05'), d('2026-03-05'))).toEqual({
      from: '2026-03-05',
      to: '2026-03-05',
    });
  });

  it('includes both ends', () => {
    const period = { from: d('2026-03-01'), to: d('2026-03-31') };
    expect(withinPeriod(d('2026-03-01'), period)).toBe(true);
    expect(withinPeriod(d('2026-03-31'), period)).toBe(true);
    expect(withinPeriod(d('2026-02-28'), period)).toBe(false);
    expect(withinPeriod(d('2026-04-01'), period)).toBe(false);
  });

  it('counts a span inclusively', () => {
    expect(spanDays({ from: d('2026-03-01'), to: d('2026-03-01') })).toBe(1);
    expect(spanDays({ from: d('2026-03-01'), to: d('2026-03-31') })).toBe(31);
  });
});

describe('what a custom range draws', () => {
  /** A month-long custom range should look like the four-week preset. */
  it('counts short ranges in weeks', () => {
    expect(trendUnitFor({ from: d('2026-03-01'), to: d('2026-03-28') })).toBe('week');
  });

  it('counts long ranges in months', () => {
    expect(trendUnitFor({ from: d('2026-01-01'), to: d('2026-06-30') })).toBe('month');
  });

  /** Whole calendar buckets: late March to early May touches three months. */
  it('counts the months a range touches, not its length', () => {
    expect(trendCountFor({ from: d('2026-03-28'), to: d('2026-05-02') }, 'month')).toBe(3);
    expect(trendCountFor({ from: d('2026-03-01'), to: d('2026-03-31') }, 'month')).toBe(1);
  });

  it('counts the weeks a range touches', () => {
    // Monday to the Sunday three weeks later.
    expect(trendCountFor({ from: d('2026-09-07'), to: d('2026-09-27') }, 'week')).toBe(3);
  });
});

describe('saying the range back', () => {
  it('shortens a range inside one month', () => {
    expect(formatRange({ from: d('2026-03-12'), to: d('2026-03-18') })).toBe('12–18 Mar 2026');
  });

  it('names both months when it crosses one', () => {
    expect(formatRange({ from: d('2026-03-12'), to: d('2026-06-04') })).toBe('12 Mar – 4 Jun 2026');
  });

  it('names both years when it crosses one', () => {
    expect(formatRange({ from: d('2025-12-28'), to: d('2026-01-04') })).toBe(
      '28 Dec 2025 – 4 Jan 2026'
    );
  });

  it('says a single day once', () => {
    expect(formatRange({ from: d('2026-03-05'), to: d('2026-03-05') })).toBe('5 Mar 2026');
  });
});
