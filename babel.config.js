/**
 * Metro applies `babel-preset-expo` on its own, but Jest does not — without
 * this file the test runner cannot parse TypeScript at all.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { reactCompiler: true }]],
  };
};
