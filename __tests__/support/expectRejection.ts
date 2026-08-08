/**
 * `await expect(promise).rejects.toThrow()` is not reliable under
 * `jest-expo/node`, so this replaces it.
 *
 * ## The evidence, because this looks like superstition otherwise
 *
 * Roughly half of full-suite runs failed on assertions of the form
 * `await expect(db.run(bad)).rejects.toThrow()`, always reporting "Received
 * function did not throw", always on SQLite constraint violations. It looked
 * like the schema's CHECK constraints were missing.
 *
 * Reproduced deterministically with `--runInBand` (5/5 runs), while the same
 * file alone passed 8/8 — so it is cross-file, not a bad test. Instrumenting
 * the failing assertion showed the database was in perfect order:
 *
 *     user_version=1  foreign_keys=1  ignore_check_constraints=0
 *     bills schema has CHECK? true
 *     insert outcome: THREW CHECK constraint failed: source IN (...)
 *     rows now: []
 *
 * The statement threw, the error was a genuine `Error` (verified
 * `instanceof`), and no row was written — yet the matcher reported no throw.
 * Neither `--no-cache` nor per-project cache directories changed anything,
 * which rules out the transform cache I originally blamed.
 *
 * So the promise rejects and the matcher does not see it. An explicit
 * try/catch does, consistently. This helper keeps the intent readable while
 * avoiding the matcher entirely.
 */

export interface RejectionExpectation {
  /** Substring or pattern the message must contain. */
  message?: string | RegExp;
  /** Constructor the error must be an instance of. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type?: new (...args: any[]) => Error;
}

/**
 * Asserts that `work` rejects, and returns the error for further assertions.
 *
 * Takes a thunk rather than a promise so that a synchronous throw is caught
 * too — some repository calls validate before they ever reach SQLite.
 */
export async function expectRejection(
  work: () => Promise<unknown>,
  expectation: RejectionExpectation = {}
): Promise<Error> {
  let caught: unknown;
  let threw = false;

  try {
    await work();
  } catch (error) {
    threw = true;
    caught = error;
  }

  if (!threw) {
    throw new Error('Expected the call to reject, but it resolved.');
  }

  const error = caught as Error;
  const describeCaught = () => `${(caught as Error)?.constructor?.name}: ${(caught as Error)?.message}`;

  if (expectation.type && !(error instanceof expectation.type)) {
    throw new Error(`Expected a ${expectation.type.name}, got ${describeCaught()}`);
  }

  if (expectation.message !== undefined) {
    const matches =
      typeof expectation.message === 'string'
        ? error.message.includes(expectation.message)
        : expectation.message.test(error.message);

    if (!matches) {
      throw new Error(
        `Expected the message to match ${String(expectation.message)}, got: ${error.message}`
      );
    }
  }

  return error;
}
