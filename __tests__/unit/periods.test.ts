import {
  addMonths,
  endOfMonth,
  monthSequence,
  periodOfLastMonths,
  startOfMonth,
} from '@/data/dates';

describe('addMonths', () => {
  it('moves forwards and backwards within a year', () => {
    expect(addMonths('2026-07', 1)).toBe('2026-08');
    expect(addMonths('2026-07', -2)).toBe('2026-05');
    expect(addMonths('2026-07', 0)).toBe('2026-07');
  });

  it('crosses year boundaries in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', -13)).toBe('2024-12');
    expect(addMonths('2026-06', 18)).toBe('2027-12');
  });

  it('does not shift the day, because a month key has no day', () => {
    // `new Date('2026-03-31')` minus a month is 3 March in most implementations;
    // integer month arithmetic avoids that entirely.
    expect(addMonths('2026-03', -1)).toBe('2026-02');
  });
});

describe('startOfMonth / endOfMonth', () => {
  it('brackets a 31-day month', () => {
    expect(startOfMonth('2026-07')).toBe('2026-07-01');
    expect(endOfMonth('2026-07')).toBe('2026-07-31');
  });

  it('brackets a 30-day month', () => {
    expect(endOfMonth('2026-06')).toBe('2026-06-30');
  });

  it('handles February in both common and leap years', () => {
    expect(endOfMonth('2026-02')).toBe('2026-02-28');
    expect(endOfMonth('2024-02')).toBe('2024-02-29');
  });
});

describe('monthSequence', () => {
  it('returns the months ending at the given one, oldest first', () => {
    expect(monthSequence('2026-07', 3)).toEqual(['2026-05', '2026-06', '2026-07']);
  });

  it('spans a year boundary', () => {
    expect(monthSequence('2026-01', 3)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('returns just the month itself for a count of 1', () => {
    expect(monthSequence('2026-07', 1)).toEqual(['2026-07']);
  });
});

describe('periodOfLastMonths', () => {
  it('covers whole calendar months, not a rolling window of days', () => {
    // "Last 3 months" from mid-July is 1 May to 31 July, not 90 days back.
    expect(periodOfLastMonths(3, '2026-07-15')).toEqual({
      from: '2026-05-01',
      to: '2026-07-31',
    });
  });

  it('covers the current month for a count of 1', () => {
    expect(periodOfLastMonths(1, '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('spans a year boundary', () => {
    expect(periodOfLastMonths(3, '2026-01-20')).toEqual({
      from: '2025-11-01',
      to: '2026-01-31',
    });
  });
});
