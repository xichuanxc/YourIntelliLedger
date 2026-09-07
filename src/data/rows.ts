/**
 * Raw SQLite row shapes and their mapping to domain objects.
 *
 * These types mirror the schema exactly — snake_case, integer booleans, JSON
 * as text. Nothing outside `src/data/` should ever see them: the repositories
 * hand back the domain types from `@/types/ledger` instead.
 */

import type { Bill, BillItem } from '@/types/ledger';
import { isParseFlag, type Category, type CapturePath, type Confidence, type Source } from '@/types/vocabulary';

export interface BillRow {
  id: number;
  merchant: string | null;
  merchant_norm: string | null;
  merchant_address: string | null;
  purchased_at: string;
  purchased_time: string | null;
  total_cents: number | null;
  discount_cents: number;
  currency: string;
  units_sold: number | null;
  source: Source;
  capture_path: CapturePath | null;
  page_count: number;
  model_alias: string | null;
  created_at: string;
  updated_at: string;
  parse_flags: string | null;
  reviewed_at: string | null;
  reviewed_flags: string | null;
}

export interface BillItemRow {
  id: number;
  bill_id: number;
  line_no: number;
  name: string;
  name_local: string | null;
  category: Category;
  is_food: number;
  qty: number;
  unit: BillItem['unit'];
  scan_units: number;
  price_cents: number | null;
  unit_price_cents: number | null;
  barcode: string | null;
  confidence: Confidence | null;
  user_corrected: number;
  raw_text: string | null;
}

/**
 * Parses the `parse_flags` JSON column defensively.
 *
 * A flag vocabulary that grew in a later version, or a hand-edited database,
 * should not crash the ledger list — unknown entries are dropped rather than
 * trusted.
 */
export function parseFlagsFromJson(json: string | null): Bill['parseFlags'] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter(isParseFlag) : [];
  } catch {
    return [];
  }
}

export function toBill(row: BillRow): Bill {
  return {
    id: row.id,
    merchant: row.merchant,
    merchantNorm: row.merchant_norm,
    merchantAddress: row.merchant_address,
    purchasedAt: row.purchased_at,
    purchasedTime: row.purchased_time,
    totalCents: row.total_cents,
    discountCents: row.discount_cents,
    currency: row.currency,
    unitsSold: row.units_sold,
    source: row.source,
    capturePath: row.capture_path,
    pageCount: row.page_count,
    modelAlias: row.model_alias,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    parseFlags: parseFlagsFromJson(row.parse_flags),
    reviewedAt: row.reviewed_at,
    // NULL means nobody has acknowledged anything, which is different from
    // having acknowledged an empty set — `needsReview` treats them the same,
    // but an export (§15.1) should not claim a review that never happened.
    reviewedFlags: row.reviewed_flags === null ? null : parseFlagsFromJson(row.reviewed_flags),
  };
}

export function toBillItem(row: BillItemRow): BillItem {
  return {
    id: row.id,
    billId: row.bill_id,
    lineNo: row.line_no,
    name: row.name,
    nameLocal: row.name_local,
    category: row.category,
    isFood: row.is_food === 1,
    qty: row.qty,
    unit: row.unit,
    scanUnits: row.scan_units,
    priceCents: row.price_cents,
    unitPriceCents: row.unit_price_cents,
    barcode: row.barcode,
    confidence: row.confidence,
    userCorrected: row.user_corrected === 1,
    rawText: row.raw_text,
  };
}
