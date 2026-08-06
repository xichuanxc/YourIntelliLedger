/**
 * Rejected before a write reaches SQLite. The `CHECK` constraints in §4.4 are
 * the backstop; this is the layer that produces a message a user can act on.
 */
export class ValidationError extends Error {
  constructor(
    message: string,
    /** The offending field, in domain terms (`purchasedAt`, `items[2].qty`). */
    readonly field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** A bill or item id that does not exist. Maps to `not_found` in §14.5. */
export class NotFoundError extends Error {
  constructor(what: string, id: number) {
    super(`${what} ${id} does not exist`);
    this.name = 'NotFoundError';
  }
}
