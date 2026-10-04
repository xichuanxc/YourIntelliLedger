/**
 * Turning an answer's text into segments, some of which lead to a bill.
 *
 * The rule is that a link must be *earned*. The references come from rows the
 * tools actually returned (see `execute.ts`), never from the model, and a name
 * only becomes a link when the answer names it. Linking the wrong receipt is
 * the app asserting something false, so every rule below that refuses to link
 * is refusing on purpose.
 *
 * ## Leading words count as naming it
 *
 * Requiring the name *verbatim* cost too many links to be right. A till
 * prints `ORANGE KUMARA (MED)` and `Nice Milk Bottles 250g`; asked what the
 * produce cost, a model writes "Orange Kumara" and "Nice Milk Bottles", which
 * are the same products by any reading and matched neither. The links that
 * survived were the ones whose names happened to be a single tidy word, so an
 * answer came back half-linked for no reason a user could see.
 *
 * So a label is also keyed by its leading words, two or more at a time —
 * the same reasoning as the grocer search term, where the leading words are
 * the identifying ones and the tail is size and packaging. A single word is
 * never a prefix key: "Table" must not link every occurrence of the word to
 * whichever bill sold `Table Carrots`.
 *
 * Exact names still win. A prefix is only consulted for a form no label
 * spells out in full, so one product's abbreviation can never shadow another
 * product's actual name.
 *
 * Pure and node-testable, because the matching rules are where this goes wrong
 * quietly: an ambiguous name, a name inside another word, a name containing
 * regex punctuation.
 */

import type { BillReference } from '@/agent/execute';

export interface LinkSegment {
  text: string;
  /** Present when this run of text names a bill the answer drew on. */
  billId?: number;
}

/**
 * Below this, a name is more likely to collide than to inform — "1L", "kg",
 * "Ba" — and a wrong link costs more than a missing one.
 */
const MIN_LABEL_LENGTH = 3;

/**
 * A prefix shorter than this is a word a sentence might use for itself.
 * `Nice Milk` earns a link; `Nice` on its own does not.
 */
const MIN_PREFIX_LENGTH = 8;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word boundaries, but only where they mean something.
 *
 * `\b` is defined against ASCII word characters, so it does the right thing
 * for "milk" inside "buttermilk" and the *wrong* thing either side of 豆腐干,
 * where every position is a boundary and none of them is. So the guard is
 * applied per end, and only when that end of the label is a character `\b`
 * understands.
 */
function boundedPattern(label: string): string {
  const escaped = escapeRegExp(label);
  const left = /^[A-Za-z0-9_]/.test(label) ? '\\b' : '';
  const right = /[A-Za-z0-9_]$/.test(label) ? '\\b' : '';
  return `${left}${escaped}${right}`;
}

/**
 * The leading-word forms of a name, longest first, excluding the whole of it.
 *
 * Two words minimum, because one word is a word rather than a name, and long
 * enough to be distinctive. Words are the till's own: no size is stripped and
 * nothing is re-spelled, so every key here is a run of text the receipt
 * actually printed.
 */
function prefixesOf(label: string): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const keys: string[] = [];

  for (let count = words.length - 1; count >= 2; count -= 1) {
    const prefix = words.slice(0, count).join(' ');
    if (prefix.length >= MIN_PREFIX_LENGTH) keys.push(prefix);
  }

  return keys;
}

/**
 * One key, one bill — or no link at all.
 *
 * "Countdown" naming four different receipts is the common case, not an edge
 * one, and there is no honest way to choose between them. Dropping the label
 * leaves plain text, which is exactly as informative as the answer was before.
 */
function unambiguous(entries: readonly { key: string; billId: number }[]): Map<string, number> {
  const byKey = new Map<string, number>();
  const ambiguous = new Set<string>();

  for (const { key, billId } of entries) {
    if (key.length < MIN_LABEL_LENGTH) continue;
    const seen = byKey.get(key);
    if (seen === undefined) byKey.set(key, billId);
    else if (seen !== billId) ambiguous.add(key);
  }

  for (const key of ambiguous) byKey.delete(key);
  return byKey;
}

/**
 * Every form that may become a link, with the bill it belongs to.
 *
 * Built in two passes so that an exact name outranks any other product's
 * abbreviation: a prefix is kept only for a key no label spells out in full,
 * and each pass resolves its own ambiguity. `Carrots` therefore keeps the link
 * it has always had even once `Carrots Bag 1kg` is on another bill.
 */
function linkTargets(references: readonly BillReference[]): Map<string, number> {
  const exact = unambiguous(
    references.map(({ label, billId }) => ({ key: label.toLowerCase(), billId }))
  );

  const prefixes = unambiguous(
    references.flatMap(({ label, billId }) =>
      prefixesOf(label.toLowerCase()).map((key) => ({ key, billId }))
    )
  );

  for (const [key, billId] of prefixes) {
    if (!exact.has(key)) exact.set(key, billId);
  }

  return exact;
}

export function linkify(text: string, references: readonly BillReference[]): LinkSegment[] {
  const byLabel = linkTargets(references);
  if (byLabel.size === 0 || text === '') return [{ text }];

  // Longest first, so "milk 2l" wins over "milk" where both are present and
  // the more specific name is the one the user asked about.
  const labels = [...byLabel.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(labels.map(boundedPattern).join('|'), 'gi');

  const segments: LinkSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const billId = byLabel.get(match[0].toLowerCase());
    if (billId === undefined) continue;

    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    // The matched text, not the stored label: the answer's own capitalisation
    // is what the user is reading.
    segments.push({ text: match[0], billId });
    cursor = start + match[0].length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments.length > 0 ? segments : [{ text }];
}
