export interface Migration {
  /** 1-based, contiguous, and permanent once shipped (§4.12). */
  version: number;
  /** Human label for logs and test failures; not persisted. */
  name: string;
  /** One or more statements, applied inside a single transaction. */
  sql: string;
}
