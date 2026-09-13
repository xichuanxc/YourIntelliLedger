import type { Migration } from '@/data/migrations/types';

/**
 * Schema v4 — keeping the Ask conversation, when the user asks for it.
 *
 * Until now a conversation lived in the store and died with the process:
 * close the app and the answers were gone. That is the right default — an
 * answer quotes amounts, and §8.2's posture is that nothing persists unless
 * someone says so — but it is a poor *only* option, because the useful thing
 * about an answer is often noticing it again a week later.
 *
 * So this table exists and is written **only while the Settings switch is
 * on**. Off is the default, turning it off deletes what is here, and §15.2's
 * delete-all drops it like everything else.
 *
 * ## Why the envelope is stored, not just the text
 *
 * §14.7's envelope is what §6.7's renderer draws — the chart, the table, the
 * stat tile. Keeping only `text` would mean a restored conversation silently
 * degraded to plain prose, which looks like a bug rather than a limitation.
 * It is stored as JSON because this table's job is to give the message back
 * exactly as it was, not to query inside it; nothing here ever appears in a
 * WHERE clause, so the shape can change with the envelope without a migration.
 *
 * `currency` rides along per message for the reason `AskMessage` documents:
 * an answer keeps the currency it was computed in, so a ledger whose dominant
 * currency changes later cannot reprint old dollars as euros.
 */
export const migration004: Migration = {
  version: 4,
  name: 'save ask conversation records',
  sql: `
    CREATE TABLE ask_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      role            TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      text            TEXT NOT NULL,
      envelope_json   TEXT,               -- §14.7 envelope, verbatim; null for a question
      references_json TEXT,               -- bill links the tools vouched for
      currency        TEXT,               -- what this answer's amounts were computed in
      created_at      TEXT NOT NULL       -- ISO-8601 UTC
    );
  `,
};
