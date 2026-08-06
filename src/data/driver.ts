/**
 * The narrow SQLite surface the data layer is allowed to use.
 *
 * Everything above this interface — migrations, repositories, the §14.6 query
 * compiler — is written against `SqlDriver` and nothing else. `expo-sqlite`
 * backs it in the app; `better-sqlite3` backs it under Jest, which is what
 * makes §10's "Jest + in-memory SQLite" row possible at all (expo-sqlite
 * cannot run in Node).
 *
 * Deliberately small: no query building, no schema knowledge, no ORM. If a
 * method here starts knowing about tables, it is in the wrong file.
 */

export type SqlValue = string | number | null | Uint8Array;

export interface RunResult {
  changes: number;
  /** Rowid of the last INSERT on this connection. Only meaningful after one. */
  lastInsertRowId: number;
}

export interface SqlDriver {
  /** Execute one or more statements with no parameters and no result. */
  exec(sql: string): Promise<void>;

  /** Execute a single parameterised statement that returns no rows. */
  run(sql: string, params?: readonly SqlValue[]): Promise<RunResult>;

  /** Execute a single parameterised query and return every row. */
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;

  /** Execute a single parameterised query and return the first row, if any. */
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | null>;

  /**
   * Run `fn` inside a transaction, committing on resolve and rolling back on
   * reject. The driver passed to `fn` is the transactional one — statements
   * issued against the outer driver are not part of the transaction.
   *
   * Not reentrant: nesting is a bug, not a savepoint.
   */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T>;

  close(): Promise<void>;
}
