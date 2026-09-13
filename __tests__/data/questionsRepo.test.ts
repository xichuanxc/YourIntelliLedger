/**
 * Remembering what this user asks (§6, Week 8).
 *
 * The behaviour worth pinning is what counts as "the same question", what
 * never gets remembered at all, and that delete-all really deletes — §15.2
 * promises it, and a wipe that leaves a record of what someone asked is a
 * privacy failure they cannot see.
 */

import { openTestDriver } from '../support/sqlite-driver';

import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';
import {
  clearQuestions,
  getFrequentQuestions,
  normaliseQuestion,
  recordQuestion,
} from '@/data/questionsRepo';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

/** Explicit timestamps: two `nowUtc()` calls in one test share a millisecond. */
async function seed(question: string, count: number, askedAt: string) {
  await db.run(
    'INSERT INTO asked_questions (normalised, display, asked_count, last_asked_at) VALUES (?,?,?,?)',
    [normaliseQuestion(question), question, count, askedAt]
  );
}

describe('what counts as the same question', () => {
  it.each([
    ['How much did I spend?', 'how much did i spend'],
    ['  how   much  did I spend  ', 'how much did i spend'],
    ['how much did I spend!!!', 'how much did i spend'],
    ['How much did I spend.', 'how much did i spend'],
  ])('normalises %s', (input, expected) => {
    expect(normaliseQuestion(input)).toBe(expected);
  });

  /** Word order and wording *are* the question; only noise is stripped. */
  it('keeps two genuinely different questions apart', () => {
    expect(normaliseQuestion('what did I spend on milk')).not.toBe(
      normaliseQuestion('what did I spend on bread')
    );
  });

  it('counts one entry for phrasings that differ only in noise', async () => {
    await recordQuestion(db, 'How much did I spend?');
    await recordQuestion(db, 'how much did i spend');

    const questions = await getFrequentQuestions(db, 10);
    expect(questions).toHaveLength(1);
    expect(questions[0].askedCount).toBe(2);
  });

  /** The newest spelling wins: it is what the user last chose to type. */
  it('shows the most recent spelling', async () => {
    await recordQuestion(db, 'how much did i spend');
    await recordQuestion(db, 'How much did I spend?');

    expect((await getFrequentQuestions(db, 10))[0].text).toBe('How much did I spend?');
  });
});

describe('what is never remembered', () => {
  it.each(['hi', 'thanks', 'ok', '   ', '?'])('ignores %s', async (text) => {
    await recordQuestion(db, text);
    expect(await getFrequentQuestions(db, 10)).toEqual([]);
  });
});

describe('ranking', () => {
  it('puts the most asked first', async () => {
    await seed('what did I spend on milk', 1, '2026-09-01T00:00:00.000Z');
    await seed('how much this month', 5, '2026-09-01T00:00:00.000Z');

    expect((await getFrequentQuestions(db, 10)).map((q) => q.text)).toEqual([
      'how much this month',
      'what did I spend on milk',
    ]);
  });

  /** Of two asked equally often, the one still on their mind. */
  it('breaks a tie on recency', async () => {
    await seed('older question here', 2, '2026-09-01T00:00:00.000Z');
    await seed('newer question here', 2, '2026-09-10T00:00:00.000Z');

    expect((await getFrequentQuestions(db, 10))[0].text).toBe('newer question here');
  });

  it('returns no more than asked for', async () => {
    for (let i = 0; i < 5; i += 1) await seed(`question number ${i}`, i + 1, '2026-09-01T00:00:00.000Z');
    expect(await getFrequentQuestions(db, 3)).toHaveLength(3);
  });

  it('has nothing to suggest before anything is asked', async () => {
    expect(await getFrequentQuestions(db, 5)).toEqual([]);
  });
});

describe('the cap', () => {
  /**
   * Unbounded question text is both a storage and a privacy problem — the
   * longer the tail, the more it resembles the transcript §15.3 refuses to
   * keep.
   */
  it('keeps the list bounded', async () => {
    for (let i = 0; i < 120; i += 1) await recordQuestion(db, `a distinct question ${i}`);

    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asked_questions');
    expect(row!.n).toBeLessThanOrEqual(100);
  });

  /** Pruning by usefulness, not age: a favourite outlives a burst of one-offs. */
  it('keeps a frequently asked question over recent one-offs', async () => {
    await seed('the favourite question', 50, '2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 120; i += 1) await recordQuestion(db, `a distinct question ${i}`);

    const kept = await getFrequentQuestions(db, 1);
    expect(kept[0].text).toBe('the favourite question');
  });
});

describe('delete-all (§15.2)', () => {
  it('leaves no record of what was asked', async () => {
    await recordQuestion(db, 'how much did I spend on nappies');
    await clearQuestions(db);

    expect(await getFrequentQuestions(db, 10)).toEqual([]);
    const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM asked_questions');
    expect(row!.n).toBe(0);
  });
});
