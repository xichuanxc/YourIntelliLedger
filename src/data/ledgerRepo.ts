/**
 * The ledger repository — the only way screens touch bill data (§2.2 rule 1).
 *
 * Every write is a single transaction, and every write recomputes the §4.11
 * integrity flags from the data actually being stored, so a bill's flags can
 * never drift from its rows.
 */

import { isValidLocalDate, isValidLocalTime, nowUtc } from '@/data/dates';
import type { SqlDriver, SqlValue } from '@/data/driver';
import { NotFoundError, ValidationError } from '@/data/errors';
import { computeParseFlags } from '@/data/integrity';
import { cleanMerchant, normaliseMerchant } from '@/data/merchant';
import {
  parseFlagsFromJson,
  toBill,
  toBillItem,
  type BillItemRow,
  type BillRow,
} from '@/data/rows';
import type {
  Bill,
  BillItem,
  BillItemPatch,
  BillPatch,
  BillSummary,
  BillWithItems,
  LedgerMonth,
  NewBillInput,
  NewBillItemInput,
} from '@/types/ledger';
import { isCategory, isUnit, type ParseFlag } from '@/types/vocabulary';

export interface ListOptions {
  /** Matches the merchant, or any line item's `name` / `name_local` (§4.10). */
  search?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------- reads ----

const BILL_COLUMNS = `id, merchant, merchant_norm, merchant_address, purchased_at,
  purchased_time, total_cents, discount_cents, currency, units_sold, source,
  capture_path, page_count, model_alias, created_at, updated_at, parse_flags`;

export async function getBill(db: SqlDriver, id: number): Promise<BillWithItems | null> {
  const row = await db.get<BillRow>(`SELECT ${BILL_COLUMNS} FROM bills WHERE id = ?`, [id]);
  if (!row) return null;
  return { ...toBill(row), items: await getBillItems(db, id) };
}

export async function getBillItems(db: SqlDriver, billId: number): Promise<BillItem[]> {
  const rows = await db.all<BillItemRow>(
    'SELECT * FROM bill_items WHERE bill_id = ? ORDER BY line_no, id',
    [billId]
  );
  return rows.map(toBillItem);
}

type BillSummaryRow = Pick<
  BillRow,
  | 'id'
  | 'merchant'
  | 'purchased_at'
  | 'purchased_time'
  | 'total_cents'
  | 'currency'
  | 'source'
  | 'parse_flags'
> & { item_count: number };

/**
 * Reverse-chronological bill list for the ledger screen.
 *
 * Ordered by date then time then id, so two bills on the same day keep a
 * stable order (and the later purchase sorts first when the receipt printed a
 * time).
 */
export async function listBills(db: SqlDriver, options: ListOptions = {}): Promise<BillSummary[]> {
  const { limit = 50, offset = 0 } = options;
  const { clause, params } = searchClause(options.search);

  const rows = await db.all<BillSummaryRow>(
    `SELECT b.id, b.merchant, b.purchased_at, b.purchased_time, b.total_cents,
            b.currency, b.source, b.parse_flags,
            (SELECT COUNT(*) FROM bill_items i WHERE i.bill_id = b.id) AS item_count
       FROM bills b
       ${clause}
      ORDER BY b.purchased_at DESC, COALESCE(b.purchased_time, '') DESC, b.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return rows.map((row) => ({
    id: row.id,
    merchant: row.merchant,
    purchasedAt: row.purchased_at,
    purchasedTime: row.purchased_time,
    totalCents: row.total_cents,
    currency: row.currency,
    source: row.source,
    itemCount: row.item_count,
    parseFlags: parseFlagsFromJson(row.parse_flags),
  }));
}

/**
 * Month totals for the ledger's section headers.
 *
 * Sums `bills.total_cents`, never the line items: an itemless bill (§5.1) has
 * no items at all, and summing through `bill_items` would silently drop every
 * restaurant and service receipt from the month header — the same trap §14.6
 * flags for the query compiler.
 */
export async function getMonthTotals(
  db: SqlDriver,
  options: Pick<ListOptions, 'search'> = {}
): Promise<Map<string, number>> {
  const { clause, params } = searchClause(options.search);
  const rows = await db.all<{ month: string; total: number | null }>(
    `SELECT strftime('%Y-%m', b.purchased_at) AS month, SUM(b.total_cents) AS total
       FROM bills b
       ${clause}
      GROUP BY month`,
    params
  );
  return new Map(rows.map((row) => [row.month, row.total ?? 0]));
}

/** The ledger screen's shape: bills grouped into months, each with its total. */
export async function listLedger(
  db: SqlDriver,
  options: ListOptions = {}
): Promise<LedgerMonth[]> {
  const [bills, totals] = await Promise.all([
    listBills(db, options),
    getMonthTotals(db, options),
  ]);

  const months: LedgerMonth[] = [];
  let current: LedgerMonth | undefined;

  for (const bill of bills) {
    const month = bill.purchasedAt.slice(0, 7);
    if (current?.month !== month) {
      // The header total covers the whole month, not just the bills on this
      // page — a running total that changed as you scrolled would be a lie.
      current = { month, totalCents: totals.get(month) ?? 0, bills: [] };
      months.push(current);
    }
    current.bills.push(bill);
  }

  return months;
}

export async function countBills(db: SqlDriver): Promise<number> {
  const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM bills');
  return row?.n ?? 0;
}

/**
 * Substring search over merchant and both item name columns (§4.10).
 *
 * `LIKE '%term%'` rather than a tokeniser, because word segmentation is what
 * breaks Chinese item names — `豆腐干` has no spaces to split on.
 */
function searchClause(search?: string): { clause: string; params: SqlValue[] } {
  const term = search?.trim();
  if (!term) return { clause: '', params: [] };

  // Escape LIKE wildcards, or a user typing "%" matches every row.
  const escaped = term.replace(/[\\%_]/g, (char) => `\\${char}`);
  const pattern = `%${escaped}%`;

  return {
    clause: `WHERE (b.merchant LIKE ? ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM bill_items i
                             WHERE i.bill_id = b.id
                               AND (i.name LIKE ? ESCAPE '\\'
                                 OR i.name_local LIKE ? ESCAPE '\\')))`,
    params: [pattern, pattern, pattern],
  };
}

// --------------------------------------------------------------- writes ----

export async function createBill(db: SqlDriver, input: NewBillInput): Promise<number> {
  validateNewBill(input);

  const items = input.items ?? [];
  const now = nowUtc();
  const discountCents = input.discountCents ?? 0;
  const flags = computeParseFlags({
    totalCents: input.totalCents,
    discountCents,
    unitsSold: input.unitsSold,
    items,
  });

  return db.transaction(async (tx) => {
    const result = await tx.run(
      `INSERT INTO bills
         (merchant, merchant_norm, merchant_address, purchased_at, purchased_time,
          total_cents, discount_cents, currency, units_sold, source, capture_path,
          page_count, model_alias, created_at, updated_at, parse_flags)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        cleanMerchant(input.merchant),
        normaliseMerchant(input.merchant),
        cleanMerchant(input.merchantAddress),
        input.purchasedAt,
        input.purchasedTime ?? null,
        input.totalCents ?? null,
        discountCents,
        input.currency ?? 'NZD',
        input.unitsSold ?? null,
        input.source,
        input.capturePath ?? null,
        0,
        input.modelAlias ?? null,
        now,
        now,
        serialiseFlags(flags),
      ]
    );

    const billId = result.lastInsertRowId;
    for (const [index, item] of items.entries()) {
      await insertItem(tx, billId, index + 1, item);
    }

    // Same transaction as the bill and its items (§5.1's "DB write (single
    // transaction)"), so a receipt can never be stored without the OCR text it
    // was parsed from — which is what makes a Week 6 re-parse possible (§4.6).
    for (const [index, ocrText] of (input.ocrPages ?? []).entries()) {
      await tx.run('INSERT INTO receipt_scans (bill_id, page_no, ocr_text) VALUES (?, ?, ?)', [
        billId,
        index + 1,
        ocrText,
      ]);
    }

    return billId;
  });
}

export async function updateBill(db: SqlDriver, id: number, patch: BillPatch): Promise<void> {
  validateBillPatch(patch);

  await db.transaction(async (tx) => {
    const existing = await tx.get<BillRow>('SELECT * FROM bills WHERE id = ?', [id]);
    if (!existing) throw new NotFoundError('Bill', id);

    await applyBillPatch(tx, id, patch);
    await recomputeParseFlags(tx, id);
  });
}

/** Writes the supplied header fields. Assumes the bill exists. */
async function applyBillPatch(tx: SqlDriver, id: number, patch: BillPatch): Promise<void> {
  const assignments: string[] = [];
  const params: SqlValue[] = [];
  const set = (column: string, value: SqlValue) => {
    assignments.push(`${column} = ?`);
    params.push(value);
  };

  if ('merchant' in patch) {
    set('merchant', cleanMerchant(patch.merchant));
    // Derived, never supplied by the caller — keeping the two in step is the
    // repository's job (§4.8).
    set('merchant_norm', normaliseMerchant(patch.merchant));
  }
  if ('merchantAddress' in patch) set('merchant_address', cleanMerchant(patch.merchantAddress));
  if ('purchasedAt' in patch) set('purchased_at', patch.purchasedAt!);
  if ('purchasedTime' in patch) set('purchased_time', patch.purchasedTime ?? null);
  if ('totalCents' in patch) set('total_cents', patch.totalCents ?? null);
  if ('discountCents' in patch) set('discount_cents', patch.discountCents ?? 0);
  if ('currency' in patch) set('currency', patch.currency!);
  if ('unitsSold' in patch) set('units_sold', patch.unitsSold ?? null);

  if (assignments.length === 0) return;

  set('updated_at', nowUtc());
  await tx.run(`UPDATE bills SET ${assignments.join(', ')} WHERE id = ?`, [...params, id]);
}

/** A line item being saved from the edit form: existing ones carry their id. */
export type DraftBillItem = NewBillItemInput & { id?: number };

/**
 * Saves a whole bill — header fields and the complete item list — in one
 * transaction.
 *
 * The edit screen needs this rather than a sequence of `updateBill` +
 * `addBillItem` + `deleteBillItem` calls: applied separately, a failure
 * halfway through would leave a bill holding some of the user's edits and not
 * others, which is the same defect §10 tests for on the receipt-write path.
 *
 * Items are matched by id. Anything present in the database but absent from
 * `items` is deleted; `line_no` is renumbered from the supplied order, so
 * deleting the second of four lines does not leave a gap.
 */
export async function updateBillWithItems(
  db: SqlDriver,
  billId: number,
  patch: BillPatch,
  items: readonly DraftBillItem[]
): Promise<void> {
  validateBillPatch(patch);
  items.forEach((item, index) => validateItem(item, `items[${index}]`));

  await db.transaction(async (tx) => {
    const existing = await tx.get<BillRow>('SELECT * FROM bills WHERE id = ?', [billId]);
    if (!existing) throw new NotFoundError('Bill', billId);

    await applyBillPatch(tx, billId, patch);

    const storedRows = await tx.all<BillItemRow>('SELECT * FROM bill_items WHERE bill_id = ?', [
      billId,
    ]);
    const stored = new Map(storedRows.map((row) => [row.id, row]));
    const keptIds = new Set(items.map((item) => item.id).filter((id): id is number => id != null));

    for (const row of storedRows) {
      if (!keptIds.has(row.id)) await tx.run('DELETE FROM bill_items WHERE id = ?', [row.id]);
    }

    for (const [index, item] of items.entries()) {
      const lineNo = index + 1;
      const row = item.id == null ? undefined : stored.get(item.id);

      if (!row) {
        await insertItem(tx, billId, lineNo, item);
        continue;
      }

      // `user_corrected` marks a genuine correction — the corpus a future
      // `parse_corrections` table would be built from (§4.11) — so re-saving
      // an untouched form must not manufacture one. That is the difference
      // from `updateBillItem`, which is an explicit correction request.
      const changed = itemDiffersFromRow(item, row);
      await tx.run(
        `UPDATE bill_items
            SET line_no = ?, name = ?, name_local = ?, category = ?, is_food = ?,
                qty = ?, unit = ?, scan_units = ?, price_cents = ?,
                unit_price_cents = ?, barcode = ?,
                user_corrected = ?
          WHERE id = ?`,
        [
          lineNo,
          item.name.trim(),
          item.nameLocal?.trim() || null,
          item.category,
          item.isFood === false ? 0 : 1,
          item.qty ?? 1,
          item.unit ?? 'pc',
          item.scanUnits ?? 1,
          item.priceCents ?? null,
          item.unitPriceCents ?? null,
          item.barcode ?? null,
          changed || row.user_corrected === 1 ? 1 : 0,
          row.id,
        ]
      );
    }

    await touchBill(tx, billId);
    await recomputeParseFlags(tx, billId);
  });
}

function itemDiffersFromRow(item: DraftBillItem, row: BillItemRow): boolean {
  return (
    item.name.trim() !== row.name ||
    (item.nameLocal?.trim() || null) !== row.name_local ||
    item.category !== row.category ||
    (item.isFood === false ? 0 : 1) !== row.is_food ||
    (item.qty ?? 1) !== row.qty ||
    (item.unit ?? 'pc') !== row.unit ||
    (item.scanUnits ?? 1) !== row.scan_units ||
    (item.priceCents ?? null) !== row.price_cents ||
    (item.unitPriceCents ?? null) !== row.unit_price_cents ||
    (item.barcode ?? null) !== row.barcode
  );
}

export async function addBillItem(
  db: SqlDriver,
  billId: number,
  item: NewBillItemInput
): Promise<number> {
  validateItem(item, 'item');

  return db.transaction(async (tx) => {
    const bill = await tx.get<{ id: number }>('SELECT id FROM bills WHERE id = ?', [billId]);
    if (!bill) throw new NotFoundError('Bill', billId);

    const last = await tx.get<{ max_line: number | null }>(
      'SELECT MAX(line_no) AS max_line FROM bill_items WHERE bill_id = ?',
      [billId]
    );
    const id = await insertItem(tx, billId, (last?.max_line ?? 0) + 1, item);
    await touchBill(tx, billId);
    await recomputeParseFlags(tx, billId);
    return id;
  });
}

/**
 * Corrects one line item. Any edit sets `user_corrected = 1` (§5.6) — that
 * flag is the corpus a future `parse_corrections` table (§4.11) would be built
 * from, so it is set even when the new value happens to equal the old one.
 */
export async function updateBillItem(
  db: SqlDriver,
  itemId: number,
  patch: BillItemPatch
): Promise<void> {
  validateItemPatch(patch);

  await db.transaction(async (tx) => {
    const existing = await tx.get<{ bill_id: number }>(
      'SELECT bill_id FROM bill_items WHERE id = ?',
      [itemId]
    );
    if (!existing) throw new NotFoundError('Bill item', itemId);

    const assignments: string[] = [];
    const params: SqlValue[] = [];
    const set = (column: string, value: SqlValue) => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if ('name' in patch) set('name', patch.name!);
    if ('nameLocal' in patch) set('name_local', patch.nameLocal ?? null);
    if ('category' in patch) set('category', patch.category!);
    if ('isFood' in patch) set('is_food', patch.isFood ? 1 : 0);
    if ('qty' in patch) set('qty', patch.qty!);
    if ('unit' in patch) set('unit', patch.unit!);
    if ('scanUnits' in patch) set('scan_units', patch.scanUnits!);
    if ('priceCents' in patch) set('price_cents', patch.priceCents ?? null);
    if ('unitPriceCents' in patch) set('unit_price_cents', patch.unitPriceCents ?? null);
    if ('barcode' in patch) set('barcode', patch.barcode ?? null);

    if (assignments.length === 0) return;

    set('user_corrected', 1);
    await tx.run(`UPDATE bill_items SET ${assignments.join(', ')} WHERE id = ?`, [...params, itemId]);
    await touchBill(tx, existing.bill_id);
    await recomputeParseFlags(tx, existing.bill_id);
  });
}

export async function deleteBillItem(db: SqlDriver, itemId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx.get<{ bill_id: number }>(
      'SELECT bill_id FROM bill_items WHERE id = ?',
      [itemId]
    );
    if (!existing) throw new NotFoundError('Bill item', itemId);

    await tx.run('DELETE FROM bill_items WHERE id = ?', [itemId]);
    await touchBill(tx, existing.bill_id);
    await recomputeParseFlags(tx, existing.bill_id);
  });
}

/**
 * Deletes a bill; `bill_items` and `receipt_scans` follow by `ON DELETE
 * CASCADE` (which needs `PRAGMA foreign_keys = ON`, set in §4.1).
 *
 * Receipt images under `receipts/{bill_id}/` are files, not rows, so they are
 * removed by the capture module's own delete path (§4.5) — the orphan sweep on
 * app start is the backstop if that ever fails.
 */
export async function deleteBill(db: SqlDriver, id: number): Promise<void> {
  const result = await db.run('DELETE FROM bills WHERE id = ?', [id]);
  if (result.changes === 0) throw new NotFoundError('Bill', id);
}

/**
 * Removes every bill, cascading to items and cached scans. Returns how many
 * were deleted.
 *
 * This is the ledger half of §15.2's delete-all. The rest of that feature —
 * clearing `query_log`, deleting the `receipts/` image directory, resetting
 * MMKV and revoking the device token — belongs with the Week 9 screen that
 * asks the user to type-to-confirm. Nothing here prompts; callers own that.
 */
export async function deleteAllBills(db: SqlDriver): Promise<number> {
  const result = await db.run('DELETE FROM bills');
  return result.changes;
}

/**
 * Marks every low-confidence line on a bill as checked, then recomputes the
 * §4.11 flags.
 *
 * ## Why this exists, and why only this flag
 *
 * `low_confidence` was unclearable. It is raised when any item has
 * `confidence = 'low'`, flags are recomputed on every write — but nothing in
 * the app could *change* an item's confidence after the parse. So a bill
 * marked "needs review" stayed marked however carefully it was reviewed. The
 * label asked for an action the app did not offer.
 *
 * `confidence` records how sure the **model** was. A person reading the line
 * and vouching for it supersedes that, which is why this is not the "silent
 * correction" §4.11 forbids: no amount, name or category is touched — only
 * the record of who last stood behind them.
 *
 * The other flags are deliberately not clearable this way. `sum_mismatch`,
 * `missing_price` and `unit_mismatch` are claims about the numbers, and they
 * clear by fixing the numbers. Dismissing one would destroy the evidence it
 * exists to preserve.
 *
 * Returns how many lines were confirmed; 0 when there was nothing to do.
 */
export async function confirmLowConfidenceItems(db: SqlDriver, billId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const result = await tx.run(
      "UPDATE bill_items SET confidence = 'high' WHERE bill_id = ? AND confidence = 'low'",
      [billId]
    );
    await recomputeParseFlags(tx, billId);
    return result.changes;
  });
}

/**
 * Replaces the cached OCR text for a bill (§4.6).
 *
 * Pages are stored 1-based in capture order, so a long supermarket receipt
 * captured as two pages re-parses in the right order later (§5.2).
 */
export async function replaceReceiptScans(
  db: SqlDriver,
  billId: number,
  pages: readonly string[]
): Promise<void> {
  await db.transaction(async (tx) => {
    const bill = await tx.get<{ id: number }>('SELECT id FROM bills WHERE id = ?', [billId]);
    if (!bill) throw new NotFoundError('Bill', billId);

    await tx.run('DELETE FROM receipt_scans WHERE bill_id = ?', [billId]);
    for (const [index, ocrText] of pages.entries()) {
      await tx.run(
        'INSERT INTO receipt_scans (bill_id, page_no, ocr_text) VALUES (?, ?, ?)',
        [billId, index + 1, ocrText]
      );
    }
  });
}

/** The cached OCR text for a bill, in page order. */
export async function getReceiptScans(db: SqlDriver, billId: number): Promise<string[]> {
  const rows = await db.all<{ ocr_text: string }>(
    'SELECT ocr_text FROM receipt_scans WHERE bill_id = ? ORDER BY page_no',
    [billId]
  );
  return rows.map((row) => row.ocr_text);
}

// ------------------------------------------------------------- internals ----

async function insertItem(
  tx: SqlDriver,
  billId: number,
  lineNo: number,
  item: NewBillItemInput
): Promise<number> {
  const result = await tx.run(
    `INSERT INTO bill_items
       (bill_id, line_no, name, name_local, category, is_food, qty, unit,
        scan_units, price_cents, unit_price_cents, barcode, confidence,
        user_corrected, raw_text)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      billId,
      lineNo,
      item.name.trim(),
      item.nameLocal?.trim() || null,
      item.category,
      item.isFood === false ? 0 : 1,
      item.qty ?? 1,
      item.unit ?? 'pc',
      item.scanUnits ?? 1,
      item.priceCents ?? null,
      item.unitPriceCents ?? null,
      item.barcode ?? null,
      item.confidence ?? null,
      item.userCorrected ? 1 : 0,
      item.rawText ?? null,
    ]
  );
  return result.lastInsertRowId;
}

async function touchBill(tx: SqlDriver, billId: number): Promise<void> {
  await tx.run('UPDATE bills SET updated_at = ? WHERE id = ?', [nowUtc(), billId]);
}

/** Recomputes §4.11 flags from what is currently stored. */
async function recomputeParseFlags(tx: SqlDriver, billId: number): Promise<void> {
  const bill = await tx.get<Pick<BillRow, 'total_cents' | 'discount_cents' | 'units_sold'>>(
    'SELECT total_cents, discount_cents, units_sold FROM bills WHERE id = ?',
    [billId]
  );
  if (!bill) return;

  const items = await tx.all<Pick<BillItemRow, 'price_cents' | 'scan_units' | 'confidence'>>(
    'SELECT price_cents, scan_units, confidence FROM bill_items WHERE bill_id = ?',
    [billId]
  );

  const flags = computeParseFlags({
    totalCents: bill.total_cents,
    discountCents: bill.discount_cents,
    unitsSold: bill.units_sold,
    items: items.map((item) => ({
      priceCents: item.price_cents,
      scanUnits: item.scan_units,
      confidence: item.confidence,
    })),
  });

  await tx.run('UPDATE bills SET parse_flags = ? WHERE id = ?', [serialiseFlags(flags), billId]);
}

function serialiseFlags(flags: ParseFlag[]): string | null {
  return flags.length > 0 ? JSON.stringify(flags) : null;
}

// ------------------------------------------------------------ validation ----

function validateNewBill(input: NewBillInput): void {
  if (!isValidLocalDate(input.purchasedAt)) {
    throw new ValidationError(`"${input.purchasedAt}" is not a valid date`, 'purchasedAt');
  }
  if (input.purchasedTime != null && !isValidLocalTime(input.purchasedTime)) {
    throw new ValidationError(`"${input.purchasedTime}" is not a valid time`, 'purchasedTime');
  }
  validateMoney(input.totalCents, 'totalCents');
  if (input.discountCents != null && input.discountCents < 0) {
    // Discounts are stored as a positive magnitude and subtracted (§4.11);
    // a negative one would silently invert the sum check.
    throw new ValidationError('Discount must be a positive amount', 'discountCents');
  }
  if (input.currency != null && !/^[A-Z]{3}$/.test(input.currency)) {
    throw new ValidationError('Currency must be a 3-letter ISO code', 'currency');
  }
  if (input.unitsSold != null && (!Number.isInteger(input.unitsSold) || input.unitsSold < 0)) {
    throw new ValidationError('Units sold must be a whole number', 'unitsSold');
  }
  input.items?.forEach((item, index) => validateItem(item, `items[${index}]`));
}

function validateBillPatch(patch: BillPatch): void {
  if (patch.purchasedAt != null && !isValidLocalDate(patch.purchasedAt)) {
    throw new ValidationError(`"${patch.purchasedAt}" is not a valid date`, 'purchasedAt');
  }
  if (patch.purchasedTime != null && !isValidLocalTime(patch.purchasedTime)) {
    throw new ValidationError(`"${patch.purchasedTime}" is not a valid time`, 'purchasedTime');
  }
  validateMoney(patch.totalCents, 'totalCents');
  if (patch.discountCents != null && patch.discountCents < 0) {
    throw new ValidationError('Discount must be a positive amount', 'discountCents');
  }
  if (patch.currency != null && !/^[A-Z]{3}$/.test(patch.currency)) {
    throw new ValidationError('Currency must be a 3-letter ISO code', 'currency');
  }
}

function validateItem(item: NewBillItemInput, field: string): void {
  if (item.name.trim() === '') {
    throw new ValidationError('Item name cannot be empty', `${field}.name`);
  }
  if (!isCategory(item.category)) {
    throw new ValidationError(`"${item.category}" is not a valid category`, `${field}.category`);
  }
  if (item.unit != null && !isUnit(item.unit)) {
    throw new ValidationError(`"${item.unit}" is not a valid unit`, `${field}.unit`);
  }
  if (item.qty != null && (!Number.isFinite(item.qty) || item.qty < 0)) {
    throw new ValidationError('Quantity must be zero or more', `${field}.qty`);
  }
  if (item.scanUnits != null && (!Number.isInteger(item.scanUnits) || item.scanUnits < 0)) {
    throw new ValidationError('Scan units must be a whole number', `${field}.scanUnits`);
  }
  validateMoney(item.priceCents, `${field}.priceCents`);
  validateMoney(item.unitPriceCents, `${field}.unitPriceCents`);
}

function validateItemPatch(patch: BillItemPatch): void {
  if (patch.name != null && patch.name.trim() === '') {
    throw new ValidationError('Item name cannot be empty', 'name');
  }
  if (patch.category != null && !isCategory(patch.category)) {
    throw new ValidationError(`"${patch.category}" is not a valid category`, 'category');
  }
  if (patch.unit != null && !isUnit(patch.unit)) {
    throw new ValidationError(`"${patch.unit}" is not a valid unit`, 'unit');
  }
  if (patch.qty != null && (!Number.isFinite(patch.qty) || patch.qty < 0)) {
    throw new ValidationError('Quantity must be zero or more', 'qty');
  }
  if (patch.scanUnits != null && (!Number.isInteger(patch.scanUnits) || patch.scanUnits < 0)) {
    throw new ValidationError('Scan units must be a whole number', 'scanUnits');
  }
  validateMoney(patch.priceCents, 'priceCents');
  validateMoney(patch.unitPriceCents, 'unitPriceCents');
}

/**
 * Money is integer cents (§4.3). A REAL reaching the database here is the
 * exact defect that produces cent drift in the §5.5 sum checks, so it is
 * rejected rather than rounded.
 */
function validateMoney(cents: number | null | undefined, field: string): void {
  if (cents == null) return;
  if (!Number.isInteger(cents)) {
    throw new ValidationError('Amounts must be whole cents', field);
  }
}

export type { Bill, BillItem, BillWithItems };
