/**
 * `time_range` → a concrete pair of calendar dates (§14.5, §14.6).
 *
 * §14.6 is explicit that the window is "computed app-side, never by the
 * model", so this is where that happens — before `compile.ts`, which then has
 * no date arithmetic in it at all and only binds two parameters.
 *
 * The two clamping rows of §14.5 both live here, and both *report themselves*.
 * That is the subtle half of the rule: clamping silently would let the model
 * claim it answered a question about three years when the ledger only holds
 * four months. The note goes back in the tool result so the answer can say so.
 *
 * Whole calendar periods, including the current incomplete one — "last 3
 * months" is three calendar months, not ninety days. That is already the
 * convention `periodOfLastMonths` set in Week 4, and a second convention here
 * would put the same bill in two different "last month"s depending on which
 * screen asked.
 */

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfYear,
  monthOf,
  startOfMonth,
  startOfWeek,
  startOfYear,
  type Period,
} from '@/data/dates';
import { MAX_TIME_LAST, MIN_TIME_LAST, type TimeUnit } from '@/agent/tools/queryLedger';
import type { LocalDate } from '@/types/ledger';

export interface ResolvedTimeRange {
  period: Period;
  /** Clamps that happened, phrased for the model to repeat to the user. */
  notes: string[];
}

export interface TimeRangeContext {
  /** "Today" as a calendar date. Passed in so tests are not time-dependent. */
  today: LocalDate;
  /** Earliest `purchased_at` in the ledger, or null when there are no bills. */
  firstBill: LocalDate | null;
}

function windowOf(unit: TimeUnit, last: number, today: LocalDate): Period {
  switch (unit) {
    case 'day':
      return { from: addDays(today, -(last - 1)), to: today };
    case 'week': {
      const thisWeek = startOfWeek(today);
      return { from: addDays(thisWeek, -7 * (last - 1)), to: addDays(thisWeek, 6) };
    }
    case 'month': {
      const thisMonth = monthOf(today);
      return {
        from: startOfMonth(addMonths(thisMonth, -(last - 1))),
        to: endOfMonth(thisMonth),
      };
    }
    case 'year': {
      const fromYear = Number(today.slice(0, 4)) - (last - 1);
      return {
        from: startOfYear(`${String(fromYear).padStart(4, '0')}-01-01`),
        to: endOfYear(today),
      };
    }
  }
}

const UNIT_PLURAL: Record<TimeUnit, string> = {
  day: 'days',
  week: 'weeks',
  month: 'months',
  year: 'years',
};

/**
 * Resolves and clamps, never rejects.
 *
 * §14.5 gives `time_range.last` the clamp treatment rather than the reject
 * treatment, which is the right call: a model asking for 60 months has made a
 * judgement about scope, not a malformed request, and answering 36 with a note
 * is more useful than refusing. `last` is assumed to already be an integer —
 * the schema walk in `validate.ts` rejects a fractional one before this runs,
 * because half a month is not a clampable quantity, it is a typo.
 */
export function resolveTimeRange(
  unit: TimeUnit,
  last: number,
  context: TimeRangeContext
): ResolvedTimeRange {
  const notes: string[] = [];

  let bounded = last;
  if (bounded > MAX_TIME_LAST) {
    bounded = MAX_TIME_LAST;
    notes.push(
      `Requested ${last} ${UNIT_PLURAL[unit]}; the longest range this tool accepts is ` +
        `${MAX_TIME_LAST} ${UNIT_PLURAL[unit]}, so the answer covers that instead.`
    );
  } else if (bounded < MIN_TIME_LAST) {
    bounded = MIN_TIME_LAST;
    notes.push(
      `Requested ${last} ${UNIT_PLURAL[unit]}, which is not a range; used 1 ${unit} instead.`
    );
  }

  const period = windowOf(unit, bounded, context.today);

  // §14.5: "Time range predates the first bill → clamp to available range; the
  // model must be told so it can say so." Without the note, a query over three
  // years of a four-month ledger reads as three years of near-zero spending.
  if (context.firstBill && period.from < context.firstBill) {
    notes.push(
      `The ledger starts on ${context.firstBill}, so the answer covers ` +
        `${context.firstBill} to ${period.to} rather than the full range asked for.`
    );
    return { period: { from: context.firstBill, to: period.to }, notes };
  }

  if (!context.firstBill) {
    notes.push('There are no bills recorded yet, so any range is empty.');
  }

  return { period, notes };
}
