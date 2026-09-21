/**
 * Committing a write the user confirmed (§6.4, §6.8).
 *
 * The only place in the app where a model-proposed change reaches the
 * database, and it is reached from one place: a tap on a confirmation card.
 * §6.8's "no write ever commits without an explicit user tap" therefore holds
 * structurally — `execute.ts` has no mutating path at all, so a write that
 * nobody confirmed has nowhere to happen.
 *
 * ## Why the mapping is here and not in a component
 *
 * The tool contract speaks the model's words (§14.1: snake_case), and the
 * repository speaks the ledger's. Translating between them is exactly the
 * kind of quiet work where a dropped field means a card that says it changed
 * a price and did not — so it lives in a function with tests rather than
 * inside a button's handler.
 *
 * The argument type is `PendingWrite`, which only `validate.ts` can produce.
 * Nothing that has not been through §14.5 can be passed to this.
 */

import type { PendingWrite } from '@/agent/execute';
import type { SqlDriver } from '@/data/driver';
import { deleteBill, updateBillItem } from '@/data/ledgerRepo';
import type { BillItemPatch } from '@/types/ledger';

/**
 * The model's field names → the ledger's.
 *
 * Exhaustive over what `update_bill_item` accepts (§14.2). A field the tool
 * does not offer cannot arrive here, and one it does offer must not be
 * silently ignored — the two lists are the same length on purpose.
 */
export function toItemPatch(set: Extract<PendingWrite, { name: 'update_bill_item' }>['args']['set']): BillItemPatch {
  const patch: BillItemPatch = {};

  if (set.name !== undefined) patch.name = set.name;
  if (set.category !== undefined) patch.category = set.category;
  if (set.qty !== undefined) patch.qty = set.qty;
  if (set.unit !== undefined) patch.unit = set.unit;
  if (set.price_cents !== undefined) patch.priceCents = set.price_cents;

  return patch;
}

/**
 * Applies a confirmed write.
 *
 * Throws what the repository throws — a bill deleted from another screen
 * while the card sat on this one is a `NotFoundError`, and the card says so
 * rather than reporting a success that did not happen.
 */
export async function applyPendingWrite(db: SqlDriver, write: PendingWrite): Promise<void> {
  if (write.name === 'delete_bill') {
    await deleteBill(db, write.args.bill_id);
    return;
  }

  await updateBillItem(db, write.args.bill_item_id, toItemPatch(write.args.set));
}
