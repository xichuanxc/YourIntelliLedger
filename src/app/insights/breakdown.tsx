/**
 * What is behind one slice of an Insights donut (§7).
 *
 * One screen for all three drill-downs, because they answer the same question
 * — "what makes up this figure, and when" — and differ only in what a row is:
 *
 *  - **category** → items, since categories live on `bill_items` (§4.7)
 *  - **merchant** → bills, since merchants live on `bills` (§4.8)
 *  - **unitemised** → bills again, but showing each one's *shortfall* rather
 *    than its total. The remainder is `total − itemised` across the period
 *    (§14.6); per bill it is the same subtraction, which is why this is not
 *    simply "bills with no items".
 *  - **categories** → the categories a donut folded into one wedge, since
 *    "Everything else" is a sum over several and has no items of its own.
 *    Its rows lead here again, one category at a time, which is the only
 *    drill-down in the app that is two deep — and has to be, because the
 *    wedge is one level of aggregation above everything else on the screen.
 *
 * Every row leads to the bill it came from, so the drill-down bottoms out
 * somewhere useful rather than in a dead-end list.
 *
 * The period arrives as parameters rather than being recomputed here. Insights
 * anchors its window on the newest month that has data, so deriving it again
 * would silently disagree with the figure the user just tapped the moment a
 * bill is added in another tab.
 */

import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { formatDate } from '@/data/dates';
import { getDb } from '@/data/db';
import {
  getCategoryBreakdown,
  getCategoryItems,
  getMerchantBills,
  getUnitemisedBills,
} from '@/data/insightsRepo';
import { formatMoney, formatQuantity } from '@/data/money';
import type { CategoryItem, MerchantBill, UnitemisedBill } from '@/types/insights';
import type { Category } from '@/types/vocabulary';
import { CATEGORY_LABELS, UNIT_LABELS, isCategory } from '@/types/vocabulary';
import { ChevronRightIcon } from '@/ui/components/chevron-icon';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { headlineCase } from '@/ui/headlineCase';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export type BreakdownDimension = 'category' | 'merchant' | 'unitemised' | 'categories';

interface Params {
  dimension: BreakdownDimension;
  /**
   * Category value, or merchant_norm — or, for `categories`, the folded
   * categories as a comma-separated list. Empty string means SQL NULL.
   */
  key: string;
  /** What the legend row said, so the header matches what was tapped. */
  label: string;
  from: string;
  to: string;
  currency: string;
}

interface CategoryTotal {
  category: Category;
  totalCents: number;
  itemCount: number;
}

type Rows =
  | { kind: 'category'; rows: CategoryItem[] }
  | { kind: 'bills'; rows: MerchantBill[] }
  | { kind: 'unitemised'; rows: UnitemisedBill[] }
  | { kind: 'categories'; rows: CategoryTotal[] };

/**
 * The categories a wedge folded, with their totals, biggest first.
 *
 * Recomputed from the database rather than carried through the parameters:
 * the amounts are already on screen when the wedge is tapped, but a figure
 * that travelled through a URL is a figure that can disagree with the ledger
 * the moment a bill changes. The keys travel; the money is looked up.
 *
 * Anything in the parameter that is not a category this build knows is
 * dropped: the list comes from a chart drawn by some version of the app, and
 * an unknown value is not worth a crash.
 */
async function foldedCategories(
  db: Awaited<ReturnType<typeof getDb>>,
  period: { from: string; to: string },
  keys: string
): Promise<CategoryTotal[]> {
  const wanted = new Set(keys.split(',').filter(isCategory));
  const breakdown = await getCategoryBreakdown(db, period);

  return breakdown.categories
    .filter((entry) => wanted.has(entry.category))
    .map((entry) => ({
      category: entry.category,
      totalCents: entry.totalCents,
      itemCount: entry.itemCount,
    }));
}

export default function BreakdownScreen() {
  const { dimension, key, label, from, to, currency } = useLocalSearchParams<
    Record<keyof Params, string>
  >();
  const navigation = useNavigation();

  const [data, setData] = useState<Rows | null>(null);

  useEffect(() => {
    navigation.setOptions({ title: label });
  }, [navigation, label]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const db = await getDb();
      const period = { from, to };

      const loaded: Rows =
        dimension === 'category'
          ? { kind: 'category', rows: await getCategoryItems(db, period, key as Category) }
          : dimension === 'merchant'
            ? // An empty parameter is how a NULL merchant_norm survives the
              // round trip through the URL — it cannot carry null itself.
              { kind: 'bills', rows: await getMerchantBills(db, period, key === '' ? null : key) }
            : dimension === 'categories'
              ? { kind: 'categories', rows: await foldedCategories(db, period, key) }
              : { kind: 'unitemised', rows: await getUnitemisedBills(db, period) };

      if (!cancelled) setData(loaded);
    })();

    return () => {
      cancelled = true;
    };
  }, [dimension, key, from, to]);

  const openBill = useCallback((billId: number) => router.push(`/bill/${billId}`), []);

  /** One of the folded categories, on this same screen a level down. */
  const openCategory = useCallback(
    (category: Category, categoryLabel: string) =>
      router.push({
        pathname: '/insights/breakdown',
        params: { dimension: 'category', key: category, label: categoryLabel, from, to, currency },
      }),
    [from, to, currency]
  );

  if (!data) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  const total =
    data.kind === 'category'
      ? data.rows.reduce((sum, row) => sum + (row.priceCents ?? 0), 0)
      : data.kind === 'bills' || data.kind === 'categories'
        ? data.rows.reduce((sum, row) => sum + row.totalCents, 0)
        : data.rows.reduce((sum, row) => sum + row.remainderCents, 0);

  if (data.rows.length === 0) {
    return (
      <Screen edges={['left', 'right', 'bottom']}>
        <EmptyState
          title="Nothing here"
          message="These lines may have been edited or deleted since the chart was drawn."
        />
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <ThemedText type="amountLarge">{formatMoney(total, currency)}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {countLabel(data)} · {formatDate(from)} – {formatDate(to)}
          </ThemedText>
        </View>

        {data.kind === 'unitemised' && (
          <ThemedText type="small" themeColor="textSecondary">
            The part of each bill its line items do not account for — an itemless receipt, a
            discount, or a price too faint to read.
          </ThemedText>
        )}

        {data.kind === 'categories' && (
          <ThemedText type="small" themeColor="textSecondary">
            The categories the chart grouped together, because a donut stops being readable past
            about six wedges. Tap one for its items.
          </ThemedText>
        )}

        <View style={styles.rows}>
          {data.kind === 'category' &&
            data.rows.map((row, index) => (
              <Row
                key={`${row.billId}-${row.name}-${index}`}
                onPress={() => openBill(row.billId)}
                title={headlineCase(row.name)}
                subtitle={`${formatDate(row.purchasedAt)} · ${
                  row.merchant ? headlineCase(row.merchant) : 'Unnamed merchant'
                } · ${formatQuantity(row.qty)} ${UNIT_LABELS[row.unit]}`}
                amount={
                  row.priceCents == null ? null : formatMoney(row.priceCents, currency)
                }
              />
            ))}

          {data.kind === 'bills' &&
            data.rows.map((row) => (
              <Row
                key={row.billId}
                onPress={() => openBill(row.billId)}
                title={formatDate(row.purchasedAt)}
                subtitle={`${row.itemCount} item${row.itemCount === 1 ? '' : 's'}`}
                amount={formatMoney(row.totalCents, currency)}
              />
            ))}

          {data.kind === 'categories' &&
            data.rows.map((row) => (
              <Row
                key={row.category}
                onPress={() => openCategory(row.category, CATEGORY_LABELS[row.category])}
                title={CATEGORY_LABELS[row.category]}
                subtitle={`${row.itemCount} item${row.itemCount === 1 ? '' : 's'}`}
                amount={formatMoney(row.totalCents, currency)}
              />
            ))}

          {data.kind === 'unitemised' &&
            data.rows.map((row) => (
              <Row
                key={row.billId}
                onPress={() => openBill(row.billId)}
                title={row.merchant ? headlineCase(row.merchant) : 'Unnamed merchant'}
                subtitle={`${formatDate(row.purchasedAt)} · ${formatMoney(row.totalCents, currency)} total, ${
                  row.itemisedCents === 0
                    ? 'no items'
                    : `${formatMoney(row.itemisedCents, currency)} itemised`
                }`}
                amount={formatMoney(row.remainderCents, currency)}
              />
            ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

function countLabel(data: Rows): string {
  const n = data.rows.length;
  const noun = data.kind === 'category' ? 'item' : data.kind === 'categories' ? 'category' : 'bill';
  const plural = data.kind === 'categories' ? 'categories' : `${noun}s`;
  return `${n} ${n === 1 ? noun : plural}`;
}

function Row({
  title,
  subtitle,
  amount,
  onPress,
}: {
  title: string;
  subtitle: string;
  /** NULL for an illegible price (§4.3) — shown as such, never as zero. */
  amount: string | null;
  onPress: () => void;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${subtitle}, ${amount ?? 'price illegible'}`}
      accessibilityHint="Opens the bill this came from"
      style={({ pressed }) => [
        styles.row,
        { borderColor: theme.border },
        pressed && { backgroundColor: theme.backgroundSelected },
      ]}>
      <View style={styles.rowMain}>
        <ThemedText numberOfLines={2}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {subtitle}
        </ThemedText>
      </View>
      {amount === null ? (
        <ThemedText type="small" themeColor="warning">
          Illegible
        </ThemedText>
      ) : (
        <ThemedText type="amount">{amount}</ThemedText>
      )}
      <ChevronRightIcon />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.seven },
  summary: { gap: Spacing.one },
  rows: { gap: Spacing.one },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.two,
    marginHorizontal: -Spacing.two,
    borderRadius: Radius.small,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { flex: 1, gap: Spacing.half },
});
