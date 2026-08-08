import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { formatMoney } from '@/data/money';
import { neutralFor, paletteFor } from '@/ui/chartPalette';
import { sharePercentages, toSlices, type SliceInput } from '@/ui/chartSlices';
import { ThemedText } from '@/ui/components/themed-text';
import { useColorScheme } from '@/ui/hooks/use-color-scheme';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export interface DonutBreakdownProps {
  entries: readonly SliceInput[];
  currency: string;
  /** Shown in the hole. The donut answers "share"; this answers "of what". */
  totalCents: number;
  /**
   * Names the whole. Defaults to "total". The merchant donut passes
   * "top 6" because its query returns only the largest few — calling that
   * a total would claim a share of all spending that it does not have.
   */
  totalLabel?: string;
  foldedLabel?: string;
  emptyMessage: string;
}

/**
 * A part-to-whole donut with a legend.
 *
 * The donut is deliberately the *smaller* half of this component. A ring is
 * only readable at a glance — it cannot be used to compare close values, and
 * four of the six light-mode hues sit below 3:1 against the card surface. The
 * legend is what makes it accurate and accessible: every slice named, with its
 * amount and share, so identity never depends on colour alone.
 *
 * Slices are capped and the tail folded in `chartSlices.ts`; hues are assigned
 * in fixed order and never cycled.
 */
export function DonutBreakdown({
  entries,
  currency,
  totalCents,
  totalLabel = 'total',
  foldedLabel,
  emptyMessage,
}: DonutBreakdownProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const { slices, percentages, colours } = useMemo(() => {
    const computed = toSlices(entries, foldedLabel ? { foldedLabel } : {});
    const palette = paletteFor(scheme);
    const neutral = neutralFor(scheme);

    let hue = 0;
    const assigned = computed.map((slice) =>
      // Only a neutral slice — an absence of category, i.e. "not itemised" —
      // gives up its hue. The folded tail keeps one: it is real categorised
      // spending, and sharing the grey made the two indistinguishable.
      slice.neutral ? neutral : palette[hue++ % palette.length]
    );

    return { slices: computed, percentages: sharePercentages(computed), colours: assigned };
  }, [entries, foldedLabel, scheme]);

  if (slices.length === 0) {
    return (
      <ThemedText type="small" themeColor="textSecondary">
        {emptyMessage}
      </ThemedText>
    );
  }

  const data = slices.map((slice, index) => ({
    value: slice.valueCents,
    color: colours[index],
  }));

  return (
    <View style={styles.container}>
      <View style={styles.chartRow}>
        <PieChart
          data={data}
          donut
          radius={78}
          innerRadius={48}
          innerCircleColor={theme.backgroundElement}
          // A hairline of surface between wedges, so adjacent hues never touch.
          sectionAutoFocus={false}
          strokeColor={theme.backgroundElement}
          strokeWidth={2}
          centerLabelComponent={() => (
            <View style={styles.centre}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {formatMoney(totalCents, currency)}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {totalLabel}
              </ThemedText>
            </View>
          )}
        />
      </View>

      <View style={styles.legend}>
        {slices.map((slice, index) => (
          <View
            key={slice.key}
            style={styles.legendRow}
            accessibilityRole="text"
            accessibilityLabel={`${slice.label}, ${formatMoney(slice.valueCents, currency)}, ${percentages[index]} percent`}>
            <View style={[styles.swatch, { backgroundColor: colours[index] }]} />
            <ThemedText style={styles.legendLabel} numberOfLines={1}>
              {slice.label}
              {slice.mergedCount > 1 ? ` (${slice.mergedCount})` : ''}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.legendPercent}>
              {percentages[index]}%
            </ThemedText>
            <ThemedText type="amount" style={styles.legendValue}>
              {formatMoney(slice.valueCents, currency)}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.four },
  chartRow: { alignItems: 'center' },
  centre: { alignItems: 'center' },
  legend: { gap: Spacing.two },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  swatch: { width: 12, height: 12, borderRadius: Radius.small },
  legendLabel: { flex: 1 },
  legendPercent: { minWidth: 38, textAlign: 'right' },
  legendValue: { minWidth: 72, textAlign: 'right' },
});
