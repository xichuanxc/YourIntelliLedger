/**
 * The tap that §6.8 requires (§6.4).
 *
 * A write reaches this card already validated and not yet applied — the
 * executor has no mutating path at all, so nothing can have happened before
 * someone presses a button here.
 *
 * ## It describes the change from the ledger, not from the answer
 *
 * The model's sentence is shown when there is one, but the specifics come
 * from the database: for a deletion, the shop, the date and the total of the
 * bill that is actually about to go. "Delete bill #7" is not enough to judge,
 * and a summary is the model's account of what it asked for rather than a
 * reading of what is there.
 *
 * A card lives only as long as the conversation in memory. Restoring a
 * conversation from a previous launch brings back the answers and not the
 * pending writes, which is deliberate: yesterday's proposal should not still
 * be one tap from committing.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { PendingWrite } from '@/agent/execute';
import { formatDate } from '@/data/dates';
import { getDb } from '@/data/db';
import { getBill } from '@/data/ledgerRepo';
import { formatMoney } from '@/data/money';
import { CATEGORY_LABELS } from '@/types/vocabulary';
import { Button } from '@/ui/components/button';
import { ThemedText } from '@/ui/components/themed-text';
import { useTheme } from '@/ui/hooks/use-theme';
import { Radius, Spacing } from '@/ui/theme';

export interface ConfirmationCardProps {
  write: PendingWrite;
  /** The model's own wording, when the envelope carried one (§14.7). */
  summary?: string;
  onApply: (write: PendingWrite) => Promise<void>;
}

/** What `update_bill_item` is about to change, in the ledger's words. */
function describeChanges(set: Extract<PendingWrite, { name: 'update_bill_item' }>['args']['set']): string[] {
  const changes: string[] = [];
  if (set.name !== undefined) changes.push(`Name → ${set.name}`);
  if (set.category !== undefined) changes.push(`Category → ${CATEGORY_LABELS[set.category]}`);
  if (set.qty !== undefined) changes.push(`Quantity → ${set.qty}`);
  if (set.unit !== undefined) changes.push(`Unit → ${set.unit}`);
  if (set.price_cents !== undefined) changes.push(`Price → ${formatMoney(set.price_cents)}`);
  return changes;
}

export function ConfirmationCard({ write, summary, onApply }: ConfirmationCardProps) {
  const theme = useTheme();
  const [state, setState] = useState<'waiting' | 'working' | 'done' | 'failed' | 'dismissed'>('waiting');
  const [error, setError] = useState<string | null>(null);
  /** What the bill actually is, for a deletion. Null until it is read. */
  const [subject, setSubject] = useState<string | null>(null);

  const deleting = write.name === 'delete_bill';
  const billId = deleting ? write.args.bill_id : null;

  useEffect(() => {
    if (billId === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const bill = await getBill(await getDb(), billId);
        if (cancelled) return;
        setSubject(
          bill
            ? `${bill.merchant ?? 'Unnamed shop'} · ${formatDate(bill.purchasedAt)} · ` +
              `${formatMoney(bill.totalCents, bill.currency)} · ${bill.items.length} item${bill.items.length === 1 ? '' : 's'}`
            : 'That bill is no longer in your ledger.'
        );
      } catch {
        // The description is a help, not the action. Falling back to the id
        // is worse than the shop's name and better than an empty card.
        if (!cancelled) setSubject(`Bill #${billId}`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [billId]);

  if (state === 'done') {
    return (
      <View style={[styles.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
        <ThemedText type="small" themeColor="success">
          {deleting ? 'Bill deleted.' : 'Change saved.'}
        </ThemedText>
      </View>
    );
  }

  if (state === 'dismissed') return null;

  const apply = async () => {
    setState('working');
    setError(null);
    try {
      await onApply(write);
      setState('done');
    } catch (problem) {
      setState('failed');
      setError(
        problem instanceof Error
          ? problem.message
          : 'That change could not be made. Nothing was altered.'
      );
    }
  };

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement, borderColor: deleting ? theme.danger : theme.border },
      ]}>
      <ThemedText type="smallBold">
        {deleting ? 'Delete this bill?' : 'Change this item?'}
      </ThemedText>

      {summary && (
        <ThemedText type="small" themeColor="textSecondary">
          {summary}
        </ThemedText>
      )}

      {deleting ? (
        <ThemedText type="small">{subject ?? 'Reading that bill…'}</ThemedText>
      ) : (
        write.name === 'update_bill_item' &&
        describeChanges(write.args.set).map((change) => (
          <ThemedText key={change} type="small">
            {change}
          </ThemedText>
        ))
      )}

      {error && (
        <ThemedText type="small" themeColor="danger" accessibilityRole="alert">
          {error}
        </ThemedText>
      )}

      <View style={styles.actions}>
        <Button label="Not now" variant="plain" onPress={() => setState('dismissed')} />
        <Button
          label={deleting ? 'Delete' : 'Apply'}
          variant={deleting ? 'danger' : 'primary'}
          busy={state === 'working'}
          onPress={apply}
          style={styles.confirm}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.two,
    padding: Spacing.four,
    marginTop: Spacing.two,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.three },
  confirm: { minWidth: 110 },
});
