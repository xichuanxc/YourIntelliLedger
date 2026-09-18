/**
 * Suggesting the next question without a model (§6.7).
 *
 * The property that matters is not which suggestions appear but that **every**
 * suggestion is answerable: a chip is a promise that tapping it produces an
 * answer, and one that falls through to the agent breaks the promise the
 * instant it is tapped. That is asserted over every intent rather than
 * case by case, so a change to the matcher cannot quietly strand a phrasing
 * this file still emits.
 */

import { followupsFor } from '@/fastpath/followups';
import { matchFastpath, type FastpathIntent } from '@/fastpath/match';
import { parsePeriodPhrase } from '@/fastpath/datePhrase';
import type { LocalDate } from '@/types/ledger';

const TODAY = '2026-09-14' as LocalDate;

const period = (phrase: string) => parsePeriodPhrase(phrase, TODAY);
const suggest = (intent: FastpathIntent) => followupsFor(intent, TODAY);

/** One of each kind, so the property below is checked across all of them. */
const EVERY_KIND: FastpathIntent[] = [
  { kind: 'total', period: period('this month') },
  { kind: 'total', period: null },
  { kind: 'bill_count', period: period('last month') },
  { kind: 'category_spend', category: 'dairy', period: period('this month') },
  { kind: 'category_spend', category: 'pantry_staple', period: null },
  { kind: 'merchant_spend', term: 'countdown', period: period('last month') },
  { kind: 'top_category', period: period('this year') },
  { kind: 'top_merchant', period: period('this month') },
  { kind: 'month_vs_month' },
  { kind: 'recent_bills', count: 5 },
];

describe('every suggestion is answerable', () => {
  /** The promise a chip makes. Checked over all of them, not a sample. */
  it.each(EVERY_KIND.map((intent) => [intent.kind, intent] as const))(
    'after a %s question, each suggestion matches a fastpath',
    (_kind, intent) => {
      const suggestions = suggest(intent);
      expect(suggestions.length).toBeGreaterThan(0);

      for (const suggestion of suggestions) {
        expect(matchFastpath(suggestion, TODAY)).not.toBeNull();
      }
    }
  );

  it('never offers more than three', () => {
    for (const intent of EVERY_KIND) {
      expect(suggest(intent).length).toBeLessThanOrEqual(3);
    }
  });

  it('never repeats itself', () => {
    for (const intent of EVERY_KIND) {
      const suggestions = suggest(intent);
      expect(new Set(suggestions).size).toBe(suggestions.length);
    }
  });
});

describe('not the question just asked', () => {
  /** The one suggestion guaranteed useless: the answer already on screen. */
  it('does not offer the same period back to a total', () => {
    const asked: FastpathIntent = { kind: 'total', period: period('this month') };

    for (const suggestion of suggest(asked)) {
      const matched = matchFastpath(suggestion, TODAY);
      const sameTotal =
        matched?.kind === 'total' &&
        matched.period?.period.from === asked.period?.period.from;
      expect(sameTotal).toBe(false);
    }
  });

  it('does not offer the same category and period back', () => {
    const asked: FastpathIntent = {
      kind: 'category_spend',
      category: 'dairy',
      period: period('this month'),
    };

    for (const suggestion of suggest(asked)) {
      const matched = matchFastpath(suggestion, TODAY);
      const sameCategory =
        matched?.kind === 'category_spend' &&
        matched.category === 'dairy' &&
        matched.period?.period.from === asked.period?.period.from;
      expect(sameCategory).toBe(false);
    }
  });
});

describe('what it offers', () => {
  it('offers the neighbouring period after a total', () => {
    const suggestions = suggest({ kind: 'total', period: period('this month') });
    expect(suggestions[0]).toMatch(/last month/i);
  });

  it('keeps the category and moves the period', () => {
    const suggestions = suggest({
      kind: 'category_spend',
      category: 'dairy',
      period: period('this month'),
    });

    expect(suggestions[0]).toMatch(/dairy/i);
    expect(suggestions[0]).toMatch(/last month/i);
  });

  it('keeps the shop and moves the period', () => {
    const suggestions = suggest({
      kind: 'merchant_spend',
      term: 'countdown',
      period: period('last month'),
    });

    expect(suggestions[0]).toMatch(/countdown/i);
    expect(suggestions[0]).toMatch(/this month/i);
  });

  /** No neighbour for an open-ended question, so it goes straight to breakdowns. */
  it('falls back to breakdowns when a period has no obvious neighbour', () => {
    const suggestions = suggest({ kind: 'total', period: null });
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.some((suggestion) => /most/i.test(suggestion))).toBe(true);
  });
});
