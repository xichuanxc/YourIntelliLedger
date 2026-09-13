/**
 * Question → intent, for the §6.6 fastpaths.
 *
 * ## Declining beats guessing
 *
 * The rule that shapes every pattern below. A question this file *fails* to
 * match costs a model call and a few seconds and still gets a correct answer.
 * A question it matches **wrongly** produces a confident wrong answer in forty
 * milliseconds, and the user has no way to tell the difference. The two
 * mistakes are not symmetrical, so the patterns stay narrow, the vocabulary
 * stays closed, and anything with a construct fastpaths cannot honour is
 * handed to the agent untouched.
 *
 * That is also why there is no free-text item matching here. "How much on
 * milk" is a question about a line item, and answering it from a *category*
 * would be wrong in a way that looks right.
 */

import { parsePeriodPhrase, COUNT_PATTERN, parseCount, type PhrasePeriod } from '@/fastpath/datePhrase';
import type { LocalDate } from '@/types/ledger';
import { CATEGORIES, CATEGORY_LABELS, type Category } from '@/types/vocabulary';

export type FastpathIntent =
  /** Everything spent in a period — bill grain, so itemless bills count. */
  | { kind: 'total'; period: PhrasePeriod | null }
  | { kind: 'category_spend'; category: Category; period: PhrasePeriod | null }
  /** `term` is matched against the ledger's merchants by the answerer. */
  | { kind: 'merchant_spend'; term: string; period: PhrasePeriod | null }
  | { kind: 'recent_bills'; count: number }
  | { kind: 'month_vs_month' }
  | { kind: 'bill_count'; period: PhrasePeriod | null }
  | { kind: 'top_category'; period: PhrasePeriod | null }
  | { kind: 'top_merchant'; period: PhrasePeriod | null };

/**
 * Constructs a fastpath cannot answer honestly.
 *
 * Checked first, against the whole question, because several of these read
 * like a pattern below once their qualifier is ignored: "average spend last
 * month" is not the total, and "cheapest milk" is not a category spend. Each
 * one has a correct answer available from the agent, so declining loses
 * nothing but a moment.
 */
const CANNOT_ANSWER =
  /\b(cheap(est)?|dearest|most expensive|expensive|per\s*(kg|kilo|litre|liter|l|ml|g|100\s*g)|unit price|value for money|average|mean|median|why|reason|trend|forecast|predict|budget|should|recommend|compare(d)?\s+to\s+(?!last month)|receipt (image|photo)|delete|change|edit|update)\b/;

/** Words that make a question about spending rather than about something else. */
const SPENDING = /\b(spend|spent|spending|cost|costs|total|paid|pay)\b/;

/**
 * Category words the closed vocabulary (§4.7) can actually serve.
 *
 * Only the category names, their UI labels, and a small set of unambiguous
 * synonyms. "Groceries" is deliberately absent: it means the whole shop to
 * most people, and mapping it to any one category would answer a different
 * question than the one asked.
 */
function categoryVocabulary(): Map<string, Category> {
  const words = new Map<string, Category>();
  for (const category of CATEGORIES) {
    words.set(category.replace(/_/g, ' '), category);
    words.set(CATEGORY_LABELS[category].toLowerCase(), category);
  }
  words.set('drinks', 'beverage');
  words.set('beverages', 'beverage');
  words.set('vegetables', 'produce');
  words.set('veges', 'produce');
  words.set('veggies', 'produce');
  words.set('fruit', 'produce');
  words.set('cleaning', 'household');
  words.set('pantry', 'pantry_staple');
  return words;
}

const CATEGORY_WORDS = categoryVocabulary();

function findCategory(text: string): Category | null {
  for (const [word, category] of CATEGORY_WORDS) {
    if (new RegExp(String.raw`\b${word}\b`).test(text)) return category;
  }
  return null;
}

/** "this month vs last month", in the several ways people write it. */
const MONTH_VS_MONTH =
  /\bthis month\b[^.?!]*\b(vs|versus|compared? (to|with)|against)\b[^.?!]*\blast month\b|\blast month\b[^.?!]*\b(vs|versus|compared? (to|with)|against)\b[^.?!]*\bthis month\b/;

const RECENT_BILLS = new RegExp(
  String.raw`\b(?:last|latest|recent|most recent)\s+(?:${COUNT_PATTERN}\s+)?(?:bills?|receipts?|purchases?|shops?)\b`
);

const BILL_COUNT = /\bhow many\s+(bills?|receipts?|shops?|times)\b/;

/**
 * Built from parts and matched in **both word orders**: English puts the
 * superlative either side of the noun — "biggest category" and "which
 * category is biggest" are the same question, and only accepting the first
 * would decline the more natural phrasing of the two.
 */
const SUPERLATIVE = String.raw`(?:biggest|largest|top|most|highest)`;
const CATEGORY_NOUN = String.raw`categor(?:y|ies)`;

const TOP_CATEGORY = new RegExp(
  [
    String.raw`\b${SUPERLATIVE}\b[^.?!]*\b${CATEGORY_NOUN}\b`,
    String.raw`\b${CATEGORY_NOUN}\b[^.?!]*\b${SUPERLATIVE}\b`,
    String.raw`\bwhat do i spend (?:the )?most on\b`,
    String.raw`\bwhere does (?:my|the) money go\b`,
  ].join('|')
);

const TOP_MERCHANT =
  /\b(which|what)\s+(shop|store|supermarket|merchant)\b|\bwhere do i (shop|spend) (the )?most\b|\b(biggest|top|most visited)\s+(shop|store|merchant)\b/;

/** "at Countdown", "from New World" — everything to the end of the clause. */
const MERCHANT_AT = /\b(?:at|from)\s+([a-z0-9''&.\- ]{2,40})$/;

/** How many recent bills to show when the question does not say. */
const DEFAULT_RECENT = 5;
/** More than this is a list nobody reads, and §14.1 caps the agent at 50. */
const MAX_RECENT = 20;

/**
 * Matches a question, or returns null to let the agent answer it.
 *
 * `today` is passed in rather than read, so the patterns are testable without
 * a clock — the same arrangement `validate.ts` uses.
 */
export function matchFastpath(question: string, today: LocalDate): FastpathIntent | null {
  const text = question.toLowerCase().replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if (CANNOT_ANSWER.test(text)) return null;

  // Before the period phrase is stripped: this one *is* two period phrases,
  // and removing either destroys the comparison.
  if (MONTH_VS_MONTH.test(text)) return { kind: 'month_vs_month' };

  // "last 3 bills" must not have "last 3" read as a date phrase, so the list
  // patterns are tried before the period is taken out.
  const recent = text.match(RECENT_BILLS);
  if (recent) {
    const asked = recent[1] ? parseCount(recent[1]) : DEFAULT_RECENT;
    return { kind: 'recent_bills', count: Math.min(Math.max(asked, 1), MAX_RECENT) };
  }

  const phrase = parsePeriodPhrase(text, today);
  const rest = phrase ? phrase.rest : text;

  if (BILL_COUNT.test(rest)) return { kind: 'bill_count', period: phrase };
  if (TOP_CATEGORY.test(rest)) return { kind: 'top_category', period: phrase };
  if (TOP_MERCHANT.test(rest)) return { kind: 'top_merchant', period: phrase };

  // Everything below is a spending question, and must say so. Without this a
  // bare "dairy" or "at Countdown" would match, and neither is a question.
  if (!SPENDING.test(rest)) return null;

  const category = findCategory(rest);
  if (category) return { kind: 'category_spend', category, period: phrase };

  const merchant = rest.replace(/[?.!]+$/, '').match(MERCHANT_AT);
  if (merchant) {
    const term = merchant[1].trim();
    // "at the supermarket" and "at the shops" name no merchant. Left to the
    // agent, which can ask what was meant.
    if (!/^(the\s+)?(shops?|supermarkets?|stores?|places?)$/.test(term)) {
      return { kind: 'merchant_spend', term, period: phrase };
    }
  }

  return { kind: 'total', period: phrase };
}
