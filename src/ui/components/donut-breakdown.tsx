import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { formatMoney } from '@/data/money';
import { neutralFor, paletteFor } from '@/ui/chartPalette';
import { colourDistance } from '@/ui/colourDistance';
import { sharePercentages, toSlices, type Slice, type SliceInput } from '@/ui/chartSlices';
import { ChevronRightIcon } from '@/ui/components/chevron-icon';
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
  /**
   * Whether the folded tail leads somewhere of its own.
   *
   * Off by default, and that default is the honest one: the tail stands for
   * several entries at once, so for most donuts there is no single list
   * behind it to open. A caller that has somewhere to send it — a screen
   * listing what it merged — says so here.
   */
  foldedSelectable?: boolean;
  emptyMessage: string;
  /**
   * Drill into a slice. Supplying this makes the legend rows tappable —
   * except the folded tail, which stands for several things at once and so
   * has no single detail to show.
   */
  onSelect?: (slice: Slice) => void;
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
/**
 * How far a palette hue must sit from a brand colour already in the chart.
 *
 * Below about 8 two colours are the same to anyone; 15 is where separation
 * becomes reliable. Twelve is the compromise this chart can afford: it drops
 * the hues that are genuinely confusable with a chain's colour while leaving
 * enough of the palette for the shops that have no colour of their own.
 */
const BRAND_CLEARANCE = 12;

export function DonutBreakdown({
  entries,
  currency,
  totalCents,
  totalLabel = 'total',
  foldedLabel,
  foldedSelectable = false,
  emptyMessage,
  onSelect,
}: DonutBreakdownProps) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';

  const { slices, percentages, colours } = useMemo(() => {
    const computed = toSlices(entries, foldedLabel ? { foldedLabel } : {});
    const palette = paletteFor(scheme);
    const neutral = neutralFor(scheme);

    /**
     * The colours entries brought with them — a chain's own, so the wedge and
     * its pin on the map agree. Collected first, because the palette has to
     * know what it is sharing the chart with.
     *
     * A colour claimed twice is dropped the second time: two branches of one
     * chain are two rows in the legend, and two identical swatches would make
     * the swatch useless for telling them apart.
     */
    const claimed: string[] = [];
    const own = computed.map((slice) => {
      if (slice.neutral || !slice.colour || claimed.includes(slice.colour)) return undefined;
      claimed.push(slice.colour);
      return slice.colour;
    });

    /**
     * The palette, skipping any hue that is a brand colour wearing a
     * different name. Measured rather than judged: in light mode the
     * palette's amber sits ΔE 8.2 from PAK'nSAVE's yellow and `#008300` sits
     * 5.0 from Woolworths' green, which is one colour as far as a reader is
     * concerned — and the swatch is the only thing tying a wedge to its row.
     *
     * Skipped in palette order, so the hues that remain keep their fixed
     * sequence. If every hue is too close, the next is taken anyway: a
     * near-duplicate is poor, and a slice with no colour at all is worse.
     *
     * Written as a loop rather than a closure over a counter because the
     * React Compiler will not have a variable reassigned after render.
     */
    const assigned: string[] = [];
    let hue = 0;

    for (const [index, slice] of computed.entries()) {
      // Only a neutral slice — an absence of category, i.e. "not itemised" —
      // gives up its hue. The folded tail keeps one: it is real categorised
      // spending, and sharing the grey made the two indistinguishable.
      if (slice.neutral) {
        assigned.push(neutral);
        continue;
      }

      const brought = own[index];
      if (brought) {
        assigned.push(brought);
        continue;
      }

      let chosen: string | null = null;
      for (let step = 0; step < palette.length && chosen === null; step += 1) {
        const candidate = palette[(hue + step) % palette.length];
        if (claimed.every((taken) => colourDistance(candidate, taken) >= BRAND_CLEARANCE)) {
          chosen = candidate;
          hue += step + 1;
        }
      }

      if (chosen === null) {
        chosen = palette[hue % palette.length];
        hue += 1;
      }

      assigned.push(chosen);
    }

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
        {slices.map((slice, index) => {
          // The tail names what it holds, in the description as well as on
          // screen: "Everything else" is otherwise a figure nobody can check.
          const members = slice.members?.join(', ');
          const description =
            `${slice.label}, ${formatMoney(slice.valueCents, currency)}, ` +
            `${percentages[index]} percent${members ? `, made up of ${members}` : ''}`;
          // The folded tail is several categories wearing one label, so it
          // leads somewhere only when the caller has a screen for it.
          const selectable = onSelect !== undefined && (!slice.folded || foldedSelectable);

          const content = (
            <>
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
              {/* Reserves its width on every row, tappable or not, so the
                  amounts stay in one column down the legend. */}
              <View style={styles.chevronSlot}>
                {selectable && <ChevronRightIcon color={theme.textSecondary} />}
              </View>
            </>
          );

          if (!selectable) {
            return (
              <View key={slice.key} style={styles.legendGroup}>
                <View style={styles.legendRow} accessibilityRole="text" accessibilityLabel={description}>
                  {content}
                </View>
                {members && (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.members}>
                    {members}
                  </ThemedText>
                )}
              </View>
            );
          }

          return (
            <Pressable
              key={slice.key}
              onPress={() => onSelect(slice)}
              accessibilityRole="button"
              accessibilityLabel={description}
              accessibilityHint="Shows what makes up this share"
              style={({ pressed }) => [
                styles.legendRow,
                styles.legendRowPressable,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              {content}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.four },
  chartRow: { alignItems: 'center' },
  centre: { alignItems: 'center' },
  legend: { gap: Spacing.two },
  legendGroup: { gap: Spacing.one },
  /* Indented past the swatch, so it reads as belonging to the row above. */
  members: { paddingLeft: Spacing.five },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  /**
   * Vertical padding pulled out of the row gap so a tappable row clears the
   * 44pt floor, negative margin so adding it does not respace the legend.
   */
  legendRowPressable: {
    paddingVertical: Spacing.two,
    marginVertical: -Spacing.two,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Radius.small,
  },
  swatch: { width: 12, height: 12, borderRadius: Radius.small },
  legendLabel: { flex: 1 },
  legendPercent: { minWidth: 38, textAlign: 'right' },
  legendValue: { minWidth: 72, textAlign: 'right' },
  chevronSlot: { width: 14, alignItems: 'flex-end' },
});
