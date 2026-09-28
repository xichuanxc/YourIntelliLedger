import type { Migration } from '@/data/migrations/types';

/**
 * Schema v5 — how long until the answer started (§6.8).
 *
 * §6.8 asks for two numbers: a fastpath p95 under 100 ms, and an agent p50
 * under four seconds **to first token**. The first was already measurable;
 * the second was not, because `latency_ms` records the whole turn.
 *
 * Those are different quantities and the difference is the point. A turn that
 * calls two tools and writes a long answer can take fifteen seconds and still
 * feel immediate, because text began appearing in one. Logging only the total
 * would have made a responsive app look slow and an unresponsive one look
 * fine, so long as both finished at the same moment.
 *
 * Null wherever it does not apply: a fastpath answer has no stream, and a
 * turn that failed before the model spoke never had a first token. Null here
 * means "not applicable", never "fast".
 *
 * No question text, no amounts — §15.3 holds. A duration is not a transcript.
 */
export const migration005: Migration = {
  version: 5,
  name: 'record time to first token',
  sql: `
    ALTER TABLE query_log ADD COLUMN first_token_ms INTEGER;
  `,
};
