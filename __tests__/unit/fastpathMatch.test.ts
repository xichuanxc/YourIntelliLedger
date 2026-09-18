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
   * "Groceries" means the whole shop to most people, so it maps to no
   * category — and it must not quietly become the *total* either. Answering
   * "how much on groceries" with everything spent is right often enough to be
   * dangerous and wrong whenever the ledger holds anything else.
   */
  it('declines "groceries" rather than inventing a category or a total', () => {
    expect(match('how much did I spend on groceries last month')).toBeNull();
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
  it('declines a generic place instead of totalling everything', () => {
    expect(match('how much did I spend at the supermarket')).toBeNull();
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

/**
 * The reported bug, and the class it belongs to.
 *
 * "How much did I cost on milk last month" understood the period, found a
 * spending word, recognised neither a category nor a shop — and then the fall
 * through claimed it as a plain total, answering with everything spent last
 * month. The number was right and the question was not, which is
 * indistinguishable to the person reading it.
 */
describe('a question about something it does not recognise', () => {
  /**
   * The general case, not a list of phrasings anyone thought of. A fastpath
   * claims a question only when every word in it is either stock phrasing or
   * something the matched pattern consumed, so an unknown object declines
   * whatever sentence it arrives in.
   */
  it.each([
    'please show me how much did I cost on milk last month',
    'how much did I spend on milk',
    'what did I spend on nappies this month',
    'how much money did I spend on coffee',
    'what was my total for petrol last month',
    'how much have I paid for the dog so far',
    'tell me what I spent on birthday presents',
    'how much did I spend on wine and cheese',
    'what did I spend at the dairy on Tuesday',
    'how much on bread this week',
    'could you show me my spending on cleaning products',
    'what have I paid for rent',
  ])('declines: %s', (question) => {
    expect(match(question)).toBeNull();
  });

  /** Two categories is not one category, and half an answer is worse than none. */
  it('declines a question naming more than one category', () => {
    expect(match('how much did I spend on dairy and meat last month')).toBeNull();
  });

  /**
   * The other half of the rule: ordinary ways of asking for the total must
   * still be instant. A vocabulary that declined these would have traded one
   * failure for a feature that never fires.
   */
  it.each([
    'please show me how much did I cost in last month',
    'how much did I spend last month',
    'how much have I spent in total',
    'what did I spend this week',
    'how much money did I spend last month',
    'total this month',
    'what was my spending last month',
    'how much did it all cost last month',
    'show me how much I spent altogether',
  ])('still claims the total: %s', (question) => {
    expect(match(question)).toMatchObject({ kind: 'total' });
  });

  /** A recognised object still goes down its own path, not to the agent. */
  it('leaves the categories and shops it does understand alone', () => {
    expect(match('how much did I spend on dairy last month')).toMatchObject({
      kind: 'category_spend',
    });
    expect(match('how much did I spend at Countdown last month')).toMatchObject({
      kind: 'merchant_spend',
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
