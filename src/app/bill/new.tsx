import { router } from 'expo-router';

import { getDb } from '@/data/db';
import { createBill } from '@/data/ledgerRepo';
import { BillForm, type BillFormValues } from '@/ui/components/bill-form';
import { Screen } from '@/ui/components/screen';
import { useLedgerStore } from '@/ui/stores/ledger-store';

export default function NewBillScreen() {
  const refresh = useLedgerStore((state) => state.refresh);

  const save = async (values: BillFormValues) => {
    const db = await getDb();
    await createBill(db, {
      merchant: values.merchant,
      merchantAddress: values.merchantAddress,
      purchasedAt: values.purchasedAt,
      purchasedTime: values.purchasedTime,
      totalCents: values.totalCents,
      discountCents: values.discountCents,
      unitsSold: values.unitsSold,
      source: 'manual',
      // NULL, not 'camera': nothing was captured (§4.7).
      capturePath: null,
      items: values.items,
    });

    await refresh();
    router.back();
  };

  return (
    <Screen edges={['left', 'right', 'bottom']}>
      <BillForm submitLabel="Save bill" onSubmit={save} onCancel={() => router.back()} />
    </Screen>
  );
}
