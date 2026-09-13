/**
 * The fastpath date-phrase parser (§6.6).
 *
 * `today` is fixed at **2026-09-14, a Monday**, chosen so week boundaries can
 * be asserted as literal dates. Recomputing the expected dates with the same
 * helpers the parser uses would pass even if both were wrong together.
 *
 * The rule this suite is really protecting: a phrase resolves to the same
 * window the Insights screen would use, because the parser delegates every
 * calculation to `@/data/dates` rather than doing its own arithmetic.
 */

import { parsePeriodPhrase } from '@/fastpath/datePhrase';
import type { LocalDate } from '@/types/ledger';

const TODAY = '2026-09-14' as LocalDate;

const periodOf = (question: string) => parsePeriodPhrase(question, TODAY)?.period;
const labelOf = (question: string) => parsePeriodPhrase(question, TODAY)?.label;

describe('whole calendar periods', () => {
  it('reads this month as the current calendar month', () => {
    expect(periodOf('how much did I spend this month?')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
  });

  /**
   * The case the agent's `time_range` cannot express at all: `{unit, last}`
   * only counts backwards from now, so "last month" and "this month" collapse
   * into the same window there. Here they must not.
   */
  it('reads last month as the previous calendar month, not a trailing window', () => {
    expect(periodOf('what did I spend last month?')).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('reads this year and last year as whole years', () => {
    expect(periodOf('total this year')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodOf('total last year')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });
});

describe('weeks, anchored on Monday', () => {
  it('reads this week from Monday to Sunday', () => {
    expect(periodOf('spend this week')).toEqual({ from: '2026-09-14', to: '2026-09-20' });
  });

  it('reads last week as the week before', () => {
    expect(periodOf('spend last week')).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });
});

describe('single days', () => {
  it('reads today as one day', () => {
    expect(periodOf('what did I spend today')).toEqual({ from: '2026-09-14', to: '2026-09-14' });
  });

  it('reads yesterday as the day before', () => {
    expect(periodOf('what did I spend yesterday')).toEqual({
      from: '2026-09-13',
      to: '2026-09-13',
    });
  });
});

describe('trailing windows', () => {
  it('counts months in digits or words alike', () => {
    expect(periodOf('spend over the last 3 months')).toEqual(periodOf('spend over the last three months'));
    expect(periodOf('spend over the last 3 months')).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
  });

  it('reads a run of days ending today', () => {
    expect(periodOf('spend in the last 7 days')).toEqual({
      from: '2026-09-08',
      to: '2026-09-14',
    });
  });

  /** "last 3 months" must not be swallowed by the "last month" rule. */
  it('prefers the counted form over the bare one', () => {
    expect(labelOf('the last 3 months')).toBe('the last 3 months');
    expect(periodOf('the last 3 months')).not.toEqual(periodOf('last month'));
  });
});

describe('named months', () => {
  it('reads a month earlier this year as this year', () => {
    expect(periodOf('how much in June?')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  /**
   * In September, "December" is the December that has happened, not the one
   * three months away — a question about the past should not be answered with
   * a confidently empty future.
   */
  it('reads a month later in the calendar as last year', () => {
    expect(periodOf('how much in December?')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('accepts an abbreviation', () => {
    expect(periodOf('how much in Jun?')).toEqual({ from: '2026-06-01', to: '2026-06-30' });
  });

  /**
   * Three month names are also ordinary English words. Matching them without
   * a preposition would answer about the wrong period rather than decline.
   */
  it('does not read "may" or "march" as months when used as verbs', () => {
    expect(parsePeriodPhrase('how much may I spend on groceries', TODAY)).toBeNull();
    expect(parsePeriodPhrase('how did march go', TODAY)).toBeNull();
  });

  it('still reads them when a preposition makes the month explicit', () => {
    expect(periodOf('how much in May')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });
});

describe('what is left of the question', () => {
  it('removes the phrase so a later matcher does not trip on it', () => {
    expect(parsePeriodPhrase('how much did I spend at Countdown last month?', TODAY)?.rest).toBe(
      'how much did i spend at countdown?'
    );
  });

  it('does not weld the words either side together', () => {
    expect(parsePeriodPhrase('spend this month on dairy', TODAY)?.rest).toBe('spend on dairy');
  });
});

describe('a question with no period in it', () => {
  /** Not a failure: "at the supermarket" is a fair question about all time. */
  it('returns null rather than inventing a window', () => {
    expect(parsePeriodPhrase('how much have I spent at the supermarket', TODAY)).toBeNull();
    expect(parsePeriodPhrase('which shop do I go to most', TODAY)).toBeNull();
  });
});
