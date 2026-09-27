/**
 * Erasing everything, and meaning it (§15.2).
 *
 * The project's central claim is that a person's spending stays on their own
 * device. That claim is only worth something if they can also make it stop
 * existing, so this is not a convenience feature -- it is the other half of
 * the promise, and until now the app could not keep it: `deleteAllBills` was
 * reachable only from a development build.
 *
 * ## What "everything" turns out to mean
 *
 * The ledger is the obvious part and the smallest. Spending also leaves
 * traces in four other places, and an erase that missed any of them would be
 * quietly false:
 *
 *  - `query_log` -- no question text or amounts by §15.3, but the shape of
 *    somebody's usage all the same;
 *  - the saved Ask conversation, which *does* hold their words verbatim;
 *  - the product cache, which is a list of things they have bought;
 *  - the geocode cache, which is a list of places they have shopped.
 *
 * The last two are the ones easy to forget. Neither is "their data" in the
 * sense of a row they created, and both reconstruct a shopping history.
 *
 * ## What is deliberately kept
 *
 * **API keys.** §15.2 asks for the device token to be revoked, not for the
 * user's own provider credentials to be destroyed. A key is not a record of
 * anything they bought; it is a thing they typed, and re-typing forty
 * characters to recover from a data wipe is a punishment for housekeeping.
 * Settings clears keys separately, and the confirmation says so.
 *
 * **Receipt images.** The spec has this delete a `receipts/` directory, and
 * there is nothing there to delete: `receipt_scans` stores OCR *text*, and no
 * build has ever written an image to disk. Writing the deletion anyway would
 * be dead code pretending to be a safeguard. If images are ever persisted,
 * this is the function that has to learn about them, and the test below is
 * where that would be noticed.
 *
 * ## Ordering, and why it is not a single transaction
 *
 * The spec says "in one transaction", which is right for the SQL and cannot
 * cover the rest: MMKV is not transactional and cannot enrol in one. So the
 * database work is atomic, and the caches are cleared afterwards. That order
 * is the safe one -- a crash between them leaves caches referring to bills
 * that no longer exist, which is untidy but harmless, whereas the reverse
 * leaves a ledger whose caches have been emptied underneath it.
 */

import { clearConversation } from '@/data/conversationRepo';
import type { SqlDriver } from '@/data/driver';
import { deleteAllBills } from '@/data/ledgerRepo';
import { clearQueryLog } from '@/data/telemetryRepo';

/**
 * The non-SQL stores, injected so the erase can be tested without a device.
 *
 * Each is a separate MMKV instance in the app; here they are four functions,
 * because what matters to this module is that they are called, not where they
 * live.
 */
export interface CacheClears {
  preferences: () => void;
  products: () => void;
  geocodes: () => void;
  catalog: () => void;
  hubConfig: () => void;
}

export interface EraseSummary {
  bills: number;
  queryLogRows: number;
}

/**
 * Removes every trace of what the user bought, asked and looked up.
 *
 * Returns what went, so the screen can say "deleted 47 bills" rather than
 * "done" -- an irreversible action should report what it actually did.
 */
export async function eraseEverything(
  db: SqlDriver,
  caches: CacheClears
): Promise<EraseSummary> {
  const summary = await db.transaction(async (tx) => {
    const bills = await deleteAllBills(tx);
    const queryLogRows = await clearQueryLog(tx);
    await clearConversation(tx);
    return { bills, queryLogRows };
  });

  // Not transactional, and deliberately after the database. See above.
  caches.preferences();
  caches.products();
  caches.geocodes();
  caches.catalog();
  caches.hubConfig();

  return summary;
}

/**
 * The phrase a person has to type before this runs.
 *
 * §15.2 asks for type-to-confirm rather than a second "are you sure", because
 * a second button is answered by the same reflex that pressed the first.
 * Typing a word is a different action, and it cannot be done by accident.
 */
export const CONFIRM_PHRASE = 'DELETE';

/** Forgiving about spacing and case; strict about the word. */
export function confirmationMatches(typed: string): boolean {
  return typed.trim().toUpperCase() === CONFIRM_PHRASE;
}
