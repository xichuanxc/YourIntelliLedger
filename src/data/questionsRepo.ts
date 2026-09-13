/**
 * The questions this user keeps asking (§6, Week 8).
 *
 * Suggestions are only useful if they are *this person's* questions. Static
 * examples are a guess at what a stranger wants; "how much on nappies" is not
 * something the app could have invented.
 *
 * ## What this deliberately is not
 *
 * It is not telemetry. §15.3 keeps `query_log` free of question text — "it is
 * diagnostic, not a transcript" — and that promise is not worth eroding for
 * one fewer table. This is the user's own words, kept locally to serve them:
 * never sent to the hub, never included in the data catalog the model sees
 * (§6.3 sends categories, merchants and a date range — not questions), capped
 * so it cannot grow without bound, and cleared by delete-all (§15.2).
 */

import { nowUtc } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';

/**
 * Short enough to be a greeting rather than a question. "hi" and "thanks" are
 * not worth offering back, and a one-word entry crowds out a real one.
 */
const MIN_LENGTH = 8;

/**
 * How many distinct questions to keep at all.
 *
 * Unbounded question text is both a storage and a privacy problem: the longer
 * the tail, the more it resembles the transcript §15.3 refuses to keep. The
 * cap prunes by usefulness — count first, then recency — so a question asked
 * often survives a burst of one-off phrasings.
 */
const KEEP = 100;

export interface FrequentQuestion {
  /** The most recent spelling the user typed. */
  text: string;
  askedCount: number;
}

/**
 * The grouping key: what makes two phrasings the same question.
 *
 * Case and spacing are noise here, and so is the trailing question mark — a
 * suggestion list showing "how much did I spend" beside "How much did I
 * spend?" looks broken. Nothing else is touched: word order and wording are
 * the question.
 */
export function normaliseQuestion(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.\s]+$/, '');
}

/**
 * Records that a question was asked and answered.
 *
 * Only answered ones reach here — see the caller. Suggesting a question the
 * app could not answer would be offering a known disappointment.
 */
export async function recordQuestion(db: SqlDriver, text: string): Promise<void> {
  const normalised = normaliseQuestion(text);
  if (normalised.length < MIN_LENGTH) return;

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO asked_questions (normalised, display, asked_count, last_asked_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(normalised) DO UPDATE SET
         asked_count = asked_count + 1,
         display = excluded.display,
         last_asked_at = excluded.last_asked_at`,
      [normalised, text.trim().replace(/\s+/g, ' '), nowUtc()]
    );

    // Prune by usefulness, not age: a question asked twenty times last month
    // should outlive twenty phrasings tried once each this morning.
    await tx.run(
      `DELETE FROM asked_questions
        WHERE normalised NOT IN (
          SELECT normalised FROM asked_questions
           ORDER BY asked_count DESC, last_asked_at DESC
           LIMIT ?
        )`,
      [KEEP]
    );
  });
}

/**
 * The most-asked questions, most frequent first.
 *
 * Ties break on recency, so of two questions asked once each the user sees the
 * one still on their mind.
 */
export async function getFrequentQuestions(
  db: SqlDriver,
  limit: number
): Promise<FrequentQuestion[]> {
  const rows = await db.all<{ display: string; asked_count: number }>(
    `SELECT display, asked_count
       FROM asked_questions
      ORDER BY asked_count DESC, last_asked_at DESC
      LIMIT ?`,
    [limit]
  );

  return rows.map((row) => ({ text: row.display, askedCount: row.asked_count }));
}

/** §15.2: delete-all means the questions too, not just the bills. */
export async function clearQuestions(db: SqlDriver): Promise<void> {
  await db.run('DELETE FROM asked_questions');
}
