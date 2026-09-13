/**
 * "last month" → a pair of calendar dates (§6.6).
 *
 * The small date-phrase parser §6.6 asks for, and deliberately nothing more.
 * It recognises the way people actually write a period into a question and
 * hands back a `Period`; it does **no** date arithmetic of its own, delegating
 * every calculation to `@/data/dates`. That is the whole point: "this month"
 * has to mean the same thing in an Ask answer as it does on the Insights
 * screen, and two implementations of a month boundary is exactly how they
 * would drift apart.
 *
 * ## Why this returns a `Period` and not `{unit, last}`
 *
 * The agent's `time_range` (§14.1) can only say "the last N periods ending
 * now", so it cannot express "last month" as distinct from "this month" — and
 * §6.6 lists both. Fastpaths read through the repositories, which take a
 * concrete period, so the phrase resolves all the way here.
 *
 * `rest` is the question with the phrase removed, so a later matcher looking
 * for a merchant or a category does not have to step around the words that
 * have already been understood.
 */

import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  endOfYear,
  monthOf,
  periodOfLastMonths,
  periodOfLastWeeks,
  startOfMonth,
  startOfWeek,
  startOfYear,
  type Period,
} from '@/data/dates';
import type { LocalDate } from '@/types/ledger';

export interface PhrasePeriod {
  period: Period;
  /** How the answer should name it — the user's own framing, tidied. */
  label: string;
  /** The question with the recognised phrase taken out. */
  rest: string;
}

/**
 * Written-out counts, because "last three months" is at least as common as
 * "last 3 months" in a typed question. Stops at twelve: past that people
 * write digits, and §14.1 caps a range at 36 anyway.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const COUNT = String.raw`(\d{1,2}|${Object.keys(NUMBER_WORDS).join('|')})`;

function countOf(token: string): number {
  return NUMBER_WORDS[token] ?? Number(token);
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** Three letters is the shortest unambiguous form for every month. */
const MONTH_PATTERN = MONTH_NAMES.map((name) => `${name.slice(0, 3)}[a-z]*`).join('|');

function monthIndex(token: string): number {
  return MONTH_NAMES.findIndex((name) => name.startsWith(token.slice(0, 3)));
}

function yearOf(date: LocalDate): number {
  return Number(date.slice(0, 4));
}

/** A whole calendar month, named `YYYY-MM`. */
function wholeMonth(month: string): Period {
  return { from: startOfMonth(month), to: endOfMonth(month) };
}

interface Rule {
  pattern: RegExp;
  resolve: (match: RegExpMatchArray, today: LocalDate) => { period: Period; label: string };
}

/**
 * Order matters: the numeric forms come first so "last 3 months" is not
 * matched by the "last month" rule with the count left behind in `rest`.
 */
const RULES: Rule[] = [
  {
    pattern: new RegExp(String.raw`\blast\s+${COUNT}\s+months?\b`),
    resolve: (match, today) => ({
      period: periodOfLastMonths(countOf(match[1]), today),
      label: `the last ${countOf(match[1])} months`,
    }),
  },
  {
    pattern: new RegExp(String.raw`\blast\s+${COUNT}\s+weeks?\b`),
    resolve: (match, today) => ({
      period: periodOfLastWeeks(countOf(match[1]), today),
      label: `the last ${countOf(match[1])} weeks`,
    }),
  },
  {
    pattern: new RegExp(String.raw`\blast\s+${COUNT}\s+days?\b`),
    resolve: (match, today) => ({
      period: { from: addDays(today, -(countOf(match[1]) - 1)), to: today },
      label: `the last ${countOf(match[1])} days`,
    }),
  },
  {
    pattern: /\b(this|current)\s+month\b/,
    resolve: (_match, today) => ({ period: wholeMonth(monthOf(today)), label: 'this month' }),
  },
  {
    pattern: /\b(last|previous)\s+month\b/,
    resolve: (_match, today) => ({
      period: wholeMonth(addMonths(monthOf(today), -1)),
      label: 'last month',
    }),
  },
  {
    pattern: /\b(this|current)\s+week\b/,
    resolve: (_match, today) => ({
      period: { from: startOfWeek(today), to: endOfWeek(today) },
      label: 'this week',
    }),
  },
  {
    pattern: /\b(last|previous)\s+week\b/,
    resolve: (_match, today) => {
      const from = addDays(startOfWeek(today), -7);
      return { period: { from, to: addDays(from, 6) }, label: 'last week' };
    },
  },
  {
    pattern: /\b(this|current)\s+year\b/,
    resolve: (_match, today) => ({
      period: { from: startOfYear(today), to: endOfYear(today) },
      label: 'this year',
    }),
  },
  {
    pattern: /\b(last|previous)\s+year\b/,
    resolve: (_match, today) => {
      const january = `${String(yearOf(today) - 1).padStart(4, '0')}-01-01`;
      return { period: { from: startOfYear(january), to: endOfYear(january) }, label: 'last year' };
    },
  },
  {
    pattern: /\byesterday\b/,
    resolve: (_match, today) => {
      const day = addDays(today, -1);
      return { period: { from: day, to: day }, label: 'yesterday' };
    },
  },
  {
    pattern: /\btoday\b/,
    resolve: (_match, today) => ({ period: { from: today, to: today }, label: 'today' }),
  },
  {
    /**
     * "in June", "during June" — the preposition is **required**.
     *
     * A bare month name reads well in a question but three of them are also
     * ordinary English words: "how much may I spend", "how did march go".
     * Matching those would answer confidently about the wrong period, which
     * is worse than not matching "how much did I spend June" at all.
     */
    pattern: new RegExp(String.raw`\b(?:in|during|for)\s+(${MONTH_PATTERN})\b`),
    resolve: (match, today) => {
      const index = monthIndex(match[1]);
      // A month later in the calendar than today means the one that has
      // already happened: in February, "December" is two months ago, not ten
      // months away. Answering about a month with no bills in it yet would be
      // a confidently empty answer to a question about the past.
      const year = index > Number(monthOf(today).slice(5, 7)) - 1 ? yearOf(today) - 1 : yearOf(today);
      const month = `${String(year).padStart(4, '0')}-${String(index + 1).padStart(2, '0')}`;
      return { period: wholeMonth(month), label: MONTH_NAMES[index].replace(/^./, (c) => c.toUpperCase()) };
    },
  },
];

/**
 * Finds a period in a question, or returns null when it names none.
 *
 * Null is not a failure: "how much have I spent at the supermarket" is a
 * perfectly good question about all time, and the caller decides what the
 * absence of a phrase should mean for that pattern.
 */
export function parsePeriodPhrase(question: string, today: LocalDate): PhrasePeriod | null {
  const text = question.toLowerCase();

  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;

    const { period, label } = rule.resolve(match, today);
    return {
      period,
      label,
      // A space, not an empty string: removing the phrase must not weld the
      // words either side of it into one.
      rest: (text.slice(0, match.index) + ' ' + text.slice(match.index! + match[0].length))
        .replace(/\s+/g, ' ')
        // The space that replaced the phrase must not be left stranded in
        // front of the question mark: `rest` is fed to the merchant and
        // category matchers, and orphaned punctuation spacing is noise there.
        .replace(/\s+([?.!,])/g, '$1')
        .trim(),
    };
  }

  return null;
}
