// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

/**
 * §14.6: "String interpolation into SQL is prohibited anywhere in the
 * codebase; add a lint rule and a unit test that asserts the compiler's
 * output contains no user-supplied literals." This is the lint rule; the test
 * lives in `__tests__/agent/compile.test.ts`.
 *
 * It fires on a template literal that both contains a SQL keyword and has
 * something interpolated into it. That is broader than "interpolates a user
 * value", deliberately — a rule that tried to tell a safe interpolation from
 * an unsafe one would have to understand where the string came from, and the
 * whole point is that the next person should not have to be trusted to make
 * that judgement silently. A genuinely safe site can still be written: build
 * it by concatenating named constants, as `src/agent/compile.ts` does.
 */
const NO_SQL_INTERPOLATION = {
  selector:
    'TemplateLiteral[expressions.length>0] > TemplateElement[value.raw=/(^|[^A-Za-z_])(SELECT |INSERT INTO |DELETE FROM |UPDATE [A-Za-z_]+ SET |WHERE |GROUP BY |ORDER BY |HAVING )/i]',
  message:
    'No string interpolation into SQL (spec §14.6). Bind values as `?` parameters, ' +
    'and assemble any variable SQL from named constants rather than a template literal.',
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', '__tests__/**/*.ts'],
    rules: {
      'no-restricted-syntax': ['error', NO_SQL_INTERPOLATION],
    },
  },
  {
    // The compiler turns model-supplied input into SQL, so it gets the strict
    // form: no template literal may interpolate anything at all, keyword or
    // not. Every fragment there is a named constant joined with `+`, which is
    // a shape a reader can check at a glance.
    files: ['src/agent/compile.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        NO_SQL_INTERPOLATION,
        {
          selector: 'TemplateLiteral[expressions.length>0]',
          message:
            'No interpolation in `compile.ts` (spec §14.6) — build SQL by concatenating ' +
            'named constants and bind every value as a `?` parameter.',
        },
      ],
    },
  },
]);
