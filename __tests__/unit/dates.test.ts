import { formatDate, isValidLocalDate, isValidLocalTime, monthOf, todayLocalDate } from '@/data/dates';

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
