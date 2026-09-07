import type { Migration } from '@/data/migrations/types';

/**
 * Schema v2 — recording that a person has looked at a flagged bill.
 *
 * §4.11 is right that a flag must never be silently corrected: the numbers are
 * evidence that the parse was unreliable, and a banner that "fixed" a total
 * would destroy it. But three of the four flags — `sum_mismatch`,
 * `unit_mismatch`, `missing_price` — clear only when the numbers change, and
 * some receipts genuinely do not reconcile: a promotion the OCR missed, a line
 * it dropped and the user cannot recover. Those bills showed "Needs review"
 * for ever, with no way to dismiss it.
 *
 * An indicator that cannot be cleared is one a user learns to ignore, which
 * costs the flag its whole purpose — surfacing "receipts worth re-checking".
 *
 * So the acknowledgement is stored *beside* the flags rather than instead of
 * them. `parse_flags` keeps saying what looked wrong; `reviewed_flags` records
 * which of those a person has seen and accepted. The bill still knows it does
 * not add up, and stops asking.
 *
 * Two columns rather than one boolean, because "reviewed" has to mean
 * "reviewed *this*". Editing a bill later can raise a flag that nobody has
 * looked at, and comparing the sets is what lets the indicator come back for
 * the new one while staying quiet about the old.
 */
export const migration002: Migration = {
  version: 2,
  name: 'record review acknowledgement',
  sql: `
    -- ISO-8601 UTC, or NULL when nobody has confirmed anything.
    ALTER TABLE bills ADD COLUMN reviewed_at TEXT;

    -- JSON array of the §4.11 flags acknowledged at that moment, e.g.
    -- ["sum_mismatch"]. NULL means none.
    ALTER TABLE bills ADD COLUMN reviewed_flags TEXT;
  `,
};
