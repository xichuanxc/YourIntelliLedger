import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { EmptyState } from '@/ui/components/empty-state';
import { ClearDataIcon, LoadSamplesIcon } from '@/ui/components/dev-icons';
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
          <View style={styles.headerActions}>
            <DevTools />
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
    <>
      <DevSeedButton />
      <DevClearButton />
    </>
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

  return (
    <Pressable
      onPress={run}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Load sample receipts (development only)"
      hitSlop={8}
      style={[styles.headerButton, busy && styles.busy]}>
      <LoadSamplesIcon />
    </Pressable>
  );
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

  return (
    <Pressable
      onPress={run}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Clear all data (development only)"
      hitSlop={8}
      style={[styles.headerButton, busy && styles.busy]}>
      <ClearDataIcon />
    </Pressable>
  );
}

/**
 * A floating action button, on both platforms.
 *
 * §7 lists "floating action button" for Android and "header action /
 * bottom-anchored button" for iOS. A FAB on iOS is a third thing, chosen
 * because the same control in the same place on both is easier to use than a
 * pedantic reading of the table, and §7's own note allows it: "using a single
 * generic look on both platforms is acceptable for v1".
 *
 * ## Clearing the tab bar
 *
 * UIKit's tab bar is translucent and the screen's content runs *underneath*
 * it, so anything anchored to the bottom of the screen on iOS is drawn in
 * occupied space. Android has no such problem: its tab bar is a sibling view
 * below the content.
 *
 * `expo-router/unstable-native-tabs` exposes no tab-bar-height hook, so the
 * offset below is arithmetic over a known constant. That was not good enough
 * for the full-width button this replaces — getting it wrong there meant a
 * control that was completely invisible — but a FAB fails softly: a wrong
 * constant moves it a few points, it never disappears. Different stakes,
 * different answer.
 */

/**
 * UIKit's standard tab bar, excluding the home indicator area, which
 * `useSafeAreaInsets` reports separately and which is 0 on a device without
 * one (an iPhone SE, for instance).
 */
const IOS_TAB_BAR_HEIGHT = 49;

function AddBillAction() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const bottom =
    Platform.OS === 'android'
      ? Spacing.five
      : insets.bottom + IOS_TAB_BAR_HEIGHT + Spacing.four;

  return (
    <Pressable
      // Capture is the primary way in now; manual entry is offered inside it.
      onPress={() => router.push('/capture')}
      accessibilityRole="button"
      accessibilityLabel="Add a bill"
      style={({ pressed }) => [
        styles.fab,
        { bottom, backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
      ]}>
      <ThemedText style={[styles.fabGlyph, { color: theme.textInverse }]}>+</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { padding: Spacing.four, gap: Spacing.three },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
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
  busy: { opacity: 0.4 },
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
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  fabGlyph: { fontSize: 30, lineHeight: 34, fontWeight: '400' },
});
