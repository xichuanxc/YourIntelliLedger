/**
 * Everything the user has, in a file they keep (§15.1).
 *
 * This exists because automatic backup is deliberately switched off (§8.2).
 * A ledger that lives only on one handset is a ledger one dropped phone from
 * gone, and the answer cannot be "we upload it somewhere" without giving up
 * the property the whole project is built on. So the answer is an export the
 * user holds.
 *
 * It is also the reason delete-all can be offered at all. §15.2 is
 * irreversible by design, and offering an irreversible action without first
 * offering a copy would be careless.
 *
 * ## The JSON is the format, and it is a promise
 *
 * `schema_version` is there so an export written today still restores into a
 * build written next year. That obliges this shape to be conservative: field
 * names are the database's, not the UI's, and every column that carries
 * meaning is present even when it is null. `nameLocal`, `scanUnits` and
 * `unitPriceCents` are named explicitly in the spec because each is easy to
 * think redundant and none is -- a dropped `scanUnits` silently breaks the
 * §4.9 reconciliation the next time anything recomputes it.
 *
 * ## The CSVs are for the user, not for us
 *
 * They flatten, they lose the bill/item nesting, and they are not
 * re-importable. That is the point: they open in a spreadsheet, which is what
 * somebody asking "can I see my own data" usually means. Saying so plainly in
 * the UI matters more than the format.
 *
 * Pure, and free of any file system or share sheet. What a platform does with
 * these strings is the caller's business; what goes in them is testable here.
 */

import type { BillWithItems } from '@/types/ledger';

/**
 * Bumped only when the shape changes incompatibly. A reader should refuse a
 * version it does not know rather than guess at it.
 */
export const EXPORT_SCHEMA_VERSION = 1;

export interface ExportPreferences {
  [key: string]: string | number | boolean | null;
}

export interface BackupBill {
  id: number;
  merchant: string | null;
  merchantNorm: string | null;
  merchantAddress: string | null;
  purchasedAt: string;
  purchasedTime: string | null;
  totalCents: number | null;
  discountCents: number;
  currency: string;
  unitsSold: number | null;
  source: string;
  capturePath: string | null;
  /** Images on disk, which an export does not carry. Kept for fidelity. */
  pageCount: number;
  /** Which model read this receipt. Provenance, not a setting. */
  modelAlias: string | null;
  parseFlags: string[];
  /**
   * The §4.11 human-review record. Without these two a restore quietly
   * reverts every reviewed bill to "needs review", undoing work a person did
   * by hand -- the one kind of data in here that cannot be recomputed.
   */
  reviewedAt: string | null;
  reviewedFlags: string[] | null;
  createdAt: string;
  updatedAt: string;
  /** OCR text per page, in capture order (§5.2). Images are not included. */
  pages: string[];
  items: BackupItem[];
}

export interface BackupItem {
  lineNo: number;
  name: string;
  nameLocal: string | null;
  category: string;
  isFood: boolean;
  qty: number;
  unit: string;
  scanUnits: number;
  priceCents: number | null;
  unitPriceCents: number | null;
  barcode: string | null;
  confidence: string | null;
  /** Whether a person has edited this line, as against the model's reading. */
  userCorrected: boolean;
  /** The receipt's own words for this line. Provenance; never regenerated. */
  rawText: string | null;
}

export interface Backup {
  schema_version: number;
  exported_at: string;
  bills: BackupBill[];
  preferences: ExportPreferences;
}

/** One bill and its pages, as the backup records them. */
export function toBackupBill(bill: BillWithItems, pages: readonly string[]): BackupBill {
  return {
    id: bill.id,
    merchant: bill.merchant,
    merchantNorm: bill.merchantNorm,
    merchantAddress: bill.merchantAddress,
    purchasedAt: bill.purchasedAt,
    purchasedTime: bill.purchasedTime,
    totalCents: bill.totalCents,
    discountCents: bill.discountCents,
    currency: bill.currency,
    unitsSold: bill.unitsSold,
    source: bill.source,
    capturePath: bill.capturePath,
    pageCount: bill.pageCount,
    modelAlias: bill.modelAlias,
    parseFlags: [...bill.parseFlags],
    reviewedAt: bill.reviewedAt,
    reviewedFlags: bill.reviewedFlags ? [...bill.reviewedFlags] : null,
    createdAt: bill.createdAt,
    updatedAt: bill.updatedAt,
    pages: [...pages],
    items: bill.items.map((item) => ({
      lineNo: item.lineNo,
      name: item.name,
      nameLocal: item.nameLocal,
      category: item.category,
      isFood: item.isFood,
      qty: item.qty,
      unit: item.unit,
      scanUnits: item.scanUnits,
      priceCents: item.priceCents,
      unitPriceCents: item.unitPriceCents,
      barcode: item.barcode,
      confidence: item.confidence,
      userCorrected: item.userCorrected,
      rawText: item.rawText,
    })),
  };
}

export function buildBackup(
  bills: readonly BackupBill[],
  preferences: ExportPreferences,
  now: Date = new Date()
): Backup {
  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: now.toISOString(),
    bills: [...bills],
    preferences: { ...preferences },
  };
}

/** `yourintelliledger-export-2026-09-28.json` and its siblings. */
export function exportFilename(kind: 'json' | 'items' | 'bills', now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10);
  const stem = `yourintelliledger-export-${day}`;
  return kind === 'json' ? `${stem}.json` : `${stem}-${kind}.csv`;
}

/**
 * A CSV field, quoted when it has to be.
 *
 * Merchant names contain commas, item names contain quotes, and an OCR line
 * can contain a newline. Any of the three silently corrupts a spreadsheet
 * that a naive join would produce, and the corruption looks like bad data
 * rather than a bad exporter.
 */
function csvField(value: string | number | boolean | null): string {
  if (value === null) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(header: readonly string[], rows: readonly (string | number | boolean | null)[][]): string {
  // A trailing newline: POSIX text, and spreadsheets do not mind.
  return [header.join(','), ...rows.map((r) => r.map(csvField).join(','))].join('\n') + '\n';
}

/** One row per line item, with the bill's identity repeated onto each. */
export function itemsCsv(bills: readonly BackupBill[]): string {
  const rows = bills.flatMap((bill) =>
    bill.items.map((item) => [
      bill.id, bill.purchasedAt, bill.merchant, bill.currency,
      item.lineNo, item.name, item.nameLocal, item.category, item.isFood,
      item.qty, item.unit, item.scanUnits, item.priceCents,
      item.unitPriceCents, item.barcode, item.confidence,
      item.userCorrected, item.rawText,
    ])
  );
  return csv(
    ['bill_id', 'purchased_at', 'merchant', 'currency', 'line_no', 'name',
     'name_local', 'category', 'is_food', 'qty', 'unit', 'scan_units',
     'price_cents', 'unit_price_cents', 'barcode', 'confidence',
     'user_corrected', 'raw_text'],
    rows
  );
}

/** One row per bill. Pages and items are left to the other two formats. */
export function billsCsv(bills: readonly BackupBill[]): string {
  const rows = bills.map((bill) => [
    bill.id, bill.purchasedAt, bill.purchasedTime, bill.merchant,
    bill.merchantAddress, bill.totalCents, bill.discountCents, bill.currency,
    bill.unitsSold, bill.source, bill.capturePath, bill.items.length,
    bill.parseFlags.join(' '), bill.reviewedAt,
    bill.reviewedFlags ? bill.reviewedFlags.join(' ') : null,
    bill.createdAt, bill.updatedAt,
  ]);
  return csv(
    ['bill_id', 'purchased_at', 'purchased_time', 'merchant', 'merchant_address',
     'total_cents', 'discount_cents', 'currency', 'units_sold', 'source',
     'capture_path', 'item_count', 'parse_flags', 'reviewed_at',
     'reviewed_flags', 'created_at', 'updated_at'],
    rows
  );
}
