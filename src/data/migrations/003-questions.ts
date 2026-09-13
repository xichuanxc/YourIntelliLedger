import type { Migration } from '@/data/migrations/types';

/**
 * Schema v3 — remembering what this person actually asks.
 *
 * A ledger's useful questions are personal: "how much on nappies", "what do I
 * spend at the Asian grocer". Static examples cannot know them, so the Ask
 * screen suggests the ones this user keeps asking.
 *
 * **Deliberately not `query_log`.** §15.3 is explicit that no question text is
 * stored there — it is diagnostic, not a transcript, and that promise is worth
 * more than the convenience of one table. This is a different thing with a
 * different justification: the user's own words, kept to serve them, never
 * sent anywhere, and cleared by delete-all (§15.2).
 *
 * A table rather than MMKV because §4.2's rule is that one earns its place
 * when queries **cross** its rows — ranking by frequency aggregates and sorts
 * across all of them. It also means the ranking can be tested against real
 * SQLite instead of a mocked key-value store.
 *
 * The primary key is the *normalised* question, so "How much did I spend?" and
 * "how much did i spend" are one entry rather than two near-identical
 * suggestions. `display` keeps the most recent spelling, because that is what
 * the user last chose to type.
 */
export const migration003: Migration = {
  version: 3,
  name: 'remember frequently asked questions',
  sql: `
    CREATE TABLE asked_questions (
      normalised     TEXT PRIMARY KEY,   -- grouping key; see questionsRepo
      display        TEXT NOT NULL,      -- most recent spelling, shown as-is
      asked_count    INTEGER NOT NULL DEFAULT 1,
      last_asked_at  TEXT NOT NULL       -- ISO-8601 UTC
    );
  `,
};
