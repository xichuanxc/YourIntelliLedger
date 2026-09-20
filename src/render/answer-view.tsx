/**
 * A planned answer, drawn (§6.7, §14.7).
 *
 * `plan.ts` has already decided what may honestly be shown; this only draws
 * it. The split matters because the decisions are the part worth testing and
 * they should not be buried in JSX — and because a chart that must not exist
 * is better prevented than rendered carefully.
 *
 * ## Why it reuses the Insights pieces
 *
 * `DonutBreakdown`, `StatTile` and the palette come from the Insights screen
 * unchanged. An agent answer showing the same numbers in a second visual
 * language would make the app look like two apps, and the donut in particular
 * carries a legend naming every slice with its amount and share — which is not
 * decoration: four of the six light-mode hues sit below 3:1 against the card
 * surface, so identity may never rest on colour alone.
 *
 * ## The surface is load-bearing
 *
 * The palette is validated against `backgroundElement` (#F3F4F6 light,
 * #1A1B1E dark), which is exactly what an assistant bubble is drawn on. So
 * these charts sit on the surface their contrast was checked against, and
 * introducing a different one here would silently invalidate that.
 */

import { StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import { BarChart, LineChart } from 'react-native-gifted-charts';

import { formatMoney, formatMoneyCompact } from '@/data/money';
import type { PlottedValue, RenderPlan } from '@/render/plan';
import { TABLE_PAGE_SIZE } from '@/render/plan';
import { paletteFor } from '@/ui/chartPalette';
import { DonutBreakdown } from '@/ui/components/donut-breakdown';
import { StatTile } from '@/ui/components/stat-tile';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { MaxContentWidth, Radius, Spacing } from '@/ui/theme';

export interface AnswerViewProps {
  plan: RenderPlan;
  currency: string;
}

/** Four gridlines is enough to read a value off; more is graph paper. */
const SECTIONS = 4;

function niceMax(values: readonly number[]): { max: number; step: number } {
  const largest = Math.max(...values, 0);
  const step = largest > 0 ? Math.ceil(largest / SECTIONS) : 1;
  return { max: step * SECTIONS, step };
}

function axisLabels(step: number, money: boolean, currency: string): string[] {
  return Array.from({ length: SECTIONS + 1 }, (_, index) =>
    money ? formatMoneyCompact(step * index * 100, currency) : String(step * index)
  );
}

export function AnswerView({ plan, currency }: AnswerViewProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const { width } = useWindowDimensions();

  /**
   * A bound, not a measurement.
   *
   * These draw inside a chat bubble, which is capped at 85% of the list width
   * and carries its own horizontal padding, on top of the list's. Measuring
   * the container properly would mean an `onLayout` pass and a render with no
   * chart in it; erring narrow costs a few points of width, while erring wide
   * pushes the chart out of the bubble.
   */
  const chartWidth = Math.min(width, MaxContentWidth) * 0.85 - Spacing.four * 4;

  if (plan.kind === 'none') return null;

  if (plan.kind === 'stat') {
    return (
      <View style={styles.block}>
        <StatTile
          label={plan.label}
          value={
            plan.valueCents === null
              ? plan.raw.toLocaleString()
              : formatMoney(plan.valueCents, currency)
          }
          caption={plan.title}
        />
      </View>
    );
  }

  if (plan.kind === 'donut') {
    return (
      <View style={styles.block}>
        {plan.title && <Caption>{plan.title}</Caption>}
        <DonutBreakdown
          entries={plan.entries}
          currency={currency}
          totalCents={plan.totalCents}
          emptyMessage="Nothing to show."
        />
      </View>
    );
  }

  if (plan.kind === 'table') {
    return (
      <View style={styles.block}>
        {plan.title && <Caption>{plan.title}</Caption>}
        <View style={styles.row}>
          {plan.columns.map((column, index) => (
            <ThemedText
              key={column + index}
              type="smallBold"
              themeColor="textSecondary"
              style={[styles.cell, index > 0 && styles.numeric]}>
              {column}
            </ThemedText>
          ))}
        </View>
        {plan.rows.map((row, rowIndex) => (
          <View key={rowIndex} style={[styles.row, { borderTopColor: theme.border }]}>
            {row.map((cell, cellIndex) => (
              <ThemedText
                key={cellIndex}
                type="small"
                style={[styles.cell, cellIndex > 0 && styles.numeric]}>
                {cell}
              </ThemedText>
            ))}
          </View>
        ))}
        {/* §6.7 paginates past 50 rows. Saying so beats a table that simply
            stops, which reads as the answer being complete. */}
        {plan.totalRows > TABLE_PAGE_SIZE && (
          <Caption>{`Showing the first ${TABLE_PAGE_SIZE} of ${plan.totalRows} rows.`}</Caption>
        )}
      </View>
    );
  }

  const points: PlottedValue[] = plan.kind === 'bars' ? plan.bars : plan.points;
  const { max, step } = niceMax(points.map((point) => point.value));
  // One series, one colour — slot 1 for every mark. Colouring each bar by its
  // own value would double-encode length as hue and burn the only free channel
  // on what the chart already shows.
  const colour = paletteFor(scheme)[0];

  /**
   * Longer than this and a label cannot sit under a bar on a phone.
   *
   * The library clips rather than wraps, so "pantry staple" and "Chemist
   * Warehouse" arrive as "pantry…" or as nothing — a chart whose axis cannot
   * be read is a picture of numbers with no names on them.
   */
  const LONG_LABEL = 6;
  const longest = points.reduce((most, point) => Math.max(most, point.label.length), 0);
  const rotated = longest > LONG_LABEL;

  /**
   * The label's own slot, wide enough to hold it.
   *
   * The ellipsis was never ours — the library draws each label in a
   * fixed-width slot and clips what does not fit, which tilting alone did not
   * change. Estimated from the character count at this font size, because
   * there is no text measurement available here; a proportional face makes
   * this approximate rather than exact, so the cap is generous.
   */
  const labelWidth = Math.min(112, Math.max(44, Math.round(longest * 6)));

  const shared = {
    width: chartWidth,
    height: 160,
    // Tilted only when something needs it: rotating "Sep" and "Oct" would add
    // an angle to read for nothing.
    rotateLabel: rotated,
    labelWidth: rotated ? labelWidth : undefined,
    // One line: a rotated label that wrapped would read as two labels.
    xAxisTextNumberOfLines: 1,
    // A tilted label runs diagonally, so the room it needs below the axis
    // grows with its length — otherwise the chart's own height crops it.
    labelsExtraHeight: rotated ? Math.min(64, Math.round(labelWidth * 0.7)) : 0,
    maxValue: max,
    noOfSections: SECTIONS,
    yAxisLabelTexts: axisLabels(step, plan.money, currency),
    yAxisTextStyle: { color: theme.textSecondary, fontSize: 10 },
    xAxisLabelTextStyle: { color: theme.textSecondary, fontSize: 10 },
    yAxisColor: theme.border,
    xAxisColor: theme.border,
    rulesColor: theme.border,
    isAnimated: false,
  };

  return (
    <View style={styles.block}>
      {plan.title && <Caption>{plan.title}</Caption>}
      {plan.kind === 'bars' ? (
        <BarChart
          {...shared}
          data={points.map((point) => ({
            value: point.value,
            label: point.label,
            frontColor: colour,
          }))}
          barWidth={Math.min(24, Math.max(10, chartWidth / (points.length * 2)))}
          spacing={Math.max(6, chartWidth / (points.length * 4))}
          initialSpacing={Spacing.three}
          barBorderTopLeftRadius={4}
          barBorderTopRightRadius={4}
        />
      ) : (
        <LineChart
          {...shared}
          data={points.map((point) => ({ value: point.value, label: point.label }))}
          color={colour}
          thickness={2}
          dataPointsColor={colour}
          dataPointsRadius={4}
          initialSpacing={Spacing.three}
          curved={false}
        />
      )}
    </View>
  );
}

/** Titles and notes wear text tokens, never the series colour. */
function Caption({ children }: { children: string }) {
  return (
    <ThemedText type="small" themeColor="textSecondary">
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two, marginTop: Spacing.three, borderRadius: Radius.medium },
  row: { flexDirection: 'row', gap: Spacing.three, paddingVertical: Spacing.one, borderTopWidth: StyleSheet.hairlineWidth },
  cell: { flex: 1 },
  numeric: { textAlign: 'right' },
});
