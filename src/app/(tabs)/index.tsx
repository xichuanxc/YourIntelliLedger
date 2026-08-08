import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  SectionList,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { seedCorpus } from '@/data/corpus';
import { formatDate, formatMonth } from '@/data/dates';
import { getDb } from '@/data/db';
import { formatMoney } from '@/data/money';
import type { BillSummary } from '@/types/ledger';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { GearIcon } from '@/ui/components/gear-icon';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { useLedgerStore } from '@/ui/stores/ledger-store';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

export default function LedgerScreen() {
  const theme = useTheme();
  const { months, status, search, error, setSearch, refresh } = useLedgerStore();

  // Refetch on focus rather than on mount: returning from the edit or capture
  // screen has to show the change, and those screens are separate routes.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const sections = useMemo(
    () =>
      months.map((month) => ({
        title: month.month,
        totalCents: month.totalCents,
        currency: month.bills[0]?.currency ?? 'NZD',
        data: month.bills,
      })),
    [months]
  );

  const searching = search.trim().length > 0;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <ThemedText type="title">Ledger</ThemedText>
          <Pressable
            onPress={() => router.push('/settings')}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            hitSlop={12}
            style={styles.gear}>
            <GearIcon />
          </Pressable>
        </View>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search merchant or item"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Search bills by merchant or item name"
          autoCorrect={false}
          clearButtonMode="while-editing"
          style={[
            styles.search,
            { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.border },
          ]}
        />
        <DevSeedButton />
      </View>

      {error ? (
        <EmptyState
          title="Something went wrong"
          message={error}
          actionLabel="Try again"
          onAction={() => void refresh()}
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(bill) => String(bill.id)}
          contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <ThemedText type="sectionHeader" themeColor="textSecondary">
                {formatMonth(section.title)}
              </ThemedText>
              <ThemedText type="amount" themeColor="textSecondary">
                {formatMoney(section.totalCents, section.currency)}
              </ThemedText>
            </View>
          )}
          renderItem={({ item }) => <BillRow bill={item} />}
          ListEmptyComponent={
            status === 'loading' ? null : searching ? (
              <EmptyState
                title="No matches"
                message={`Nothing in your ledger matches “${search.trim()}”. Try a shorter search, or part of an item name.`}
              />
            ) : (
              <EmptyState
                title="No bills yet"
                message="Scan a receipt to record it automatically, or add a bill by hand."
                actionLabel="Add a receipt"
                onAction={() => router.push('/capture')}
              />
            )
          }
        />
      )}

      <AddBillAction />
    </Screen>
  );
}

function BillRow({ bill }: { bill: BillSummary }) {
  const theme = useTheme();
  const itemSummary =
    bill.itemCount === 0 ? 'No itemised lines' : `${bill.itemCount} item${bill.itemCount === 1 ? '' : 's'}`;

  return (
    <Pressable
      onPress={() => router.push(`/bill/${bill.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`${bill.merchant ?? 'Unnamed merchant'}, ${formatDate(bill.purchasedAt)}, ${formatMoney(bill.totalCents, bill.currency)}, ${itemSummary}`}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <View style={styles.rowMain}>
        <ThemedText numberOfLines={1} style={styles.merchant}>
          {bill.merchant ?? 'Unnamed merchant'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {formatDate(bill.purchasedAt)} · {itemSummary}
        </ThemedText>
      </View>
      <View style={styles.rowTrailing}>
        <ThemedText type="amount">{formatMoney(bill.totalCents, bill.currency)}</ThemedText>
        {bill.parseFlags.length > 0 && (
          <ThemedText type="small" themeColor="warning" accessibilityLabel="Needs review">
            Needs review
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

/**
 * Loads the eleven-receipt prototype corpus, replacing whatever is stored.
 *
 * Development only — `__DEV__` is false in release builds, so this never ships.
 * The user-facing import is §15.1, in Week 9. It confirms first because it
 * deletes every existing bill and there is no export to undo that yet.
 */
function DevSeedButton() {
  const refresh = useLedgerStore((state) => state.refresh);
  const [busy, setBusy] = useState(false);

  if (!__DEV__) return null;

  const run = () => {
    Alert.alert(
      'Load sample receipts?',
      'This deletes every bill currently stored and loads the 11 prototype receipts. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Replace',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const db = await getDb();
              const result = await seedCorpus(db, { replaceExisting: true });
              await refresh();
              Alert.alert(
                'Sample data loaded',
                `${result.billsInserted} bills, ${result.itemsInserted} items, ` +
                  `${result.pagesInserted} pages of OCR text. ` +
                  `${result.deleted} previous bill${result.deleted === 1 ? '' : 's'} removed.`
              );
            } catch (error) {
              Alert.alert(
                'Could not load sample data',
                error instanceof Error ? error.message : String(error)
              );
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  return (
    <Button label="Load sample receipts (dev)" variant="secondary" onPress={run} busy={busy} />
  );
}

/**
 * The primary action is deliberately not unified (§7): a floating action
 * button on Android, a bottom-anchored button on iOS.
 */
function AddBillAction() {
  const theme = useTheme();
  // Capture is the primary way in now; manual entry is offered inside it.
  const onPress = () => router.push('/capture');

  if (Platform.OS === 'android') {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Add a bill"
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
        ]}>
        <ThemedText style={[styles.fabGlyph, { color: theme.textInverse }]}>+</ThemedText>
      </Pressable>
    );
  }

  return (
    <View style={styles.bottomAction}>
      <Button label="Add a bill" onPress={onPress} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.four, gap: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  gear: { minWidth: MinTouchTarget, minHeight: MinTouchTarget, alignItems: 'flex-end', justifyContent: 'center' },
  search: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    fontSize: 16,
  },
  listContent: { paddingHorizontal: Spacing.four, paddingBottom: Spacing.seven * 2 },
  emptyContainer: { flexGrow: 1 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Spacing.five,
    paddingBottom: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Radius.medium,
    padding: Spacing.four,
    marginBottom: Spacing.two,
    minHeight: MinTouchTarget,
  },
  rowMain: { flex: 1, gap: Spacing.half },
  rowTrailing: { alignItems: 'flex-end', gap: Spacing.half },
  merchant: { fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: Spacing.four,
    bottom: Spacing.five,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabGlyph: { fontSize: 30, lineHeight: 34, fontWeight: '400' },
  bottomAction: { padding: Spacing.four, paddingBottom: Spacing.five },
});
