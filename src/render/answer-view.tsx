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

  // The bubble is inset from both screen edges and from its own padding.
  const chartWidth = Math.min(width, MaxContentWidth) - Spacing.four * 6;

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

  const shared = {
    width: chartWidth,
    height: 160,
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
