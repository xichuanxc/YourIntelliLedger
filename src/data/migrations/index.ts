import { migration001 } from '@/data/migrations/001-initial';
import { migration002 } from '@/data/migrations/002-review';
import { migration003 } from '@/data/migrations/003-questions';
import { migration004 } from '@/data/migrations/004-conversation';
import { migration005 } from '@/data/migrations/005-first-token';
import type { Migration } from '@/data/migrations/types';

export type { Migration };

/**
 * Every migration, in order. Append only — see §4.12.
 *
 * `SCHEMA_VERSION` is the same number that goes into an export's
 * `schema_version` field (§15.1), so an export made today can be matched
 * against the schema that produced it.
 */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
