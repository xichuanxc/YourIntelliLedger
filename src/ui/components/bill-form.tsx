/**
 * The manual-entry and edit form. One component for both, because the two
 * differ only in what they do with the result — and a receipt corrected on the
 * review screen (§5.6) will eventually be a third caller.
 *
 * Money is entered as text and converted with `parseCents` exactly once, at
 * submit. Nothing here ever holds dollars as a `number` (§4.3).
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { isValidLocalDate, isValidLocalTime, todayLocalDate } from '@/data/dates';
import { centsToInput, parseCents } from '@/data/money';
import type { BillWithItems, NewBillItemInput } from '@/types/ledger';
import { CATEGORIES, CATEGORY_LABELS, UNITS, UNIT_LABELS, type Category, type Unit } from '@/types/vocabulary';
import { Button } from '@/ui/components/button';
import { ChipSelect } from '@/ui/components/chip-select';
import { TextField } from '@/ui/components/text-field';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export interface DraftItem {
  /** Stable across re-renders; not the database id. */
  key: string;
  id?: number;
  name: string;
  nameLocal: string;
  category: Category;
  qty: string;
  unit: Unit;
  scanUnits: string;
  price: string;
  isFood: boolean;
}

export interface BillFormValues {
  merchant: string | null;
  merchantAddress: string | null;
  purchasedAt: string;
  purchasedTime: string | null;
  totalCents: number | null;
  discountCents: number;
  unitsSold: number | null;
  items: (NewBillItemInput & { id?: number })[];
}

export interface BillFormProps {
  initial?: BillWithItems;
  submitLabel: string;
  onSubmit: (values: BillFormValues) => Promise<void>;
  onCancel: () => void;
}

type Errors = Record<string, string>;

let keySeed = 0;
const nextKey = () => `draft-${++keySeed}`;

function emptyItem(): DraftItem {
  return {
    key: nextKey(),
    name: '',
    nameLocal: '',
    category: 'other',
    qty: '1',
    unit: 'pc',
    scanUnits: '1',
    price: '',
    isFood: true,
  };
}

function toDrafts(bill: BillWithItems | undefined): DraftItem[] {
  return (bill?.items ?? []).map((item) => ({
    key: nextKey(),
    id: item.id,
    name: item.name,
    nameLocal: item.nameLocal ?? '',
    category: item.category,
    qty: String(item.qty),
    unit: item.unit,
    scanUnits: String(item.scanUnits),
    price: centsToInput(item.priceCents),
    isFood: item.isFood,
  }));
}

export function BillForm({ initial, submitLabel, onSubmit, onCancel }: BillFormProps) {
  const theme = useTheme();

  const [merchant, setMerchant] = useState(initial?.merchant ?? '');
  const [address, setAddress] = useState(initial?.merchantAddress ?? '');
  const [purchasedAt, setPurchasedAt] = useState(initial?.purchasedAt ?? todayLocalDate());
  const [purchasedTime, setPurchasedTime] = useState(initial?.purchasedTime ?? '');
  const [total, setTotal] = useState(centsToInput(initial?.totalCents));
  const [discount, setDiscount] = useState(
    initial && initial.discountCents > 0 ? centsToInput(initial.discountCents) : ''
  );
  const [unitsSold, setUnitsSold] = useState(initial?.unitsSold != null ? String(initial.unitsSold) : '');
  const [items, setItems] = useState<DraftItem[]>(() => toDrafts(initial));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const patchItem = (key: string, patch: Partial<DraftItem>) =>
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const handleSubmit = async () => {
    const found: Errors = {};

    if (!isValidLocalDate(purchasedAt)) {
      found.purchasedAt = 'Use the form YYYY-MM-DD, and a date that exists.';
    }
    if (purchasedTime.trim() !== '' && !isValidLocalTime(purchasedTime.trim())) {
      found.purchasedTime = 'Use 24-hour time, like 17:42.';
    }

    const totalCents = total.trim() === '' ? null : parseCents(total);
    if (total.trim() !== '' && totalCents == null) {
      found.total = "That isn't an amount I can read.";
    }

    const discountCents = discount.trim() === '' ? 0 : parseCents(discount);
    if (discount.trim() !== '' && (discountCents == null || discountCents < 0)) {
      found.discount = 'Enter the discount as a positive amount.';
    }

    let unitsSoldValue: number | null = null;
    if (unitsSold.trim() !== '') {
      unitsSoldValue = Number(unitsSold.trim());
      if (!Number.isInteger(unitsSoldValue) || unitsSoldValue < 0) {
        found.unitsSold = 'Enter a whole number of units.';
      }
    }

    const parsedItems: (NewBillItemInput & { id?: number })[] = [];
    for (const item of items) {
      if (item.name.trim() === '') {
        found[`item-${item.key}-name`] = 'Give the item a name, or remove the line.';
        continue;
      }

      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty < 0) {
        found[`item-${item.key}-qty`] = 'Quantity must be zero or more.';
        continue;
      }

      const scanUnits = Number(item.scanUnits);
      if (!Number.isInteger(scanUnits) || scanUnits < 0) {
        found[`item-${item.key}-scanUnits`] = 'Scan units must be a whole number.';
        continue;
      }

      // Blank stays NULL — "unknown", not zero (§4.3).
      const priceCents = item.price.trim() === '' ? null : parseCents(item.price);
      if (item.price.trim() !== '' && priceCents == null) {
        found[`item-${item.key}-price`] = "That isn't an amount I can read.";
        continue;
      }

      parsedItems.push({
        id: item.id,
        name: item.name.trim(),
        nameLocal: item.nameLocal.trim() || null,
        category: item.category,
        isFood: item.isFood,
        qty,
        unit: item.unit,
        scanUnits,
        priceCents,
      });
    }

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    try {
      await onSubmit({
        merchant: merchant.trim() || null,
        merchantAddress: address.trim() || null,
        purchasedAt,
        purchasedTime: purchasedTime.trim() || null,
        totalCents: totalCents ?? null,
        discountCents: discountCents ?? 0,
        unitsSold: unitsSoldValue,
        items: parsedItems,
      });
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : 'The bill could not be saved.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.select({ ios: 'padding', default: undefined })}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TextField
          label="Merchant"
          value={merchant}
          onChangeText={setMerchant}
          placeholder="PAK'nSAVE Mill Street"
          autoCapitalize="words"
        />
        <TextField
          label="Store address"
          value={address}
          onChangeText={setAddress}
          placeholder="17 Mill Street, Hamilton"
          hint="As printed on the receipt. Optional."
        />

        <View style={styles.row}>
          <TextField
            label="Date"
            value={purchasedAt}
            onChangeText={setPurchasedAt}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            error={errors.purchasedAt}
            containerStyle={styles.flex}
          />
          <TextField
            label="Time"
            value={purchasedTime}
            onChangeText={setPurchasedTime}
            placeholder="17:42"
            autoCorrect={false}
            keyboardType="numbers-and-punctuation"
            error={errors.purchasedTime}
            containerStyle={styles.flex}
          />
        </View>

        <View style={styles.row}>
          <TextField
            label="Total"
            value={total}
            onChangeText={setTotal}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.total}
            containerStyle={styles.flex}
          />
          <TextField
            label="Discount"
            value={discount}
            onChangeText={setDiscount}
            placeholder="0.00"
            keyboardType="decimal-pad"
            error={errors.discount}
            hint="Promo deductions not tied to a line."
            containerStyle={styles.flex}
          />
        </View>

        <TextField
          label="Units sold"
          value={unitsSold}
          onChangeText={setUnitsSold}
          placeholder="7"
          keyboardType="number-pad"
          error={errors.unitsSold}
          hint="The scan-unit count printed on the receipt, if it shows one."
        />

        <View style={styles.itemsHeader}>
          <ThemedText type="subtitle">Items</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {items.length === 0 ? 'Optional' : `${items.length} line${items.length === 1 ? '' : 's'}`}
          </ThemedText>
        </View>

        {items.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            A bill with no items is fine — a restaurant bill or a service invoice has nothing to
            itemise. The total is still recorded.
          </ThemedText>
        )}

        {items.map((item, index) => (
          <View
            key={item.key}
            style={[styles.itemCard, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
            <View style={styles.itemHeader}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                Line {index + 1}
              </ThemedText>
              <Pressable
                onPress={() => setItems((current) => current.filter((row) => row.key !== item.key))}
                accessibilityRole="button"
                accessibilityLabel={`Remove line ${index + 1}${item.name ? `, ${item.name}` : ''}`}
                hitSlop={12}>
                <ThemedText type="smallBold" themeColor="danger">
                  Remove
                </ThemedText>
              </Pressable>
            </View>

            <TextField
              label="Name"
              value={item.name}
              onChangeText={(value) => patchItem(item.key, { name: value })}
              placeholder="Bananas"
              error={errors[`item-${item.key}-name`]}
            />
            {/*
              No placeholder. This field holds §4.7's `name_local` — the
              non-English name a bilingual receipt prints beside the English
              one — and it used to show a Chinese word as an example. An
              example in one specific language reads as an instruction to use
              that language, or as a hint that the field is only for it. The
              label and hint say what it is for in words instead.
            */}
            <TextField
              label="Name in another language"
              value={item.nameLocal}
              onChangeText={(value) => patchItem(item.key, { nameLocal: value })}
              hint="Optional. Only if the receipt prints the name in another language as well. Searched alongside the English name."
            />

            <ChipSelect
              label="Category"
              options={CATEGORIES}
              labels={CATEGORY_LABELS}
              value={item.category}
              onChange={(category) => patchItem(item.key, { category })}
            />

            <View style={styles.row}>
              <TextField
                label="Quantity"
                value={item.qty}
                onChangeText={(value) => patchItem(item.key, { qty: value })}
                keyboardType="decimal-pad"
                error={errors[`item-${item.key}-qty`]}
                containerStyle={styles.flex}
              />
              <TextField
                label="Price"
                value={item.price}
                onChangeText={(value) => patchItem(item.key, { price: value })}
                placeholder="0.00"
                keyboardType="decimal-pad"
                error={errors[`item-${item.key}-price`]}
                containerStyle={styles.flex}
              />
            </View>

            <ChipSelect
              label="Unit"
              options={UNITS}
              labels={UNIT_LABELS}
              value={item.unit}
              onChange={(unit) => patchItem(item.key, { unit })}
              scroll
            />

            <TextField
              label="Scan units"
              value={item.scanUnits}
              onChangeText={(value) => patchItem(item.key, { scanUnits: value })}
              keyboardType="number-pad"
              error={errors[`item-${item.key}-scanUnits`]}
              hint="What the till counted — a 3-pack is one scan unit."
            />
          </View>
        ))}

        <Button
          label="Add an item"
          variant="secondary"
          onPress={() => setItems((current) => [...current, emptyItem()])}
        />

        {errors.form && (
          <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
            {errors.form}
          </ThemedText>
        )}

        <View style={styles.actions}>
          <Button label="Cancel" variant="plain" onPress={onCancel} style={styles.flex} />
          <Button label={submitLabel} onPress={handleSubmit} busy={saving} style={styles.flex} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.four, paddingBottom: Spacing.seven },
  row: { flexDirection: 'row', gap: Spacing.three },
  itemsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: Spacing.three,
  },
  itemCard: {
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.four,
    gap: Spacing.four,
  },
  itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', gap: Spacing.three, marginTop: Spacing.three },
});
