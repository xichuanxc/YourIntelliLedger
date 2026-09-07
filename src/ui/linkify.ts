/**
 * Turning an answer's text into segments, some of which lead to a bill.
 *
 * The rule is that a link must be *earned*. The references come from rows the
 * tools actually returned (see `execute.ts`), never from the model, and a name
 * only becomes a link when it appears in the answer verbatim. That means some
 * links are missed — the model writes "milk" where the item is "milk 2l" — and
 * missing a link is a small loss, while linking "milk" to the wrong receipt is
 * the app asserting something false.
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
 * One label, one bill — or no link at all.
 *
 * "Countdown" naming four different receipts is the common case, not an edge
 * one, and there is no honest way to choose between them. Dropping the label
 * leaves plain text, which is exactly as informative as the answer was before.
 */
function unambiguous(references: readonly BillReference[]): Map<string, number> {
  const byLabel = new Map<string, number>();
  const ambiguous = new Set<string>();

  for (const { label, billId } of references) {
    if (label.length < MIN_LABEL_LENGTH) continue;
    const key = label.toLowerCase();
    const seen = byLabel.get(key);
    if (seen === undefined) byLabel.set(key, billId);
    else if (seen !== billId) ambiguous.add(key);
  }

  for (const key of ambiguous) byLabel.delete(key);
  return byLabel;
}

export function linkify(text: string, references: readonly BillReference[]): LinkSegment[] {
  const byLabel = unambiguous(references);
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
