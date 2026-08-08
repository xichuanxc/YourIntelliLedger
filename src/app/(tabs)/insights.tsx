import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import {
  formatMonth,
  formatMonthShort,
  monthOf,
  periodOfLastMonths,
  todayLocalDate,
  type Period,
} from '@/data/dates';
import { getDb } from '@/data/db';
import {
  getCategoryBreakdown,
  getLatestMonth,
  getMerchantBreakdown,
  getMonthlyTrend,
  getSpendSummary,
} from '@/data/insightsRepo';
import { formatMoney, formatMoneyCompact } from '@/data/money';
import type { CategoryBreakdown, MerchantTotal, MonthTotal, SpendSummary } from '@/types/insights';
import { CATEGORY_LABELS } from '@/types/vocabulary';
import type { BreakdownDimension } from '@/app/insights/breakdown';
import { DonutBreakdown } from '@/ui/components/donut-breakdown';
import type { SliceInput } from '@/ui/chartSlices';
import { ChipSelect } from '@/ui/components/chip-select';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { StatTile } from '@/ui/components/stat-tile';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { MaxContentWidth, Radius, Spacing } from '@/ui/theme';

const RANGES = ['1', '3', '12'] as const;
type RangeKey = (typeof RANGES)[number];

const RANGE_LABELS: Record<RangeKey, string> = {
  '1': 'This month',
  '3': 'Last 3 months',
  '12': 'Last 12 months',
};

interface InsightsData {
  summary: SpendSummary;
  breakdown: CategoryBreakdown;
  merchants: MerchantTotal[];
  trend: MonthTotal[];
  period: Period;
  hasAnyBills: boolean;
}

export default function InsightsScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();

  const [range, setRange] = useState<RangeKey>('3');
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);

  const months = Number(range);

  const load = useCallback(async () => {
    const db = await getDb();

    // Anchor on the newest month that has data, not on today: a ledger whose
    // last bill was two months ago should still show something rather than an
    // empty "this month".
    const latest = await getLatestMonth(db);
    const anchorMonth = latest ?? monthOf(todayLocalDate());
    const period = periodOfLastMonths(months, `${anchorMonth}-01`);

    const [summary, breakdown, merchants, trend] = await Promise.all([
      getSpendSummary(db, period),
      getCategoryBreakdown(db, period),
      getMerchantBreakdown(db, period, 6),
      getMonthlyTrend(db, months, anchorMonth),
    ]);

    setData({ summary, breakdown, merchants, trend, period, hasAnyBills: latest !== null });
    setLoading(false);
  }, [months]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const chartWidth = Math.min(width, MaxContentWidth) - Spacing.four * 2 - Spacing.four * 2;

  const chart = useMemo(() => {
    if (!data) return null;
    const max = Math.max(...data.trend.map((m) => m.totalCents), 0);
    const step = max > 0 ? Math.ceil(max / 4) : 1;
    return {
      max: step * 4,
      labels: Array.from({ length: 5 }, (_, i) =>
        formatMoneyCompact(step * i, data.summary.currency)
      ),
      bars: data.trend.map((month) => ({
        value: month.totalCents / 100,
        label: formatMonthShort(month.month),
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

  const { summary, breakdown, merchants, period } = data;

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
      <ScrollView contentContainerStyle={styles.content}>
        <ChipSelect
          label="Period"
          options={RANGES}
          labels={RANGE_LABELS}
          value={range}
          onChange={setRange}
          scroll
        />

        <ThemedText type="small" themeColor="textSecondary">
          {formatMonth(monthOf(period.from))} – {formatMonth(monthOf(period.to))}
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

            <Section title="Month by month">
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
  content: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four, paddingBottom: Spacing.seven },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tiles: { flexDirection: 'row', gap: Spacing.three },
  section: { gap: Spacing.two, marginTop: Spacing.three },
  card: { borderRadius: Radius.medium, padding: Spacing.four, paddingRight: Spacing.two },
});
