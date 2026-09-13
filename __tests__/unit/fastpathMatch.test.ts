/**
 * Which questions a fastpath will claim (§6.6).
 *
 * The asymmetry this suite exists to protect: failing to match costs a model
 * call and a correct answer arrives anyway; matching *wrongly* produces a
 * confident wrong answer in forty milliseconds that the user cannot tell from
 * a right one. So the "declines" blocks matter more than the "matches" ones.
 */

import { matchFastpath } from '@/fastpath/match';
import type { LocalDate } from '@/types/ledger';

const TODAY = '2026-09-14' as LocalDate;
const match = (question: string) => matchFastpath(question, TODAY);

describe('spending totals', () => {
  it('claims a plain total, with the period it names', () => {
    const intent = match('how much did I spend last month?');
    expect(intent).toMatchObject({ kind: 'total' });
    expect(intent?.kind === 'total' && intent.period?.period).toEqual({
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('claims a total with no period at all', () => {
    expect(match('how much have I spent in total')).toMatchObject({
      kind: 'total',
      period: null,
    });
  });
});

describe('categories', () => {
  it('claims a category named in the closed vocabulary', () => {
    expect(match('how much did I spend on dairy this month')).toMatchObject({
      kind: 'category_spend',
      category: 'dairy',
    });
  });

  it('accepts a label and an unambiguous synonym', () => {
    expect(match('what did I spend on pantry staple')).toMatchObject({ category: 'pantry_staple' });
    expect(match('what did I spend on drinks')).toMatchObject({ category: 'beverage' });
    expect(match('what did I spend on fruit')).toMatchObject({ category: 'produce' });
  });

  /**
   * "Groceries" means the whole shop to most people. Mapping it to a category
   * would answer a different question than the one asked.
   */
  it('does not invent a category for "groceries"', () => {
    expect(match('how much did I spend on groceries last month')).toMatchObject({ kind: 'total' });
  });
});

describe('merchants', () => {
  it('claims a named shop', () => {
    expect(match('how much did I spend at Countdown last month')).toMatchObject({
      kind: 'merchant_spend',
      term: 'countdown',
    });
  });

  it('takes a multi-word name', () => {
    expect(match('how much have I spent at new world')).toMatchObject({ term: 'new world' });
  });

  /** "the supermarket" names no shop; the agent can ask which one. */
  it('declines a generic place', () => {
    expect(match('how much did I spend at the supermarket')).toMatchObject({ kind: 'total' });
  });
});

describe('lists and counts', () => {
  it('claims recent bills, with a count when given', () => {
    expect(match('show me my last 3 bills')).toEqual({ kind: 'recent_bills', count: 3 });
    expect(match('my last three receipts')).toEqual({ kind: 'recent_bills', count: 3 });
  });

  it('defaults the count when the question does not say', () => {
    expect(match('show me my recent bills')).toEqual({ kind: 'recent_bills', count: 5 });
  });

  it('caps an unreasonable count rather than declining', () => {
    expect(match('show me my last 90 bills')).toMatchObject({ count: 20 });
  });

  it('claims a bill count', () => {
    expect(match('how many bills this month?')).toMatchObject({ kind: 'bill_count' });
  });
});

describe('superlatives it can serve', () => {
  it('claims the biggest category', () => {
    expect(match('what do I spend the most on?')).toMatchObject({ kind: 'top_category' });
    expect(match('which category is biggest this year')).toMatchObject({ kind: 'top_category' });
  });

  it('claims the most-used shop', () => {
    expect(match('which shop do I go to most?')).toMatchObject({ kind: 'top_merchant' });
    expect(match('where do I spend most')).toMatchObject({ kind: 'top_merchant' });
  });
});

describe('month against month', () => {
  /** Two period phrases in one question: stripping either destroys it. */
  it('claims the comparison before the period parser touches it', () => {
    expect(match('this month vs last month')).toEqual({ kind: 'month_vs_month' });
    expect(match('how does this month compare to last month?')).toEqual({
      kind: 'month_vs_month',
    });
  });
});

describe('what it refuses', () => {
  /**
   * Each of these has a correct answer the agent can give. Matching them on
   * the words they share with a pattern above would answer a different
   * question — the failure mode this whole module is arranged against.
   */
  it.each([
    ['the cheapest rice I have bought', 'a per-item comparison, not a total'],
    ['how much per litre is the milk', 'a unit price'],
    ['what is my average spend per month', 'an average, not a sum'],
    ['why did I spend so much last month', 'asks for a reason'],
    ['show me the spending trend', 'a trend'],
    ['delete my last bill', 'a write'],
    ['what should I budget for groceries', 'advice'],
  ])('declines %s (%s)', (question) => {
    expect(match(question)).toBeNull();
  });

  it('declines something that is not a question about spending', () => {
    expect(match('hello')).toBeNull();
    expect(match('dairy')).toBeNull();
    expect(match('')).toBeNull();
  });
});
