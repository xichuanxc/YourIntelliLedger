/**
 * `react-native-gifted-charts` ships untranspiled ESM, so importing it under
 * `jest-expo` fails with `Unexpected token 'export'` — and it is now reached
 * transitively by anything that renders an Ask bubble, not only by chart
 * tests.
 *
 * Mocked here rather than added to `transformIgnorePatterns`: the chart
 * internals are the library's concern, the suites are about this app's
 * decisions, and transforming it would slow every UI run to exercise someone
 * else's SVG. Jest picks up a `__mocks__` directory adjacent to `node_modules`
 * automatically for packages, so no suite has to know this exists.
 *
 * The stubs render their own identity, so a chart's *presence* stays
 * assertable — only the drawing is gone. `DonutBreakdown`'s legend is real
 * code and still runs, which matters: it is what carries identity when four of
 * the six light-mode hues sit below 3:1 against the card surface.
 */
const React = require('react');
const { Text } = require('react-native');

const stub = (name) =>
  function ChartStub() {
    return React.createElement(Text, null, name);
  };

module.exports = {
  BarChart: stub('bar-chart'),
  LineChart: stub('line-chart'),
  PieChart: stub('pie-chart'),
};
