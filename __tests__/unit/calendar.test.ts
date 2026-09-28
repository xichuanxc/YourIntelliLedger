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
  MONTHS_PER_BAR,
  WEEKDAY_INITIALS,
  endOfQuarterMonth,
  endOfYearMonth,
  formatQuarter,
  formatRange,
  formatYear,
  isInMonth,
  monthGrid,
  orderedRange,
  quarterOf,
  spanDays,
  trendCountFor,
  trendUnitFor,
  withinPeriod,
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

/**
 * Quarters, for a period longer than a year.
 *
 * The chart divides its width by the number of bars, so thirteen monthly
 * bars leave each label about twenty pixels and the month names collide.
 * Folding into quarters is a readability fix, and the thing worth pinning is
 * that the buckets are *calendar* quarters: counting three months back from
 * wherever the range stops would give "August to October", which cannot be
 * labelled as a quarter because it is not one.
 */
describe('quarterly trends', () => {
  it('stays monthly for a year', () => {
    expect(trendUnitFor({ from: d('2026-01-01'), to: d('2026-12-31') })).toBe('month');
  });

  /** A hand-picked "last twelve months" often overshoots by a day or two. */
  it('tolerates a range slightly over a year', () => {
    expect(trendUnitFor({ from: d('2026-01-01'), to: d('2027-01-20') })).toBe('month');
  });

  it('switches to quarters past that', () => {
    expect(trendUnitFor({ from: d('2025-01-01'), to: d('2026-12-31') })).toBe('quarter');
  });

  it('counts whole calendar quarters, inclusively', () => {
    // March is Q1 and April is Q2: two quarters, however short the span.
    expect(trendCountFor({ from: d('2026-03-25'), to: d('2026-04-02') }, 'quarter')).toBe(2);
    expect(trendCountFor({ from: d('2025-01-01'), to: d('2026-12-31') }, 'quarter')).toBe(8);
  });

  it.each([
    ['2026-01', 1],
    ['2026-03', 1],
    ['2026-04', 2],
    ['2026-09', 3],
    ['2026-12', 4],
  ])('puts %s in quarter %i', (month, expected) => {
    expect(quarterOf(month)).toBe(expected);
  });

  /** Aligned to the calendar, so every fold of three is a real quarter. */
  it.each([
    ['2026-01', '2026-03'],
    ['2026-05', '2026-06'],
    ['2026-08', '2026-09'],
    ['2026-10', '2026-12'],
  ])('ends the quarter holding %s at %s', (month, expected) => {
    expect(endOfQuarterMonth(month)).toBe(expected);
  });

  /** Five characters, because a crowded axis has room for little more. */
  it('labels a quarter shortly', () => {
    expect(formatQuarter('2026-09')).toBe('Q3 26');
    expect(formatQuarter('2027-01')).toBe('Q1 27');
  });
});

/**
 * Years, past three of them — the last rung of the ladder.
 *
 * Twelve quarters is already the point where a label has about thirty pixels,
 * so a fourth year would crowd the axis the way months did before quarters.
 * Twelve yearly bars covers a decade, which is more ledger than this
 * application is for.
 */
describe('yearly trends', () => {
  it('stays quarterly for three years', () => {
    expect(trendUnitFor({ from: d('2024-01-01'), to: d('2026-12-31') })).toBe('quarter');
  });

  it('switches to years past that', () => {
    expect(trendUnitFor({ from: d('2022-01-01'), to: d('2026-12-31') })).toBe('year');
  });

  it('counts whole calendar years, inclusively', () => {
    expect(trendCountFor({ from: d('2022-06-01'), to: d('2026-02-01') }, 'year')).toBe(5);
    // Two days apart, but either side of New Year: two years, not one.
    expect(trendCountFor({ from: d('2026-12-31'), to: d('2027-01-01') }, 'year')).toBe(2);
  });

  /** Aligned to the calendar: twelve months back from March is not a year. */
  it.each([
    ['2026-01', '2026-12'],
    ['2026-07', '2026-12'],
    ['2026-12', '2026-12'],
  ])('ends the year holding %s at %s', (month, expected) => {
    expect(endOfYearMonth(month)).toBe(expected);
  });

  it('labels a year in four characters', () => {
    expect(formatYear('2026-09')).toBe('2026');
  });

  /** The fold sizes, so a bar is always a whole bucket. */
  it('knows how many months each bar holds', () => {
    expect(MONTHS_PER_BAR).toEqual({ month: 1, quarter: 3, year: 12 });
  });
});
