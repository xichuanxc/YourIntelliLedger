/**
 * Two test projects, because the data layer and the UI need different runtimes.
 *
 * `node` — everything that is pure logic or talks to SQLite through the
 * `SqlDriver` interface (spec §10's "Jest + in-memory SQLite" row). These run
 * in plain Node against better-sqlite3, so they are fast and can exercise real
 * transactions and rollbacks.
 *
 * `ui` — component tests, which need the React Native runtime. Run under the
 * Android preset; genuine per-platform behaviour is verified on device (§10),
 * not by re-running the same JS twice.
 *
 * ---
 *
 * **Run the two projects as separate Jest invocations** — `npm test` does.
 * Jest reuses worker processes across projects, and the React Native preset's
 * global setup leaks into `node` test files that land on a worker after it.
 * The symptom is nasty because it implicates the wrong layer: about one run in
 * four, `await expect(...).rejects.toThrow()` reported "Received function did
 * not throw" for SQLite errors that were in fact thrown, so the schema's CHECK
 * and foreign-key tests failed at random and looked like the constraints
 * themselves were missing. Rewriting one assertion as an explicit try/catch
 * made it pass while its neighbours kept failing, which is what pinned the
 * fault on the matcher rather than on SQLite. Running the projects in one
 * invocation — including with `--runInBand` — reproduces it readily.
 *
 * Separate invocations reduce it from about one run in four to rare, but do
 * not eliminate it: it reappeared once on the first run after `npm install`
 * changed `node_modules`, then passed ten runs straight. The signature is
 * always exactly 4 failures, all `rejects.toThrow()` assertions about SQLite
 * constraint errors. Re-run before believing it; twice in a row is a real
 * defect, once is this.
 */
const shared = {
  moduleNameMapper: {
    // Must precede the general rule: Jest tries these in order, and `^@/(.*)$`
    // would otherwise resolve `@/assets/…` to `src/assets/…`. tsconfig carries
    // the same pair of paths, so the two must be kept in step.
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'node',
      preset: 'jest-expo/node',
      testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
    },
    {
      ...shared,
      displayName: 'ui',
      preset: 'jest-expo/android',
      testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
    },
  ],
};
