import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { getDb } from '@/data/db';
import { getBill, updateBillWithItems } from '@/data/ledgerRepo';
import type { BillWithItems } from '@/types/ledger';
import { BillForm, type BillFormValues } from '@/ui/components/bill-form';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';
import { useLedgerStore } from '@/ui/stores/ledger-store';

export default function EditBillScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const billId = Number(id);
  const refresh = useLedgerStore((state) => state.refresh);

  const [bill, setBill] = useState<BillWithItems | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [billId]);

  const save = async (values: BillFormValues) => {
    const db = await getDb();
    // One transaction for the header and the whole item list, so a failure
    // cannot leave half the user's edits applied.
    await updateBillWithItems(
      db,
      billId,
      {
        merchant: values.merchant,
        merchantAddress: values.merchantAddress,
        purchasedAt: values.purchasedAt,
        purchasedTime: values.purchasedTime,
        totalCents: values.totalCents,
        discountCents: values.discountCents,
        unitsSold: values.unitsSold,
      },
      values.items
    );

    await refresh();
    router.back();
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

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <BillForm
        initial={bill}
        submitLabel="Save changes"
        onSubmit={save}
        onCancel={() => router.back()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
