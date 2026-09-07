import {
  addDays,
  endOfWeek,
  formatDayMonth,
  periodOfLastWeeks,
  weekSequence,
  endOfYear,
  formatDate,
  isValidLocalDate,
  isValidLocalTime,
  monthOf,
  startOfWeek,
  startOfYear,
  todayLocalDate,
} from '@/data/dates';

describe('isValidLocalDate (spec §4.3)', () => {
  it('accepts real calendar dates', () => {
    expect(isValidLocalDate('2026-07-19')).toBe(true);
    expect(isValidLocalDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects dates that do not exist', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false);
    expect(isValidLocalDate('2025-02-29')).toBe(false); // not a leap year
    expect(isValidLocalDate('2026-13-01')).toBe(false);
    expect(isValidLocalDate('2026-00-10')).toBe(false);
    expect(isValidLocalDate('2026-04-31')).toBe(false);
  });

  it('rejects anything not in YYYY-MM-DD form', () => {
    expect(isValidLocalDate('19/07/2026')).toBe(false);
    expect(isValidLocalDate('2026-7-9')).toBe(false);
    expect(isValidLocalDate('2026-07-19T00:00:00Z')).toBe(false);
    expect(isValidLocalDate('')).toBe(false);
  });
});

describe('isValidLocalTime', () => {
  it('accepts 24-hour times', () => {
    expect(isValidLocalTime('00:00')).toBe(true);
    expect(isValidLocalTime('23:59')).toBe(true);
  });

  it('rejects out-of-range and malformed times', () => {
    expect(isValidLocalTime('24:00')).toBe(false);
    expect(isValidLocalTime('12:60')).toBe(false);
    expect(isValidLocalTime('9:05')).toBe(false);
  });
});

describe('todayLocalDate', () => {
  it('uses the local calendar day, not UTC', () => {
    // 2026-07-19 23:30 local. In any timezone ahead of UTC this instant is
    // still the 19th locally but already the 19th/20th boundary in UTC —
    // toISOString() would be wrong for a receipt printed at 11:30pm.
    const localLateEvening = new Date(2026, 6, 19, 23, 30, 0);
    expect(todayLocalDate(localLateEvening)).toBe('2026-07-19');
  });

  it('zero-pads month and day', () => {
    expect(todayLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('formatDate', () => {
  it('renders the stored calendar day, never shifted by a timezone', () => {
    // Formatted output varies by locale, but the day number must not move.
    expect(formatDate('2026-07-19')).toContain('19');
    expect(formatDate('2026-01-01')).toContain('1');
  });

  it('passes through anything that is not a date', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('monthOf', () => {
  it('extracts the grouping key', () => {
    expect(monthOf('2026-07-19')).toBe('2026-07');
  });
});

describe('addDays (§14.6 windows)', () => {
  it('walks forwards and backwards', () => {
    expect(addDays('2026-09-07', 3)).toBe('2026-09-10');
    expect(addDays('2026-09-07', -8)).toBe('2026-08-30');
  });

  it('crosses month, year and leap-day boundaries', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });

  it('is a no-op on something that is not a date', () => {
    expect(addDays('not-a-date' as never, 1)).toBe('not-a-date');
  });
});

describe('startOfWeek', () => {
  /**
   * Monday, to agree with SQLite's `strftime('%W')` — the grouping §14.6 uses
   * for a `week` dimension. A Sunday-start window would put a Sunday bill
   * inside the range but outside every bucket.
   */
  it('returns the Monday of the containing week', () => {
    expect(startOfWeek('2026-09-07')).toBe('2026-09-07'); // a Monday
    expect(startOfWeek('2026-09-13')).toBe('2026-09-07'); // the Sunday after
    expect(startOfWeek('2026-09-08')).toBe('2026-09-07');
  });

  it('crosses a month boundary backwards', () => {
    expect(startOfWeek('2026-09-02')).toBe('2026-08-31');
  });
});

describe('year edges', () => {
  it('bounds the calendar year', () => {
    expect(startOfYear('2026-09-07')).toBe('2026-01-01');
    expect(endOfYear('2026-09-07')).toBe('2026-12-31');
  });
});

describe('weekly periods', () => {
  it('bounds the week containing a date', () => {
    expect(endOfWeek('2026-09-07')).toBe('2026-09-13'); // Mon -> Sun
    expect(endOfWeek('2026-09-13')).toBe('2026-09-13');
  });

  /**
   * Whole calendar weeks including the current incomplete one, matching
   * `periodOfLastMonths`. Two conventions would put the same bill in two
   * different "this week"s depending on which screen asked.
   */
  it('covers whole weeks, current one included', () => {
    expect(periodOfLastWeeks(1, '2026-09-09')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(periodOfLastWeeks(4, '2026-09-09')).toEqual({ from: '2026-08-17', to: '2026-09-13' });
  });

  it('lists the Mondays oldest first', () => {
    expect(weekSequence('2026-09-09', 3)).toEqual(['2026-08-24', '2026-08-31', '2026-09-07']);
  });

  it('crosses a year boundary without resetting', () => {
    expect(weekSequence('2027-01-01', 2)).toEqual(['2026-12-21', '2026-12-28']);
  });

  /**
   * The month's spelling comes from the device locale via `Intl` (§7), so the
   * assertion is about shape — day, abbreviated month, no year — rather than
   * about one locale's abbreviation. Node renders September as "Sept" here.
   */
  it('formats a week label as a day and month, without the year', () => {
    const label = formatDayMonth('2026-09-07');
    expect(label).toMatch(/^7 [A-Za-z]{3,5}$/);
    expect(label).not.toContain('2026');
  });
});
