/**
 * The review screen — spec §5.6, "the trust gate".
 *
 * **Nothing is written to the database before an explicit tap.** Everything
 * here is a draft held in component state; the only write is `Save bill`.
 *
 * The design follows §5.6 point by point:
 *  - low-confidence rows are highlighted, counted in a banner, and the list
 *    scrolls to the first one, so attention lands where the parse is weakest;
 *  - printed order is preserved rather than sorting problems to the top,
 *    because `line_no` is display *and* audit (§4.4) and a receipt the user
 *    can no longer follow is harder to check, not easier;
 *  - any edit marks that line `user_corrected` (§4.11's future correction
 *    corpus), and only a real change counts;
 *  - an itemless bill shows no item list at all (§5.1), with a way to itemise
 *    by hand if the user disagrees with the model's call.
 */

import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { centsToInput, formatMoney, parseCents } from '@/data/money';
import { formatDate } from '@/data/dates';
import { getDb } from '@/data/db';
import { saveReviewedReceipt } from '@/capture/saveReceipt';
import type { ParsedItem } from '@/capture/parseContract';
import { CATEGORIES, CATEGORY_LABELS, UNIT_LABELS } from '@/types/vocabulary';
import { Button } from '@/ui/components/button';
import { ChipSelect } from '@/ui/components/chip-select';
import { EmptyState } from '@/ui/components/empty-state';
import { FlagBanner } from '@/ui/components/flag-banner';
import { Screen } from '@/ui/components/screen';
import { TextField } from '@/ui/components/text-field';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { useCaptureStore } from '@/ui/stores/capture-store';
import { useLedgerStore } from '@/ui/stores/ledger-store';
import { MinTouchTarget, Radius, Spacing } from '@/ui/theme';

export default function ReviewScreen() {
  const theme = useTheme();
  const { parse, result, reset } = useCaptureStore();
  const refreshLedger = useLedgerStore((state) => state.refresh);
  const scroll = useRef<ScrollView>(null);

  const [items, setItems] = useState<ParsedItem[]>(() => parse?.receipt.items ?? []);
  const [corrected, setCorrected] = useState<Set<number>>(new Set());
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const lowConfidenceCount = useMemo(
    () => items.filter((item, index) => item.confidence === 'low' && !excluded.has(index)).length,
    [items, excluded]
  );

  if (!parse || !result) {
    return (
      <Screen>
        <EmptyState
          title="Nothing to review"
          message="Capture a receipt first."
          actionLabel="Back to capture"
          onAction={() => router.replace('/capture')}
        />
      </Screen>
    );
  }

  const { receipt } = parse;

  const editItem = (index: number, patch: Partial<ParsedItem>) => {
    setItems((current) =>
      current.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
    // Only a real change counts as a correction — this is the corpus a future
    // parse_corrections table is built from (§4.11).
    setCorrected((current) => new Set(current).add(index));
  };

  const save = async () => {
    setSaving(true);
    try {
      const db = await getDb();
      const billId = await saveReviewedReceipt(db, {
        receipt: { ...receipt, items },
        correctedIndices: corrected,
        excludedIndices: excluded,
        capturePath: result.path,
        modelAlias: parse.modelAlias,
        ocrPages: result.pages.map((page) => page.text),
      });

      await refreshLedger();
      reset();
      router.dismissTo(`/bill/${billId}`);
    } catch (error) {
      Alert.alert(
        'Could not save',
        error instanceof Error ? error.message : 'The bill was not saved. Nothing was changed.'
      );
    } finally {
      setSaving(false);
    }
  };

  const included = items.filter((_, index) => !excluded.has(index));
  const itemsTotal = included.reduce((sum, item) => sum + (item.price_cents ?? 0), 0);

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <ThemedText type="title">{receipt.merchant ?? 'Unnamed merchant'}</ThemedText>
          <ThemedText themeColor="textSecondary">
            {formatDate(receipt.purchased_at)}
            {receipt.purchased_time ? ` at ${receipt.purchased_time}` : ''}
          </ThemedText>
          <ThemedText type="amountLarge">
            {formatMoney(receipt.total_cents, receipt.currency)}
          </ThemedText>
        </View>

        <FlagBanner flags={parse.flags} />

        {__DEV__ && (
          <ThemedText type="small" themeColor="textSecondary">
            {`${(parse.durationMs / 1000).toFixed(1)}s · ${parse.usage?.promptTokens ?? '?'} in / ${parse.usage?.completionTokens ?? '?'} out / ${parse.usage?.thoughtTokens ?? 0} thinking · ${parse.modelAlias}${parse.retried ? ' · RETRIED' : ''}`}
          </ThemedText>
        )}

        {lowConfidenceCount > 0 && (
          <Pressable
            onPress={() => scroll.current?.scrollTo({ y: 260, animated: true })}
            accessibilityRole="button"
            style={[styles.attention, { borderColor: theme.warning, backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold" themeColor="warning">
              {lowConfidenceCount} line{lowConfidenceCount === 1 ? '' : 's'} read with low
              confidence — worth checking before you save.
            </ThemedText>
          </Pressable>
        )}

        {receipt.itemless || items.length === 0 ? (
          <View style={styles.itemless}>
            <ThemedText type="subtitle">No itemised lines</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              This looks like a restaurant bill or a service invoice — there is nothing to break
              into items honestly, so only the total is recorded. That is a normal, complete bill.
            </ThemedText>
            <Button
              label="Itemise by hand instead"
              variant="secondary"
              onPress={() => {
                reset();
                router.replace('/bill/new');
              }}
            />
          </View>
        ) : (
          <>
            <View style={styles.itemsHeader}>
              <ThemedText type="sectionHeader" themeColor="textSecondary">
                {included.length} item{included.length === 1 ? '' : 's'}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {formatMoney(itemsTotal, receipt.currency)} of{' '}
                {formatMoney(receipt.total_cents, receipt.currency)}
              </ThemedText>
            </View>

            {items.map((item, index) => (
              <ReviewRow
                key={index}
                item={item}
                index={index}
                currency={receipt.currency}
                excluded={excluded.has(index)}
                corrected={corrected.has(index)}
                expanded={expanded === index}
                onToggleExpanded={() => setExpanded(expanded === index ? null : index)}
                onToggleExcluded={() =>
                  setExcluded((current) => {
                    const next = new Set(current);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
                onEdit={(patch) => editItem(index, patch)}
              />
            ))}
          </>
        )}

        <View style={styles.actions}>
          <Button
            label="Discard"
            variant="plain"
            onPress={() =>
              Alert.alert('Discard this receipt?', 'Nothing has been saved yet.', [
                { text: 'Keep reviewing', style: 'cancel' },
                {
                  text: 'Discard',
                  style: 'destructive',
                  onPress: () => {
                    reset();
                    router.dismissTo('/');
                  },
                },
              ])
            }
          />
          <Button label="Save bill" onPress={save} busy={saving} style={styles.saveButton} />
        </View>
      </ScrollView>
    </Screen>
  );
}

function ReviewRow({
  item,
  index,
  currency,
  excluded,
  corrected,
  expanded,
  onToggleExpanded,
  onToggleExcluded,
  onEdit,
}: {
  item: ParsedItem;
  index: number;
  currency: string;
  excluded: boolean;
  corrected: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleExcluded: () => void;
  onEdit: (patch: Partial<ParsedItem>) => void;
}) {
  const theme = useTheme();
  const lowConfidence = item.confidence === 'low';

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.backgroundElement,
          borderColor: lowConfidence ? theme.warning : 'transparent',
          borderWidth: lowConfidence ? 1 : 0,
          opacity: excluded ? 0.45 : 1,
        },
      ]}>
      <Pressable
        onPress={onToggleExpanded}
        accessibilityRole="button"
        accessibilityLabel={`Line ${index + 1}, ${item.name}, ${formatMoney(item.price_cents, currency)}${lowConfidence ? ', low confidence' : ''}`}
        style={styles.rowHead}>
        <View style={styles.rowMain}>
          <ThemedText numberOfLines={2}>{item.name}</ThemedText>
          {item.name_local && (
            <ThemedText type="small" themeColor="textSecondary">
              {item.name_local}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {CATEGORY_LABELS[item.category]} · {item.qty} {UNIT_LABELS[item.unit]}
            {corrected ? ' · edited' : ''}
          </ThemedText>
        </View>
        <View style={styles.rowTrailing}>
          <ThemedText type="amount">{formatMoney(item.price_cents, currency)}</ThemedText>
          {item.price_cents == null && (
            <ThemedText type="small" themeColor="warning">
              Illegible
            </ThemedText>
          )}
        </View>
      </Pressable>

      {expanded && (
        <View style={styles.editor}>
          <TextField label="Name" value={item.name} onChangeText={(name) => onEdit({ name })} />
          <View style={styles.editorRow}>
            <TextField
              label="Quantity"
              value={String(item.qty)}
              keyboardType="decimal-pad"
              onChangeText={(text) => {
                const qty = Number(text);
                if (Number.isFinite(qty) && qty >= 0) onEdit({ qty });
              }}
              containerStyle={styles.flex}
            />
            <TextField
              label="Price"
              value={centsToInput(item.price_cents)}
              keyboardType="decimal-pad"
              placeholder="illegible"
              onChangeText={(text) =>
                onEdit({ price_cents: text.trim() === '' ? null : parseCents(text) })
              }
              containerStyle={styles.flex}
            />
          </View>
          <ChipSelect
            label="Category"
            options={CATEGORIES}
            labels={CATEGORY_LABELS}
            value={item.category}
            onChange={(category) => onEdit({ category })}
          />
          <Button
            label={excluded ? 'Include this line' : 'Remove this line'}
            variant={excluded ? 'secondary' : 'danger'}
            onPress={onToggleExcluded}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three, paddingBottom: Spacing.seven },
  header: { gap: Spacing.one },
  attention: {
    borderLeftWidth: 3,
    borderRadius: Radius.medium,
    padding: Spacing.three,
    minHeight: MinTouchTarget,
    justifyContent: 'center',
  },
  itemless: { gap: Spacing.three, marginTop: Spacing.three },
  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: Spacing.two,
  },
  row: { borderRadius: Radius.medium, overflow: 'hidden' },
  rowHead: { flexDirection: 'row', gap: Spacing.three, padding: Spacing.four },
  rowMain: { flex: 1, gap: Spacing.half },
  rowTrailing: { alignItems: 'flex-end', gap: Spacing.half },
  editor: { padding: Spacing.four, paddingTop: 0, gap: Spacing.four },
  editorRow: { flexDirection: 'row', gap: Spacing.three },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.four },
  saveButton: { flex: 1 },
});
