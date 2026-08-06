/**
 * Migration runner — spec §4.12.
 *
 * Each pending migration runs inside its own transaction together with the
 * `user_version` bump, so a failure leaves the database at the last version
 * that fully applied. There is no partially-migrated state to recover from.
 */

import type { SqlDriver } from '@/data/driver';
import { MIGRATIONS, type Migration } from '@/data/migrations';

export interface MigrationReport {
  from: number;
  to: number;
  applied: number[];
}

async function readUserVersion(db: SqlDriver): Promise<number> {
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export async function migrate(
  db: SqlDriver,
  migrations: readonly Migration[] = MIGRATIONS
): Promise<MigrationReport> {
  assertContiguous(migrations);

  const from = await readUserVersion(db);
  const pending = migrations.filter((m) => m.version > from);
  const latest = migrations[migrations.length - 1]?.version ?? 0;

  if (from > latest) {
    // The database was written by a newer build. Migrating backwards is not
    // possible, and running the old code against a newer schema would corrupt
    // it, so refuse rather than guess.
    throw new Error(
      `Database is at schema version ${from}, but this build only knows up to ${latest}. ` +
        'Install a newer version of the app.'
    );
  }

  for (const migration of pending) {
    await db.transaction(async (tx) => {
      await tx.exec(migration.sql);
      // PRAGMA does not accept bound parameters; the value is a number from a
      // hard-coded module, never user input.
      await tx.exec(`PRAGMA user_version = ${migration.version}`);
    });
  }

  return { from, to: await readUserVersion(db), applied: pending.map((m) => m.version) };
}

/**
 * A gap or a duplicate means a merge went wrong. Catching it here turns a
 * silently-skipped migration into a startup failure with a clear message.
 */
function assertContiguous(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migration versions must be contiguous from 1: expected ${index + 1} at position ` +
          `${index}, found ${migration.version} ("${migration.name}")`
      );
    }
  });
}
