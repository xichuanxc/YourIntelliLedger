/**
 * The saved Ask conversation (§6, §15.2).
 *
 * Written only while the Settings switch is on — see `getSaveAskHistory`. The
 * store checks the preference; this file just stores what it is given, so the
 * rule lives in one place rather than being re-decided per call site.
 *
 * ## What this is not
 *
 * It is not `query_log`. §15.3 keeps that free of question text and amounts
 * because it is diagnostic — a counter, not a transcript. This table is the
 * opposite by design: it is the transcript, it exists only by explicit
 * consent, and it never leaves the device.
 */

import { nowUtc } from '@/data/dates';
import type { SqlDriver } from '@/data/driver';

/**
 * How many messages to keep.
 *
 * A conversation is read from the bottom, and nobody scrolls back through two
 * hundred turns. The cap bounds a table that would otherwise grow for as long
 * as the switch stays on — and an unbounded transcript is a bigger promise
 * than the switch made.
 */
const KEEP = 200;

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  /**
   * §14.7's envelope and the bill links, as they were stored.
   *
   * `unknown` on purpose: keeping the data layer free of agent types, and
   * being honest that a row written by an older build may not match today's
   * shape. The caller casts, having decided what it can tolerate.
   */
  envelope: unknown;
  references: unknown;
  currency: string | null;
}

export interface NewMessage {
  role: 'user' | 'assistant';
  text: string;
  envelope?: unknown;
  references?: unknown;
  currency?: string;
}

/** `undefined` and unserialisable values both become a null column. */
function toJson(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

/**
 * A row written by us, so a parse failure means the row is damaged rather
 * than that the caller passed something odd. Dropping the structured half
 * keeps the message readable instead of failing the whole conversation.
 */
function fromJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function appendMessage(db: SqlDriver, message: NewMessage): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO ask_messages (role, text, envelope_json, references_json, currency, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        message.role,
        message.text,
        toJson(message.envelope),
        toJson(message.references),
        message.currency ?? null,
        nowUtc(),
      ]
    );

    // Oldest out first — unlike the questions table, which prunes by
    // usefulness. A conversation is a sequence, and dropping the middle of
    // one would leave an answer with no question above it.
    await tx.run(
      `DELETE FROM ask_messages
        WHERE id NOT IN (SELECT id FROM ask_messages ORDER BY id DESC LIMIT ?)`,
      [KEEP]
    );
  });
}

/** The conversation in the order it happened, oldest first. */
export async function getConversation(db: SqlDriver): Promise<StoredMessage[]> {
  const rows = await db.all<{
    id: number;
    role: 'user' | 'assistant';
    text: string;
    envelope_json: string | null;
    references_json: string | null;
    currency: string | null;
  }>(
    `SELECT id, role, text, envelope_json, references_json, currency
       FROM ask_messages
      ORDER BY id ASC`
  );

  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    text: row.text,
    envelope: fromJson(row.envelope_json),
    references: fromJson(row.references_json),
    currency: row.currency,
  }));
}

/**
 * Deletes the saved conversation.
 *
 * Three callers, all of which mean it literally: the ⋯ menu on the Ask
 * screen, switching the preference off, and §15.2's delete-all.
 */
export async function clearConversation(db: SqlDriver): Promise<void> {
  await db.run('DELETE FROM ask_messages');
}
