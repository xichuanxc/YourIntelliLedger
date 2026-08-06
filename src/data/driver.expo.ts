/**
 * `SqlDriver` backed by `expo-sqlite` — the driver the app actually runs on.
 * Identical API on Android and iOS (§3), so there is no platform fork here.
 */

import * as SQLite from 'expo-sqlite';

import type { RunResult, SqlDriver, SqlValue } from '@/data/driver';

/** The `expo-sqlite` methods this driver needs — `SQLiteDatabase` and `Transaction` both satisfy it. */
type SQLiteExecutor = Pick<
  SQLite.SQLiteDatabase,
  'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync'
>;

class ExpoSqlDriver implements SqlDriver {
  constructor(
    private readonly executor: SQLiteExecutor,
    private readonly db: SQLite.SQLiteDatabase | null
  ) {}

  async exec(sql: string): Promise<void> {
    await this.executor.execAsync(sql);
  }

  async run(sql: string, params: readonly SqlValue[] = []): Promise<RunResult> {
    const result = await this.executor.runAsync(sql, params as SQLite.SQLiteBindParams);
    return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
  }

  all<T>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.executor.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams);
  }

  get<T>(sql: string, params: readonly SqlValue[] = []): Promise<T | null> {
    return this.executor.getFirstAsync<T>(sql, params as SQLite.SQLiteBindParams);
  }

  async transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    if (!this.db) {
      throw new Error('Nested transactions are not supported (spec §4: one transaction per write)');
    }
    let result: T;
    // Exclusive rather than plain: it hands back a dedicated connection, so a
    // concurrent write elsewhere in the app cannot interleave into the middle
    // of a receipt save. The whole point of §5.1's single-transaction write is
    // that a partial receipt never reaches disk.
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      result = await fn(new ExpoSqlDriver(txn, null));
    });
    return result!;
  }

  async close(): Promise<void> {
    await this.db?.closeAsync();
  }
}

export async function openExpoDriver(databaseName: string): Promise<SqlDriver> {
  const db = await SQLite.openDatabaseAsync(databaseName, {
    useNewConnection: false,
    enableChangeListener: false,
  });
  return new ExpoSqlDriver(db, db);
}
