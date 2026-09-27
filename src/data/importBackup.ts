/**
 * Reading a backup back in (§15.1).
 *
 * The export exists so a ledger survives a lost phone. That is only true if
 * something can read it, and the moment it can, this file becomes the most
 * dangerous code in the data layer: it takes a document from outside the app
 * and turns it into rows. A parser that is merely optimistic will happily
 * write half a restore and stop.
 *
 * So validation is separate from writing, and total. `parseBackup` either
 * returns a whole backup it has checked or throws; nothing reaches the
 * database until every bill in the file has been looked at. A file that is
 * wrong in its last bill must not leave the first forty imported.
 *
 * ## Identifiers are not preserved
 *
 * A backup carries the ids the bills had when it was written, and those mean
 * nothing here -- the ledger being restored into may already be using them.
 * Bills are therefore re-created rather than re-inserted, which also means
 * `merchant_norm` (§4.8) and the §4.11 integrity flags are derived fresh by
 * `createBill` instead of being trusted from the file. A backup is evidence
 * of what was bought; it is not authority over how this build normalises.
 *
 * The one thing that cannot be recomputed, and so is carried verbatim, is the
 * human review record: `reviewedAt` and `reviewedFlags` record that a person
 * looked at a bill's flags and accepted them. Recomputing that would be
 * inventing it.
 *
 * ## Importing twice
 *
 * People restore the same file twice, usually by accident. Each bill is
 * checked against the existing ledger the same way a freshly scanned receipt
 * is (`findDuplicateBill`: same shop, same day, same total) and skipped if it
 * is already there. The result says how many were skipped, because "imported
 * 0 bills" and "imported 0 bills, 47 already present" are different outcomes
 * and only one of them is a problem.
 */

import type { SqlDriver } from '@/data/driver';
import { EXPORT_SCHEMA_VERSION, type Backup, type BackupBill } from '@/data/exportBackup';
import { createBill, findDuplicateBill } from '@/data/ledgerRepo';
import { normaliseMerchant } from '@/data/merchant';
import {
  CATEGORIES,
  CONFIDENCE_LEVELS,
  UNITS,
  isCategory,
  isConfidence,
  isUnit,
} from '@/types/vocabulary';

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

export interface ImportResult {
  imported: number;
  /** Already in the ledger, by shop, day and total. Not an error. */
  skipped: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new BackupFormatError(`${what} should be text`);
  return value;
}

function optionalString(value: unknown, what: string): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, what);
}

function requireNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new BackupFormatError(`${what} should be a number`);
  }
  return value;
}

function optionalNumber(value: unknown, what: string): number | null {
  if (value === null || value === undefined) return null;
  return requireNumber(value, what);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const text = requireString(value, what);
  if (!(allowed as readonly string[]).includes(text)) {
    throw new BackupFormatError(`${what} is not one this version knows: ${text}`);
  }
  return text as T;
}

/**
 * Checks a parsed document all the way through, or throws.
 *
 * The messages name the bill by its position, because "bill 12" is something
 * a person can find in a file and "invalid input" is not.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupFormatError('That file is not a backup — it is not valid JSON.');
  }

  if (!isObject(raw)) throw new BackupFormatError('That file is not a backup.');

  const version = raw.schema_version;
  if (version !== EXPORT_SCHEMA_VERSION) {
    // Refusing an unknown version beats guessing at it: a later format may
    // mean something different by the same field name.
    throw new BackupFormatError(
      `This backup is version ${String(version)}; this app reads version ${EXPORT_SCHEMA_VERSION}.`
    );
  }

  if (!Array.isArray(raw.bills)) throw new BackupFormatError('That backup has no bills in it.');

  const bills = raw.bills.map((bill, index) => parseBill(bill, index + 1));

  return {
    schema_version: EXPORT_SCHEMA_VERSION,
    exported_at: typeof raw.exported_at === 'string' ? raw.exported_at : '',
    bills,
    preferences: isObject(raw.preferences) ? (raw.preferences as Backup['preferences']) : {},
  };
}

function parseBill(raw: unknown, position: number): BackupBill {
  if (!isObject(raw)) throw new BackupFormatError(`Bill ${position} is not readable.`);
  const at = (field: string) => `Bill ${position}: ${field}`;

  const items = Array.isArray(raw.items) ? raw.items : [];

  return {
    id: optionalNumber(raw.id, at('id')) ?? 0,
    merchant: optionalString(raw.merchant, at('merchant')),
    merchantNorm: optionalString(raw.merchantNorm, at('merchantNorm')),
    merchantAddress: optionalString(raw.merchantAddress, at('address')),
    purchasedAt: requireString(raw.purchasedAt, at('purchase date')),
    purchasedTime: optionalString(raw.purchasedTime, at('purchase time')),
    totalCents: optionalNumber(raw.totalCents, at('total')),
    discountCents: optionalNumber(raw.discountCents, at('discount')) ?? 0,
    currency: optionalString(raw.currency, at('currency')) ?? 'NZD',
    unitsSold: optionalNumber(raw.unitsSold, at('units sold')),
    source: optionalString(raw.source, at('source')) ?? 'manual',
    capturePath: optionalString(raw.capturePath, at('capture path')),
    pageCount: optionalNumber(raw.pageCount, at('page count')) ?? 0,
    modelAlias: optionalString(raw.modelAlias, at('model')),
    parseFlags: Array.isArray(raw.parseFlags) ? raw.parseFlags.map(String) : [],
    reviewedAt: optionalString(raw.reviewedAt, at('reviewed at')),
    reviewedFlags: Array.isArray(raw.reviewedFlags) ? raw.reviewedFlags.map(String) : null,
    createdAt: optionalString(raw.createdAt, at('created at')) ?? '',
    updatedAt: optionalString(raw.updatedAt, at('updated at')) ?? '',
    pages: Array.isArray(raw.pages) ? raw.pages.map((page) => requireString(page, at('page'))) : [],
    items: items.map((item, index) => parseItem(item, position, index + 1)),
  };
}

function parseItem(raw: unknown, billPosition: number, line: number) {
  if (!isObject(raw)) throw new BackupFormatError(`Bill ${billPosition}, line ${line} is not readable.`);
  const at = (field: string) => `Bill ${billPosition}, line ${line}: ${field}`;

  return {
    lineNo: optionalNumber(raw.lineNo, at('line number')) ?? line,
    name: requireString(raw.name, at('name')),
    nameLocal: optionalString(raw.nameLocal, at('local name')),
    // Closed vocabularies (§4.7) are CHECK constraints in SQLite: letting an
    // unknown one through would fail at the INSERT, mid-restore, with a
    // message about a constraint rather than about the file.
    category: oneOf(raw.category, CATEGORIES, at('category')),
    isFood: raw.isFood !== false,
    qty: optionalNumber(raw.qty, at('quantity')) ?? 1,
    unit: oneOf(raw.unit ?? 'pc', UNITS, at('unit')),
    scanUnits: optionalNumber(raw.scanUnits, at('scan units')) ?? 1,
    priceCents: optionalNumber(raw.priceCents, at('price')),
    unitPriceCents: optionalNumber(raw.unitPriceCents, at('unit price')),
    barcode: optionalString(raw.barcode, at('barcode')),
    confidence:
      raw.confidence === null || raw.confidence === undefined
        ? null
        : oneOf(raw.confidence, CONFIDENCE_LEVELS, at('confidence')),
    userCorrected: raw.userCorrected === true,
    rawText: optionalString(raw.rawText, at('raw text')),
  };
}

/** Narrows a validated string back to its vocabulary, or says which failed. */
function narrow<T extends string>(
  value: string,
  guard: (candidate: string) => candidate is T,
  what: string
): T {
  if (!guard(value)) throw new BackupFormatError(`${value} is not a ${what} this version knows.`);
  return value;
}

/**
 * Writes a validated backup into the ledger, skipping what is already there.
 *
 * Each bill goes in through `createBill`, which is the same path a scanned
 * receipt takes, so normalisation and integrity flags are this build's rather
 * than the file's.
 */
export async function restoreBackup(db: SqlDriver, backup: Backup): Promise<ImportResult> {
  let imported = 0;
  let skipped = 0;

  for (const bill of backup.bills) {
    const duplicate = await findDuplicateBill(db, {
      // Normalised here rather than taken from the file: the comparison has
      // to be made on this build's rules, or a backup written by an older
      // normalisation would never match itself.
      merchantNorm: normaliseMerchant(bill.merchant),
      purchasedAt: bill.purchasedAt,
      purchasedTime: bill.purchasedTime,
      totalCents: bill.totalCents,
    });
    if (duplicate) {
      skipped += 1;
      continue;
    }

    const billId = await createBill(db, {
      merchant: bill.merchant,
      merchantAddress: bill.merchantAddress,
      purchasedAt: bill.purchasedAt,
      purchasedTime: bill.purchasedTime,
      totalCents: bill.totalCents,
      discountCents: bill.discountCents,
      currency: bill.currency,
      unitsSold: bill.unitsSold,
      source: bill.source as never,
      capturePath: bill.capturePath as never,
      modelAlias: bill.modelAlias,
      ocrPages: bill.pages,
      items: bill.items.map((item) => ({
        name: item.name,
        nameLocal: item.nameLocal,
        // Re-checked rather than cast. `parseBackup` has already validated
        // these, but `restoreBackup` is separately callable and a closed
        // vocabulary (§4.7) is a CHECK constraint: an unknown value would
        // otherwise fail at the INSERT, mid-restore.
        category: narrow(item.category, isCategory, 'category'),
        isFood: item.isFood,
        qty: item.qty,
        unit: narrow(item.unit, isUnit, 'unit'),
        scanUnits: item.scanUnits,
        priceCents: item.priceCents,
        unitPriceCents: item.unitPriceCents,
        barcode: item.barcode,
        confidence:
          item.confidence === null ? null : narrow(item.confidence, isConfidence, 'confidence'),
        rawText: item.rawText,
      })),
    });

    // Carried rather than recomputed: this is the record that a person
    // reviewed the bill, and nothing can derive that from a receipt.
    if (bill.reviewedAt) {
      await db.run('UPDATE bills SET reviewed_at = ?, reviewed_flags = ? WHERE id = ?', [
        bill.reviewedAt,
        // JSON, matching how `rows.ts` reads the column back.
        bill.reviewedFlags ? JSON.stringify(bill.reviewedFlags) : null,
        billId,
      ]);
    }

    imported += 1;
  }

  return { imported, skipped };
}
