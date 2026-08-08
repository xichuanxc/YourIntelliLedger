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
import { deleteAllBills } from '@/data/ledgerRepo';
import { formatMoney } from '@/data/money';
import { clearQueryLog } from '@/data/telemetryRepo';
import { clearGeocodeCache } from '@/maps/geocodeCache';
import type { BillSummary } from '@/types/ledger';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { GearIcon } from '@/ui/components/gear-icon';
import { PlusIcon } from '@/ui/components/plus-icon';
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
          <View style={styles.headerActions}>
            {/* §7's primary action, iOS half: a header action. Android gets a
                floating action button instead — see AddBillAction. */}
            {Platform.OS !== 'android' && (
              <Pressable
                onPress={() => router.push('/capture')}
                accessibilityRole="button"
                accessibilityLabel="Add a bill"
                hitSlop={12}
                style={styles.headerButton}>
                <PlusIcon />
              </Pressable>
            )}
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={12}
              style={styles.headerButton}>
              <GearIcon />
            </Pressable>
          </View>
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
        <DevTools />
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
 * Development-only tools. `__DEV__` is false in release builds, so neither of
 * these ships. The user-facing import and delete-all are §15.1 and §15.2, in
 * Week 9, and they arrive together so there is always a backup first.
 *
 * Two buttons rather than one because they are genuinely two operations, and
 * each is now idempotent on its own terms: loading is additive, so it no
 * longer destroys a receipt you captured by hand to test the parser, and
 * clearing is the only thing that deletes. Loading twice gives you the corpus
 * twice — clear first if you want exactly eleven.
 */
function DevTools() {
  if (!__DEV__) return null;

  return (
    <View style={styles.devToolsBlock}>
      {/* The marker moved out of the labels: "(dev)" on each button wrapped
          them onto two lines, and saying it once is clearer anyway. */}
      <ThemedText type="small" themeColor="textSecondary">
        Development only — not in release builds
      </ThemedText>
      <View style={styles.devTools}>
        <DevSeedButton />
        <DevClearButton />
      </View>
    </View>
  );
}

function DevSeedButton() {
  const refresh = useLedgerStore((state) => state.refresh);
  const [busy, setBusy] = useState(false);

  const run = () => {
    Alert.alert(
      'Load sample receipts?',
      'Adds the 11 prototype receipts to whatever is already stored. Nothing is deleted — use Clear all data for that.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load',
          onPress: async () => {
            setBusy(true);
            try {
              const db = await getDb();
              const result = await seedCorpus(db);
              await refresh();
              Alert.alert(
                'Sample data loaded',
                `${result.billsInserted} bills, ${result.itemsInserted} items, ` +
                  `${result.pagesInserted} pages of OCR text.`
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

  return <Button label="Load samples" variant="secondary" onPress={run} busy={busy} style={styles.flex} />;
}

/**
 * Empties the ledger and everything derived from it.
 *
 * "All data" is taken literally for anything that came off a receipt — the
 * bills, their items and OCR pages by cascade, the coordinates cached from
 * their addresses, and the local usage log. It deliberately does **not** touch
 * settings: wiping the API key on every reset would make this unusable in the
 * one situation it exists for.
 */
function DevClearButton() {
  const refresh = useLedgerStore((state) => state.refresh);
  const [busy, setBusy] = useState(false);

  const run = () => {
    Alert.alert(
      'Clear all data?',
      'Deletes every bill, its items and captured text, the cached map coordinates, and this month’s usage log. Your API key and settings are kept. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              const db = await getDb();
              const deleted = await deleteAllBills(db);
              await clearQueryLog(db);
              // Coordinates are derived from bill addresses, so they are bill
              // data — and a stale cached miss would outlive the bill that
              // produced it (see geocodeCache's version note).
              clearGeocodeCache();
              await refresh();
              Alert.alert(
                'Cleared',
                `${deleted} bill${deleted === 1 ? '' : 's'} deleted, along with their items and captured text.`
              );
            } catch (error) {
              Alert.alert(
                'Could not clear data',
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

  return <Button label="Clear all data" variant="danger" onPress={run} busy={busy} style={styles.flex} />;
}

/**
 * The primary action is deliberately not unified (§7): a floating action
 * button on Android, a header action on iOS (rendered up in the title row).
 *
 * ## Why iOS is not a bottom-anchored button
 *
 * §7 offers "header action / bottom-anchored button" for iOS, and this was
 * the bottom button until it was seen on a device: UIKit's tab bar is
 * translucent and the screen's content extends *underneath* it, so the button
 * sat behind Ledger/Ask/Insights. Android does not have the problem — its tab
 * bar is a sibling view below the content, not an overlay.
 *
 * Padding it clear would need the tab bar's height, and
 * `expo-router/unstable-native-tabs` exposes no hook for it; hardcoding ~49pt
 * would break under the tab bar's minimize behaviour and at larger text sizes.
 * Stacking a full-width button directly above a tab bar is also poor iOS
 * form — hence the header action, which §7 lists first for iOS anyway.
 *
 * This is exactly the defect class §7 warns about: "back-gesture handling and
 * safe-area insets are not optional — they are the two most common
 * cross-platform defects".
 */
function AddBillAction() {
  const theme = useTheme();

  // iOS renders its primary action in the header, so nothing goes here.
  if (Platform.OS !== 'android') return null;

  return (
    <Pressable
      // Capture is the primary way in now; manual entry is offered inside it.
      onPress={() => router.push('/capture')}
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

const styles = StyleSheet.create({
  header: { padding: Spacing.four, gap: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  headerButton: {
    minWidth: MinTouchTarget,
    minHeight: MinTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    minHeight: MinTouchTarget,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.four,
    fontSize: 16,
  },
  flex: { flex: 1 },
  devToolsBlock: { gap: Spacing.two },
  devTools: { flexDirection: 'row', gap: Spacing.three },
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
});
