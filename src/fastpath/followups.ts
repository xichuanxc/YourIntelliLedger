/**
 * The next question, without asking a model (§6.7).
 *
 * A fastpath answers with no model in the loop, so there is nobody to propose
 * what to ask next — which left the *instant* answers, the common ones that
 * work offline, as the only ones with no followup chips. This fills that in
 * from the question that was just asked.
 *
 * ## The generator is validated by the matcher
 *
 * Every candidate below is round-tripped through `matchFastpath`, and any that
 * does not come back with an intent is discarded. That makes an unanswerable
 * suggestion structurally impossible rather than something to remember: a chip
 * can only be offered if the app can already answer it instantly, and a change
 * to the matcher that stops recognising a phrasing silently stops suggesting
 * it too.
 *
 * It also keeps this file honest about tense and wording. "What did I spend
 * the most on" reads fine and matches nothing — the pattern is present tense —
 * so the round trip would drop it. The candidates here are written in the
 * phrasings that actually match, and the filter is the proof.
 *
 * ## What it does not try to be
 *
 * A model that has just seen the numbers can suggest something no rule table
 * contains — "meat was up 40% on last month, want the breakdown?". These are
 * the other half of §6.7's followups, not a replacement: bounded, deterministic
 * and always available, where the model's are open-ended and sometimes absent.
 */

import { matchFastpath, type FastpathIntent } from '@/fastpath/match';
import type { LocalDate } from '@/types/ledger';
import { CATEGORY_LABELS } from '@/types/vocabulary';

/** Three fits across a phone; four starts to read as a menu. */
const MAX_FOLLOWUPS = 3;

/** Periods that have an obvious neighbour to offer. */
const NEIGHBOURING_PERIOD: Record<string, string> = {
  'this month': 'last month',
  'last month': 'this month',
  'this week': 'last week',
  'last week': 'this week',
  'this year': 'last year',
  'last year': 'this year',
  today: 'yesterday',
  yesterday: 'today',
};

/**
 * A period label as it belongs inside a question.
 *
 * The parser's labels are bare because they are also used for matching. A
 * month name needs its preposition back, or the matcher will not recognise
 * the question this file just wrote.
 */
function inWords(label: string): string {
  return /^[A-Z]/.test(label) ? `in ${label}` : label;
}

/** The period the question was about, phrased, or nothing for all-time. */
function periodWords(intent: FastpathIntent): string {
  return 'period' in intent && intent.period ? ` ${inWords(intent.period.label)}` : '';
}

function neighbourWords(intent: FastpathIntent): string | null {
  if (!('period' in intent) || !intent.period) return null;
  const neighbour = NEIGHBOURING_PERIOD[intent.period.label];
  return neighbour ? ` ${neighbour}` : null;
}

/** The two questions almost any answer can usefully lead to. */
const BREAKDOWNS = ['What do I spend the most on?', 'Which shop do I go to most?'];

/**
 * Candidate questions for an intent, most closely related first.
 *
 * Order matters more than length: the list is cut to three after filtering, so
 * whatever is most relevant has to be at the front.
 */
function candidatesFor(intent: FastpathIntent): string[] {
  const here = periodWords(intent);
  const next = neighbourWords(intent);

  switch (intent.kind) {
    case 'total':
    case 'bill_count':
      return [
        ...(next ? [`How much did I spend${next}?`] : []),
        ...BREAKDOWNS,
        'This month vs last month',
      ];

    case 'category_spend': {
      const name = CATEGORY_LABELS[intent.category].toLowerCase();
      return [
        ...(next ? [`How much did I spend on ${name}${next}?`] : []),
        `How much did I spend${here}?`,
        ...BREAKDOWNS,
      ];
    }

    case 'merchant_spend':
      return [
        ...(next ? [`How much did I spend at ${intent.term}${next}?`] : []),
        `How much did I spend${here}?`,
        'Which shop do I go to most?',
      ];

    case 'top_category':
      return [`How much did I spend${here}?`, 'Which shop do I go to most?', 'This month vs last month'];

    case 'top_merchant':
      return [`How much did I spend${here}?`, 'What do I spend the most on?', 'This month vs last month'];

    case 'month_vs_month':
      return [...BREAKDOWNS, 'Show me my last 5 bills'];

    case 'recent_bills':
      return ['How much did I spend this month?', ...BREAKDOWNS];
  }
}

/** Whether two intents ask the same thing, so the answer is not re-offered. */
function sameQuestion(a: FastpathIntent, b: FastpathIntent): boolean {
  if (a.kind !== b.kind) return false;

  const periodOf = (intent: FastpathIntent) =>
    'period' in intent && intent.period ? `${intent.period.period.from}:${intent.period.period.to}` : '';
  if (periodOf(a) !== periodOf(b)) return false;

  if (a.kind === 'category_spend' && b.kind === 'category_spend') return a.category === b.category;
  if (a.kind === 'merchant_spend' && b.kind === 'merchant_spend') return a.term === b.term;
  return true;
}

/**
 * Up to three questions worth asking after this one.
 *
 * Each is guaranteed to be answerable by a fastpath, and none of them repeats
 * the question just asked — offering the answer already on screen is the one
 * suggestion that is certainly useless.
 */
export function followupsFor(intent: FastpathIntent, today: LocalDate): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];

  for (const candidate of candidatesFor(intent)) {
    if (kept.length >= MAX_FOLLOWUPS) break;
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    // The round trip. A candidate the matcher does not claim would send the
    // user to the agent for a question this file promised was instant.
    const matched = matchFastpath(candidate, today);
    if (!matched) continue;
    if (sameQuestion(matched, intent)) continue;

    kept.push(candidate);
  }

  return kept;
}
