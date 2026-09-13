/**
 * The saved Ask conversation (§6, §15.2).
 *
 * What is worth pinning: a conversation comes back in the order it happened,
 * the structured half of an answer survives the round trip so a restored
 * conversation still draws its chart, the table cannot grow without bound,
 * and clearing really clears.
 */

import { openTestDriver } from '../support/sqlite-driver';

import {
  appendMessage,
  clearConversation,
  getConversation,
} from '@/data/conversationRepo';
import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';

let db: SqlDriver;

beforeEach(async () => {
  db = openTestDriver();
  await migrate(db);
});

afterEach(async () => {
  await db.close();
});

describe('keeping a conversation', () => {
  it('gives it back in the order it happened', async () => {
    await appendMessage(db, { role: 'user', text: 'how much in June?' });
    await appendMessage(db, { role: 'assistant', text: 'You spent $214.30.' });
    await appendMessage(db, { role: 'user', text: 'and July?' });

    expect((await getConversation(db)).map((m) => [m.role, m.text])).toEqual([
      ['user', 'how much in June?'],
      ['assistant', 'You spent $214.30.'],
      ['user', 'and July?'],
    ]);
  });

  /**
   * Without this a restored answer degrades to prose — the chart, the table
   * and the bill links all vanish, which reads as a bug rather than a limit.
   */
  it('round-trips the structured half of an answer', async () => {
    const envelope = { text: 'You spent $214.30.', chart: { kind: 'bar', series: [1, 2] } };
    const references = [{ billId: 7, label: 'milk 2l' }];

    await appendMessage(db, {
      role: 'assistant',
      text: 'You spent $214.30.',
      envelope,
      references,
      currency: 'NZD',
    });

    const [saved] = await getConversation(db);
    expect(saved.envelope).toEqual(envelope);
    expect(saved.references).toEqual(references);
    expect(saved.currency).toBe('NZD');
  });

  it('leaves a question with no envelope rather than an empty one', async () => {
    await appendMessage(db, { role: 'user', text: 'how much in June?' });

    const [saved] = await getConversation(db);
    expect(saved.envelope).toBeNull();
    expect(saved.references).toBeNull();
    expect(saved.currency).toBeNull();
  });

  /** A damaged row should cost its chart, not the whole conversation. */
  it('still returns a message whose stored envelope will not parse', async () => {
    await db.run(
      `INSERT INTO ask_messages (role, text, envelope_json, created_at)
       VALUES ('assistant', 'You spent $12.', '{not json', '2026-09-14T00:00:00Z')`
    );

    const [saved] = await getConversation(db);
    expect(saved.text).toBe('You spent $12.');
    expect(saved.envelope).toBeNull();
  });
});

describe('bounding what is kept', () => {
  /**
   * Oldest out first, unlike the questions table which prunes by usefulness.
   * A conversation is a sequence: dropping from the middle would leave an
   * answer with no question above it.
   */
  it('keeps the most recent messages and drops the oldest', async () => {
    for (let i = 1; i <= 205; i += 1) {
      await appendMessage(db, { role: 'user', text: `question ${i}` });
    }

    const kept = await getConversation(db);
    expect(kept).toHaveLength(200);
    expect(kept[0].text).toBe('question 6');
    expect(kept[kept.length - 1].text).toBe('question 205');
  });
});

describe('clearing', () => {
  it('removes everything, as all three of its callers mean', async () => {
    await appendMessage(db, { role: 'user', text: 'how much in June?' });
    await appendMessage(db, { role: 'assistant', text: 'You spent $214.30.' });

    await clearConversation(db);

    expect(await getConversation(db)).toEqual([]);
  });

  it('leaves the table usable afterwards', async () => {
    await appendMessage(db, { role: 'user', text: 'first' });
    await clearConversation(db);
    await appendMessage(db, { role: 'user', text: 'second' });

    expect((await getConversation(db)).map((m) => m.text)).toEqual(['second']);
  });
});
