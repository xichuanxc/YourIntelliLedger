import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import {
  formatDate,
  formatDayMonth,
  formatMonth,
  formatMonthShort,
  monthOf,
  addDays,
  periodOfLastMonths,
  periodOfLastWeeks,
  todayLocalDate,
  type Period,
} from '@/data/dates';
import { getDb } from '@/data/db';
import {
  getCategoryBreakdown,
  getDataRange,
  getMerchantBreakdown,
  getMerchantLocations,
  getMonthlyTrend,
  getSpendSummary,
  getWeeklyTrend,
} from '@/data/insightsRepo';
import { formatMoney, formatMoneyCompact } from '@/data/money';
import {
  getInsightsCustom,
  getInsightsRange,
  getMapPreviews,
  setInsightsCustom,
  setInsightsRange,
} from '@/data/prefs';
import type {
  CategoryBreakdown,
  MerchantLocation,
  MerchantTotal,
  SpendSummary,
} from '@/types/insights';
import { CATEGORY_LABELS } from '@/types/vocabulary';
import type { BreakdownDimension } from '@/app/insights/breakdown';
import { trendCountFor, trendUnitFor } from '@/ui/calendar';
import { DateRangeField } from '@/ui/components/date-range-field';
import { DonutBreakdown } from '@/ui/components/donut-breakdown';
import type { SliceInput } from '@/ui/chartSlices';
import { EmptyState } from '@/ui/components/empty-state';
import { MerchantMap } from '@/ui/components/merchant-map';
import { Screen } from '@/ui/components/screen';
import { SelectMenu } from '@/ui/components/select-menu';
import { StatTile } from '@/ui/components/stat-tile';
import { ThemedText } from '@/ui/components/themed-text';
import { useTabBarInset } from '@/ui/hooks/use-tab-bar-inset';
import { useTheme } from '@/ui/hooks/use-theme';
import { MaxContentWidth, Radius, Spacing } from '@/ui/theme';

/**
 * The periods on offer.
 *
 * A ladder rather than a set: each step is roughly three times the last, so
 * these cover a week to a year without two of them answering the same
 * question. The unit is part of the range, not a second control — "last 4
 * weeks" and "last 3 months" are one choice for the user, and splitting them
 * into a unit and a count would make picking a period a two-step job.
 *
 * `shift` is what makes "Last week" a different *kind* of period from the
 * rest. The others are trailing windows ending now; this one is the previous
 * whole week, so its anchor moves back before the window is taken.
 */
const RANGES = [
  { value: 'w1', label: 'This week', unit: 'week', count: 1 },
  { value: 'wl', label: 'Last week', unit: 'week', count: 1, shift: -1 },
  { value: 'w4', label: 'Last 4 weeks', unit: 'week', count: 4 },
  { value: 'm1', label: 'This month', unit: 'month', count: 1 },
  { value: 'm3', label: 'Last 3 months', unit: 'month', count: 3 },
  { value: 'm6', label: 'Last 6 months', unit: 'month', count: 6 },
  { value: 'm12', label: 'Last 12 months', unit: 'month', count: 12 },
] as const satisfies readonly {
  value: string;
  label: string;
  unit: 'week' | 'month';
  count: number;
  /** Whole periods to step back before the window is taken. */
  shift?: number;
}[];

type RangeKey = (typeof RANGES)[number]['value'];

/** Four weeks: long enough to hold a shop's rhythm, short enough to read. */
const DEFAULT_RANGE = 'w4' satisfies RangeKey;

/**
 * The presets, plus the one the calendar beside them sets.
 *
 * "Custom" is in this list rather than implied, so the left-hand control never
 * reads "Last 3 months" while the charts show something a person picked by
 * hand — two controls over one value have to agree on what it is.
 */
const RANGE_OPTIONS = [
  ...RANGES.map(({ value, label }) => ({ value, label })),
  // Not in RANGES: every entry there is a trailing window of so many weeks or
  // months, and "All" is not a length at all — it is whatever the ledger
  // happens to span. It behaves like a hand-picked range whose ends are read
  // from the data instead of from a calendar.
  { value: 'all' as const, label: 'All' },
  // `as const`, or this one entry widens the whole array's `value` to
  // `string` and it stops satisfying the menu's option type.
  { value: 'custom' as const, label: 'Custom' },
];

type PeriodChoice = RangeKey | 'all' | 'custom';

function rangeOf(key: string) {
  // Found by name: a positional fallback silently changes meaning the next
  // time a preset is inserted above it.
  const found =
    RANGES.find((range) => range.value === key) ??
    RANGES.find((range) => range.value === DEFAULT_RANGE)!;

  // Normalised here rather than written as `shift: 0` on six entries: `as
  // const` makes each preset its own literal type, so a field only one of
  // them carries cannot be read off the union.
  return { ...found, shift: 'shift' in found ? found.shift : 0 };
}

/** One bar of the trend chart, whichever unit produced it. */
interface TrendBar {
  /** The axis label — a month abbreviation, or the week's Monday. */
  label: string;
  totalCents: number;
}

interface InsightsData {
  summary: SpendSummary;
  breakdown: CategoryBreakdown;
  merchants: MerchantTotal[];
  /** The subset of those merchants that has an address to put on a map. */
  locations: MerchantLocation[];
  trend: TrendBar[];
  period: Period;
  hasAnyBills: boolean;
  /** What the trend is counting, for the section heading. */
  trendUnit: 'week' | 'month';
}

export default function InsightsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  // Without this the merchant donut — the last thing on the screen — scrolls
  // to rest underneath iOS's translucent tab bar.
  const tabBarInset = useTabBarInset();

  // Read once, on mount, exactly as the bill screen does: flipping the switch
  // in Settings takes effect the next time Insights is opened rather than
  // pulling a map out from under someone reading it.
  const [previewsOn] = useState(getMapPreviews);

  /**
   * True while the map is being dragged, so the page stops scrolling under it.
   * Without this the two gestures compete and the map feels like it fights
   * the finger.
   */
  const [mapDragging, setMapDragging] = useState(false);

  const [range, setRange] = useState<PeriodChoice>(() => {
    // A value stored by an older build may name a preset that no longer
    // exists, so it is checked against the list rather than trusted.
    const stored = getInsightsRange();
    return RANGE_OPTIONS.some((option) => option.value === stored)
      ? (stored as PeriodChoice)
      : DEFAULT_RANGE;
  });
  /** The hand-picked range, kept even while a preset is in force. */
  const [custom, setCustom] = useState<Period | null>(() => getInsightsCustom() as Period | null);
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  const { unit, count, shift } = rangeOf(range);

  /**
   * Choosing "Custom" with nothing picked yet starts from what is on screen,
   * so the charts do not empty while waiting for two taps in a calendar.
   */
  const chooseRange = (next: PeriodChoice) => {
    if (next === 'custom' && custom === null && data) {
      setCustom(data.period);
      setInsightsCustom(data.period);
    }
    setRange(next);
    setInsightsRange(next);
  };

  const load = useCallback(async () => {
    const db = await getDb();

    // Anchor on the newest bill, not on today: a ledger whose last bill was
    // two months ago should still show something rather than an empty "this
    // month". Weeks need the day, not just the month, so this reads the range
    // rather than `getLatestMonth`.
    const dataRange = await getDataRange(db);
    const anchorDate = dataRange.lastBill ?? todayLocalDate();

    /**
     * The whole ledger, when "All" is chosen.
     *
     * Read from the data rather than left unbounded, so every query below
     * keeps its existing shape and the header can say which months are
     * actually covered. An empty ledger has no span to report, so it falls
     * through to the anchor and the screen shows its empty state.
     */
    const everything: Period | null =
      range === 'all' && dataRange.firstBill && dataRange.lastBill
        ? { from: dataRange.firstBill, to: dataRange.lastBill }
        : null;

    // Null unless a hand-picked range is the one in force, which keeps the
    // three lines below narrow enough for the type checker and honest about
    // what is driving the screen. "All" joins it: both are spans rather than
    // trailing windows, and the trend has to be told their unit.
    const picked = everything ?? (range === 'custom' ? custom : null);

    // "Last week" steps the anchor back a whole week before the window is
    // taken; every other preset ends at the anchor itself.
    const presetAnchor = shift ? addDays(anchorDate, shift * 7) : anchorDate;

    const period =
      picked ??
      (unit === 'week'
        ? periodOfLastWeeks(count, presetAnchor)
        : periodOfLastMonths(count, anchorDate));

    // A preset carries its own unit — "last 4 weeks" is weekly by
    // construction — while an arbitrary range has to be told, and its trend
    // ends where the range does rather than at the newest bill in the ledger.
    const trendUnit = picked ? trendUnitFor(picked) : unit;
    const trendCount = picked ? trendCountFor(picked, trendUnit) : count;
    const trendAnchor = picked ? picked.to : presetAnchor;

    const [summary, breakdown, merchants, locations, trend] = await Promise.all([
      getSpendSummary(db, period),
      getCategoryBreakdown(db, period),
      getMerchantBreakdown(db, period, 6),
      // Eight is the point where pins in one suburb start to overlap more than
      // they inform; the donut below still covers the rest.
      getMerchantLocations(db, period, 8),
      trendUnit === 'week'
        ? getWeeklyTrend(db, trendCount, trendAnchor).then((weeks) =>
            weeks.map((week) => ({
              label: formatDayMonth(week.weekStart),
              totalCents: week.totalCents,
            }))
          )
        : getMonthlyTrend(db, trendCount, monthOf(trendAnchor)).then((months) =>
            months.map((month) => ({
              label: formatMonthShort(month.month),
              totalCents: month.totalCents,
            }))
          ),
    ]);

    setData({
      summary,
      breakdown,
      merchants,
      locations,
      trend,
      period,
      hasAnyBills: dataRange.lastBill !== null,
      trendUnit,
    });
    setLoading(false);
  }, [unit, count, shift, range, custom]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const chartWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2 - Spacing.four * 2;
  // The chart sits inside a padded card; the map *is* the card, so it only
  // gives up the screen's own side padding.
  const mapWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2;

  const chart = useMemo(() => {
    if (!data) return null;
    const max = Math.max(...data.trend.map((bar) => bar.totalCents), 0);
    const step = max > 0 ? Math.ceil(max / 4) : 1;
    return {
      max: step * 4,
      labels: Array.from({ length: 5 }, (_, i) =>
        formatMoneyCompact(step * i, data.summary.currency)
      ),
      bars: data.trend.map((bar) => ({
        value: bar.totalCents / 100,
        label: bar.label,
        frontColor: theme.primary,
      })),
    };
  }, [data, theme.primary]);

  if (loading || !data || !chart) {
    return (
      <Screen>
        <Header />
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!data.hasAnyBills) {
    return (
      <Screen>
        <Header />
        <EmptyState
          title="Nothing to summarise yet"
          message="Add a bill and your spending by category, merchant and month will appear here."
          actionLabel="Add a bill"
          onAction={() => router.push('/bill/new')}
        />
      </Screen>
    );
  }

  const { summary, breakdown, merchants, locations, period } = data;

  // The remainder is marked neutral so the slice builder never folds it away —
  // it is where §14.6's undercount becomes visible.
  const categoryEntries: SliceInput[] = [
    ...breakdown.categories.map((entry) => ({
      key: entry.category,
      label: CATEGORY_LABELS[entry.category],
      valueCents: entry.totalCents,
    })),
    ...(breakdown.unitemisedCents > 0
      ? [
          {
            key: 'unitemised',
            label: 'Not itemised',
            valueCents: breakdown.unitemisedCents,
            neutral: true,
          },
        ]
      : []),
  ];

  const merchantEntries: SliceInput[] = merchants.map((merchant) => ({
    key: merchant.merchantNorm ?? 'unnamed',
    label: merchant.merchant ?? 'Unnamed merchant',
    valueCents: merchant.totalCents,
  }));

  // The merchant query returns the top few, so its donut is a whole of what is
  // shown, not of all spending. Labelling it with the period total would claim
  // a share it does not have.
  const merchantTotal = merchantEntries.reduce((sum, entry) => sum + entry.valueCents, 0);

  /**
   * The period travels with the drill-down rather than being recomputed there.
   * It is anchored on the newest month that has data, so a screen that derived
   * it again would disagree with the figure the user just tapped as soon as a
   * bill landed in another tab.
   */
  const openBreakdown = (dimension: BreakdownDimension, key: string, label: string) =>
    router.push({
      pathname: '/insights/breakdown',
      params: {
        dimension,
        key,
        label,
        from: period.from,
        to: period.to,
        currency: summary.currency,
      },
    });

  return (
    <Screen>
      <Header />
      <ScrollView
        scrollEnabled={!mapDragging}
        contentContainerStyle={[styles.content, { paddingBottom: tabBarInset + Spacing.seven }]}>
        {/*
          One row, two ways to say the same thing: the ladder of presets on the
          left for the common cases, a calendar on the right for everything
          else. Picking dates switches the left-hand control to "Custom", so
          the pair cannot disagree about what the charts are showing.
        */}
        <View style={styles.periodRow}>
          <View style={styles.periodPreset}>
            <SelectMenu
              label="Period"
              options={RANGE_OPTIONS}
              value={range}
              onChange={chooseRange}
            />
          </View>

          <DateRangeField
            label="Or pick dates"
            value={custom}
            onChange={(picked) => {
              setCustom(picked);
              setInsightsCustom(picked);
              setRange('custom');
              setInsightsRange('custom');
            }}
            maxDate={todayLocalDate()}
          />
        </View>

        <ThemedText type="small" themeColor="textSecondary">
          {/* Whole days for a week range: "September 2026 – September 2026" is
              both wrong-looking and less informative than the dates. */}
          {data.trendUnit === 'week'
            ? `${formatDayMonth(period.from)} – ${formatDate(period.to)}`
            : `${formatMonth(monthOf(period.from))} – ${formatMonth(monthOf(period.to))}`}
        </ThemedText>

        {summary.billCount === 0 ? (
          <EmptyState
            title="No bills in this period"
            message="Try a longer period, or add a bill for these months."
          />
        ) : (
          <>
            <View style={styles.tiles}>
              <StatTile
                label="Total spend"
                value={formatMoney(summary.totalCents, summary.currency)}
              />
              <StatTile
                label="Bills"
                value={String(summary.billCount)}
                caption={`${summary.itemCount} item${summary.itemCount === 1 ? '' : 's'}`}
              />
              <StatTile
                label="Average bill"
                value={formatMoney(summary.averageBillCents, summary.currency)}
              />
            </View>

            <Section title={data.trendUnit === 'week' ? 'Week by week' : 'Month by month'}>
              <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                <BarChart
                  data={chart.bars}
                  width={chartWidth}
                  height={160}
                  barWidth={Math.max(10, chartWidth / (chart.bars.length * 2))}
                  spacing={Math.max(6, chartWidth / (chart.bars.length * 4))}
                  initialSpacing={Spacing.three}
                  maxValue={chart.max / 100}
                  noOfSections={4}
                  yAxisLabelTexts={chart.labels}
                  yAxisTextStyle={{ color: theme.textSecondary, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: theme.textSecondary, fontSize: 10 }}
                  yAxisColor={theme.border}
                  xAxisColor={theme.border}
                  rulesColor={theme.border}
                  barBorderTopLeftRadius={3}
                  barBorderTopRightRadius={3}
                  isAnimated={false}
                />
              </View>
            </Section>

            <Section
              title="By category"
              caption={
                breakdown.unitemisedCents !== 0
                  ? 'Categories come from line items, so bills with no items sit in “Not itemised”.'
                  : undefined
              }>
              <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                <DonutBreakdown
                  entries={categoryEntries}
                  currency={summary.currency}
                  totalCents={breakdown.totalCents}
                  emptyMessage="No itemised spending in this period."
                  onSelect={(slice) =>
                    openBreakdown(
                      // The remainder is not a category, so it drills into
                      // bills-and-shortfalls rather than into items.
                      slice.key === 'unitemised' ? 'unitemised' : 'category',
                      slice.key,
                      slice.label
                    )
                  }
                />
              </View>

              {breakdown.unitemisedCents < 0 && (
                <ThemedText type="small" themeColor="warning">
                  Line items add up to{' '}
                  {formatMoney(-breakdown.unitemisedCents, summary.currency)} more than the printed
                  totals. Worth checking those bills.
                </ThemedText>
              )}
            </Section>

            {/*
              Where the money went, above the breakdown of how much. Absent
              entirely when map previews are switched off (§4.14) — the same
              silent treatment the bill screen gives it, rather than a second
              way of explaining one setting.
            */}
            {previewsOn && locations.length > 0 && mapWidth > 0 && (
              <Section
                title="Where you shopped"
                caption="Each pin's size is that shop's share of the mapped spending. Tap one to see its bills.">
                <MerchantMap
                  locations={locations}
                  width={mapWidth}
                  currency={summary.currency}
                  onDragChange={setMapDragging}
                  onSelect={(merchantNorm, label) =>
                    openBreakdown('merchant', merchantNorm ?? 'unnamed', label)
                  }
                />
              </Section>
            )}

            <Section title="Top merchants">
              <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
                <DonutBreakdown
                  entries={merchantEntries}
                  currency={summary.currency}
                  totalCents={merchantTotal}
                  totalLabel={`top ${merchantEntries.length}`}
                  foldedLabel="Other merchants"
                  emptyMessage="No merchants recorded in this period."
                  onSelect={(slice) => {
                    // The slice key stands in for a NULL merchant_norm, which
                    // a route parameter cannot carry; the query takes '' back
                    // to NULL. Looked up rather than reversed, so a merchant
                    // that genuinely normalises to "unnamed" is not confused
                    // with the bills that recorded no merchant at all.
                    const match = merchants.find(
                      (entry) => (entry.merchantNorm ?? 'unnamed') === slice.key
                    );
                    openBreakdown('merchant', match?.merchantNorm ?? '', slice.label);
                  }}
                />
              </View>
            </Section>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <ThemedText type="title">Insights</ThemedText>
    </View>
  );
}

function Section({
  title,
  caption,
  children,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText type="sectionHeader" themeColor="textSecondary">
        {title}
      </ThemedText>
      {caption && (
        <ThemedText type="small" themeColor="textSecondary">
          {caption}
        </ThemedText>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.four, paddingBottom: Spacing.two },
  // `paddingBottom` is applied at the call site, where the tab bar's
  // height is known.
  content: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: Spacing.three },
  periodRow: { flexDirection: 'row', gap: Spacing.three },
  periodPreset: { flex: 1 },
  section: { gap: Spacing.two, marginTop: Spacing.three },
  card: { borderRadius: Radius.medium, padding: Spacing.four, paddingRight: Spacing.two },
});
