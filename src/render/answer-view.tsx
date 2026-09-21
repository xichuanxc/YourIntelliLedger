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
  /**
   * Long names are not an axis problem, and three attempts at treating them
   * as one said so.
   *
   * Under a bar there is no room: a phone gives each about forty points, so
   * the library clipped them. Widening the label's box pushed every label off
   * its own bar, because the box is centred on it. Turning the chart sideways
   * moved the names to the side and then offset them two rows from the bars
   * they belonged to.
   *
   * Eight shops with names like "PAK'nSAVE Mill Street" is a **ranked list**,
   * not a bar chart — which is also the standing advice for more than about
   * seven labelled classes. Drawn below out of plain views: the name and the
   * amount on one line, the bar beneath. Nothing to clip, nothing to rotate,
   * and no guessing at the width of text.
   */
  const LONG_LABEL = 6;
  const longest = points.reduce((most, point) => Math.max(most, point.label.length), 0);
  const ranked = plan.kind === 'bars' && longest > LONG_LABEL;

  const shared = {
    width: chartWidth,
    maxValue: max,
    noOfSections: SECTIONS,
    yAxisTextStyle: { color: theme.textSecondary, fontSize: 10 },
    xAxisLabelTextStyle: { color: theme.textSecondary, fontSize: 10 },
    yAxisColor: theme.border,
    xAxisColor: theme.border,
    rulesColor: theme.border,
    isAnimated: false,
  };

  const upright = {
    ...shared,
    height: 160,
    yAxisLabelTexts: axisLabels(step, plan.money, currency),
  };


  return (
    <View style={styles.block}>
      {plan.title && <Caption>{plan.title}</Caption>}
      {plan.kind === 'bars' && ranked ? (
        <RankedBars points={points} money={plan.money} currency={currency} colour={colour} />
      ) : plan.kind === 'bars' ? (
        <BarChart
          {...upright}
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
          {...upright}
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

/**
 * A ranked list with a bar behind each row.
 *
 * Plain views rather than the chart library, because the thing that kept
 * going wrong was the library's own label placement. Here a name is a `Text`
 * on a line of its own width: it cannot be clipped by a slot, cannot drift
 * from its bar, and needs no estimate of how wide the words are.
 */
function RankedBars({
  points,
  money,
  currency,
  colour,
}: {
  points: PlottedValue[];
  money: boolean;
  currency: string;
  colour: string;
}) {
  const theme = useTheme();
  // Widths are a share of the largest, so the longest bar fills the row.
  const largest = Math.max(...points.map((point) => point.value), 1);

  return (
    <View style={styles.ranked}>
      {points.map((point) => (
        <View key={point.label} style={styles.rankedRow}>
          <View style={styles.rankedHead}>
            <ThemedText type="small" numberOfLines={1} style={styles.rankedName}>
              {point.label}
            </ThemedText>
            <ThemedText type="smallBold" style={styles.rankedValue}>
              {money ? formatMoneyCompact(point.cents, currency) : point.value.toLocaleString()}
            </ThemedText>
          </View>

          <View style={[styles.rankedTrack, { backgroundColor: theme.backgroundSelected }]}>
            <View
              style={[
                styles.rankedFill,
                { width: `${Math.max(2, (point.value / largest) * 100)}%`, backgroundColor: colour },
              ]}
            />
          </View>
        </View>
      ))}
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
  ranked: { gap: Spacing.two, marginTop: Spacing.one },
  rankedRow: { gap: Spacing.half },
  rankedHead: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.two },
  // The name takes the room it needs; the amount keeps its own column so the
  // figures line up down the list.
  rankedName: { flex: 1 },
  rankedValue: { fontVariant: ['tabular-nums'] },
  rankedTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  rankedFill: { height: '100%', borderRadius: 4 },
});
