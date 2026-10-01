import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import { formatDate } from '@/data/dates';
import { getDb } from '@/data/db';
import { grocerSearchUrl } from '@/data/grocerSearch';
import { deleteBill, getBill, markBillReviewed } from '@/data/ledgerRepo';
import { formatMoney, formatQuantity } from '@/data/money';
import { getMapPreviews, getPriceLookup } from '@/data/prefs';
import type { BillItem, BillWithItems } from '@/types/ledger';
import { CATEGORY_LABELS, UNIT_LABELS } from '@/types/vocabulary';
import { Button } from '@/ui/components/button';
import { EmptyState } from '@/ui/components/empty-state';
import { FlagBanner } from '@/ui/components/flag-banner';
import { MapPinIcon, NavigateIcon } from '@/ui/components/map-icons';
import { MapPreview } from '@/ui/components/map-preview';
import { Screen } from '@/ui/components/screen';
import { ThemedText } from '@/ui/components/themed-text';
import { headlineCase } from '@/ui/headlineCase';
import { useTheme } from '@/ui/hooks/use-theme';
import { useLedgerStore } from '@/ui/stores/ledger-store';
import { Radius, Spacing } from '@/ui/theme';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const billId = Number(id);
  const refresh = useLedgerStore((state) => state.refresh);

  const [bill, setBill] = useState<BillWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const db = await getDb();
        const loaded = await getBill(db, billId);
        if (!cancelled) {
          setBill(loaded);
          setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [billId])
  );

  const confirmDelete = () => {
    Alert.alert(
      'Delete this bill?',
      'The bill and its items will be removed. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const db = await getDb();
            await deleteBill(db, billId);
            await refresh();
            router.dismissTo('/');
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (!bill) {
    return (
      <Screen>
        <EmptyState
          title="Bill not found"
          message="It may have been deleted."
          actionLabel="Back to ledger"
          onAction={() => router.dismissTo('/')}
        />
      </Screen>
    );
  }

  const itemsTotal = bill.items.reduce((sum, item) => sum + (item.priceCents ?? 0), 0);

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.summary}>
          <ThemedText type="title">
            {bill.merchant ? headlineCase(bill.merchant) : 'Unnamed merchant'}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {formatDate(bill.purchasedAt)}
            {bill.purchasedTime ? ` at ${bill.purchasedTime}` : ''}
          </ThemedText>
          <ThemedText type="amountLarge">{formatMoney(bill.totalCents, bill.currency)}</ThemedText>
        </View>

        <FlagBanner
          flags={bill.parseFlags}
          reviewedFlags={bill.reviewedFlags}
          onConfirmReviewed={async () => {
            const db = await getDb();
            await markBillReviewed(db, billId);
            setBill(await getBill(db, billId));
            // The ledger row draws "Needs review" from the same fields, so it
            // has to be told too or the list disagrees with the bill.
            await refresh();
          }}
        />

        {bill.merchantAddress && (
          <AddressCard address={bill.merchantAddress} />
        )}

        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle">Items</ThemedText>
          {bill.items.length > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {formatMoney(itemsTotal, bill.currency)} across {bill.items.length}
            </ThemedText>
          )}
        </View>

        {bill.items.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            This bill has no itemised lines — the total is recorded on its own. That is the expected
            shape for a restaurant bill or a service invoice.
          </ThemedText>
        ) : (
          bill.items.map((item) => <ItemRow key={item.id} item={item} currency={bill.currency} />)
        )}

        {bill.discountCents > 0 && (
          <View style={styles.discountRow}>
            <ThemedText themeColor="textSecondary">Discount</ThemedText>
            <ThemedText type="amount" themeColor="textSecondary">
              −{formatMoney(bill.discountCents, bill.currency)}
            </ThemedText>
          </View>
        )}

        <View style={styles.meta}>
          <MetaRow label="Source" value={bill.source} />
          {bill.capturePath && <MetaRow label="Captured via" value={bill.capturePath} />}
          {bill.unitsSold != null && <MetaRow label="Units sold" value={String(bill.unitsSold)} />}
        </View>

        <View style={styles.actions}>
          <Button
            label="Edit"
            variant="secondary"
            onPress={() => router.push(`/bill/edit/${bill.id}`)}
            style={styles.flex}
          />
          <Button label="Delete" variant="danger" onPress={confirmDelete} style={styles.flex} />
        </View>
      </ScrollView>
    </Screen>
  );
}

/**
 * The address, a map behind it, and a way to navigate there (§4.14).
 *
 * The map is the optional half: it needs a coordinate, and a coordinate needs
 * a network round-trip the rest of this screen does not. When it is switched
 * off, or fails, or the address cannot be resolved, `MapPreview` renders
 * nothing and this collapses back to the plain card.
 */
function AddressCard({ address }: { address: string }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);

  // Read once, on mount: flipping the switch in Settings should take effect on
  // the next bill opened, not repaint one already on screen.
  const [previewsOn] = useState(getMapPreviews);

  return (
    <View
      style={[styles.addressCard, { backgroundColor: theme.backgroundElement }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width - Spacing.four * 2)}>
      {previewsOn && width > 0 && (
        <MapPreview address={address} width={width} onPress={() => openMaps(address)} />
      )}

      <View style={styles.addressRow}>
        <MapPinIcon />
        <View style={styles.addressText}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            Store address
          </ThemedText>
          <ThemedText>{address}</ThemedText>
        </View>
        {/* Compact rather than full-width: this is a secondary action on a
            screen whose primary job is the bill itself. */}
        <Pressable
          onPress={() => openMaps(address)}
          accessibilityRole="button"
          accessibilityLabel="Navigate to this store"
          accessibilityHint="Opens the address in your maps app"
          hitSlop={10}
          style={({ pressed }) => [
            styles.navigateButton,
            {
              backgroundColor: pressed ? theme.backgroundSelected : theme.background,
              borderColor: theme.border,
            },
          ]}>
          <NavigateIcon />
          <ThemedText type="smallBold" themeColor="primary">
            Navigate
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function ItemRow({ item, currency }: { item: BillItem; currency: string }) {
  const theme = useTheme();
  const name = headlineCase(item.name);
  const quantity = `${formatQuantity(item.qty)} ${UNIT_LABELS[item.unit]}`;
  const rate =
    item.unitPriceCents != null
      ? ` at ${formatMoney(item.unitPriceCents, currency)}/${UNIT_LABELS[item.unit]}`
      : '';

  // Read once, on mount, for the reason `AddressCard` reads its own switch
  // that way: a bill already on screen should not rearrange itself behind
  // somebody coming back from Settings.
  const [lookupOn] = useState(getPriceLookup);

  // Demo (§4.14-adjacent): what is this costing elsewhere today? Offered only
  // when the switch is on and the line has words to search for — a row whose
  // name never parsed has nothing to ask about.
  const priceCheck = lookupOn ? grocerSearchUrl(item) : null;

  return (
    <Pressable
      onPress={priceCheck ? () => void Linking.openURL(priceCheck) : undefined}
      disabled={!priceCheck}
      accessibilityRole={priceCheck ? 'link' : undefined}
      accessibilityHint={priceCheck ? 'Compares prices on grocer.nz' : undefined}
      style={({ pressed }) => [
        styles.item,
        { borderColor: theme.border, opacity: pressed ? 0.6 : 1 },
      ]}
      accessibilityLabel={`${name}, ${quantity}, ${formatMoney(item.priceCents, currency)}`}>
      <View style={styles.itemMain}>
        <ThemedText numberOfLines={2}>{name}</ThemedText>
        {item.nameLocal && (
          <ThemedText type="small" themeColor="textSecondary">
            {headlineCase(item.nameLocal)}
          </ThemedText>
        )}
        <ThemedText type="small" themeColor="textSecondary">
          {CATEGORY_LABELS[item.category]} · {quantity}
          {rate}
        </ThemedText>
      </View>
      <View style={styles.itemTrailing}>
        <ThemedText type="amount">{formatMoney(item.priceCents, currency)}</ThemedText>
        {item.priceCents == null && (
          <ThemedText type="small" themeColor="warning">
            Illegible
          </ThemedText>
        )}
        {priceCheck && (
          <ThemedText type="small" themeColor="primary">
            Compare ›
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metaRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="small">{value}</ThemedText>
    </View>
  );
}

/**
 * Hands the address to the OS as printed (§4.14) — no geocoding, no API key.
 * The platform's own search handles abbreviation and misspelling better than a
 * parse-time lookup would, and it costs nothing.
 */
function openMaps(address: string) {
  const query = encodeURIComponent(address);
  const url = Platform.select({
    ios: `http://maps.apple.com/?q=${query}`,
    default: `geo:0,0?q=${query}`,
  });
  void Linking.openURL(url);
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.seven },
  summary: { gap: Spacing.one },
  card: { borderRadius: Radius.medium, padding: Spacing.four, gap: Spacing.two },
  addressCard: {
    gap: Spacing.three,
    borderRadius: Radius.medium,
    padding: Spacing.four,
  },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  addressText: { flex: 1, gap: Spacing.half },
  navigateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Radius.large,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 36,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
  item: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  itemMain: { flex: 1, gap: Spacing.half },
  itemTrailing: { alignItems: 'flex-end', gap: Spacing.half },
  discountRow: { flexDirection: 'row', justifyContent: 'space-between' },
  meta: { gap: Spacing.one, marginTop: Spacing.two },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.four },
});
