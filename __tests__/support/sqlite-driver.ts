/**
 * `SqlDriver` backed by better-sqlite3, for Node-side tests only.
 *
 * Lives under `__tests__/` deliberately: better-sqlite3 is a devDependency and
 * must never be reachable from `src/`, or Metro would try to bundle a native
 * Node addon into the app.
 *
 * better-sqlite3 is synchronous, so every method here resolves immediately.
 * That is a fair stand-in for the real driver — the repositories are written
 * against promises regardless, and the interleaving that async introduces is
 * exactly what the exclusive transaction in `driver.expo.ts` rules out.
 */

import Database from 'better-sqlite3';

import type { RunResult, SqlDriver, SqlValue } from '@/data/driver';

class BetterSqliteDriver implements SqlDriver {
  constructor(
    private readonly db: Database.Database,
    private readonly inTransaction = false
  ) {}

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    const info = this.db.prepare(sql).run(...(params as SqlValue[]));
    return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
  }

  async all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as SqlValue[])) as T[];
  }

  async get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return (this.db.prepare(sql).get(...(params as SqlValue[])) as T | undefined) ?? null;
  }

  async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      throw new Error('Nested transactions are not supported (spec §4: one transaction per write)');
    }
    // Hand-rolled rather than better-sqlite3's `db.transaction()`, which
    // cannot wrap an async callback.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await fn(new BetterSqliteDriver(this.db, true));
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

/** Opens an in-memory database, or a file when a path is given. */
export function openTestDriver(path = ':memory:'): SqlDriver {
  const db = new Database(path);
  // Mirrors §4.1, minus WAL — meaningless for an in-memory database.
  db.pragma('foreign_keys = ON');
  return new BetterSqliteDriver(db);
}
