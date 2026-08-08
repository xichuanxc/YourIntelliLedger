/**
 * Turning a reviewed parse into a stored bill — spec §5.1's "DB write (single
 * transaction)".
 *
 * The conversion lives here rather than in the review screen because it is the
 * boundary between the model's snake_case contract and the ledger's domain
 * types, and boundaries are worth naming. Everything below is the repository's
 * job: `merchant_norm`, the §4.11 flags, and the OCR text all land in one
 * transaction, so a receipt is never half-stored.
 */

import type { ParsedItem, ParsedReceipt } from '@/capture/parseContract';
import { createBill } from '@/data/ledgerRepo';
import type { SqlDriver } from '@/data/driver';
import type { NewBillInput, NewBillItemInput } from '@/types/ledger';
import type { CapturePath } from '@/types/vocabulary';

export interface ReviewedReceipt {
  receipt: ParsedReceipt;
  /** Indices the user edited on the review screen — these set `user_corrected`. */
  correctedIndices: ReadonlySet<number>;
  /** Indices the user excluded. Kept out of the save entirely. */
  excludedIndices: ReadonlySet<number>;
  capturePath: CapturePath;
  modelAlias: string | null;
  /** Reconstructed text per page, cached for a later re-parse (§4.6). */
  ocrPages: string[];
}

/** Model contract (snake_case) → domain input (camelCase). */
export function toNewBillInput(reviewed: ReviewedReceipt): NewBillInput {
  const { receipt } = reviewed;

  const items: NewBillItemInput[] = receipt.items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !reviewed.excludedIndices.has(index))
    .map(({ item, index }) => toItemInput(item, reviewed.correctedIndices.has(index)));

  return {
    merchant: receipt.merchant,
    merchantAddress: receipt.merchant_address,
    purchasedAt: receipt.purchased_at,
    purchasedTime: receipt.purchased_time,
    totalCents: receipt.total_cents,
    discountCents: receipt.discount_cents,
    currency: receipt.currency,
    unitsSold: receipt.units_sold,
    source: 'receipt',
    capturePath: reviewed.capturePath,
    modelAlias: reviewed.modelAlias,
    items,
    ocrPages: reviewed.ocrPages,
  };
}

function toItemInput(item: ParsedItem, userCorrected: boolean): NewBillItemInput {
  return {
    name: item.name,
    nameLocal: item.name_local,
    category: item.category,
    isFood: item.is_food,
    qty: item.qty,
    unit: item.unit,
    scanUnits: item.scan_units,
    priceCents: item.price_cents,
    unitPriceCents: item.unit_price_cents,
    barcode: item.barcode,
    confidence: item.confidence,
    userCorrected,
  };
}

/**
 * Writes the reviewed receipt. Returns the new bill id.
 *
 * The §4.11 flags are **not** taken from the parse-time post-checks — the
 * repository recomputes them from what is actually being stored. The user may
 * have fixed a price or removed a line since, and a flag describing the
 * pre-edit state would be worse than no flag at all.
 */
export async function saveReviewedReceipt(
  db: SqlDriver,
  reviewed: ReviewedReceipt
): Promise<number> {
  return createBill(db, toNewBillInput(reviewed));
}
