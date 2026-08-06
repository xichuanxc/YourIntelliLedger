/**
 * The one place the database is opened — spec §4.1.
 *
 * Everything else in the app reaches SQLite through a repository, never
 * through this module and never through a driver directly (§2.2 rule 1).
 */

import type { SqlDriver } from '@/data/driver';
import { openExpoDriver } from '@/data/driver.expo';
import { migrate } from '@/data/migrate';

export const DATABASE_NAME = 'yourintelliledger.db';

/**
 * Applies the engine configuration and brings the schema up to date.
 *
 * Exported separately from `getDb()` so tests can run the identical setup
 * against the better-sqlite3 driver.
 */
export async function prepareDatabase(db: SqlDriver): Promise<SqlDriver> {
  // WAL cannot be set inside a transaction, so it goes first, alone.
  await db.exec('PRAGMA journal_mode = WAL');
  await db.exec('PRAGMA foreign_keys = ON');
  await db.exec('PRAGMA synchronous = NORMAL');
  await migrate(db);
  return db;
}

let connection: Promise<SqlDriver> | null = null;

/**
 * The app-wide database handle. Idempotent: the first call opens and migrates,
 * every later call awaits the same promise.
 */
export function getDb(): Promise<SqlDriver> {
  connection ??= openExpoDriver(DATABASE_NAME).then(prepareDatabase);
  return connection;
}

/** Closes the handle and forgets it. Used by delete-all (§15.2). */
export async function closeDb(): Promise<void> {
  const existing = connection;
  connection = null;
  if (existing) await (await existing).close();
}
