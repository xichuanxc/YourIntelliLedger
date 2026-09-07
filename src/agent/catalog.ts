/**
 * The data catalog — §6.3's ~100 tokens of "what is actually in this ledger".
 *
 * It sits between the static prefix (system prompt + tool schemas, which must
 * stay byte-identical for the prefix cache to hit) and the conversation, so it
 * is the one place the model learns anything about *this* user's data.
 *
 * That makes it more load-bearing than its size suggests. §14.1 leaves
 * `filters[].value` untyped — the schema cannot enumerate merchants, and it
 * does not enumerate categories either — so without the catalog the model is
 * guessing at both. A guess produces either a rejection (§14.5) or, worse, a
 * confident answer about a merchant that was never in the ledger.
 *
 * ## Invalidation, without a hook to forget
 *
 * §6.3 says "invalidated on bill write". The obvious implementation calls a
 * `clearCatalog()` from each of `ledgerRepo`'s nine write functions, and the
 * tenth one written next year forgets — a stale catalog then quietly tells the
 * model the ledger ends in July for as long as the cache lives.
 *
 * So the cache is keyed by a **stamp derived from the data itself**: how many
 * bills, how many items, and the newest `updated_at`. Every write changes at
 * least one of those, including writes nobody has written yet, and the check
 * is a single aggregate. Structural rather than remembered.
 */

import { getDataRange } from '@/data/insightsRepo';
import type { SqlDriver } from '@/data/driver';
import type { LocalDate } from '@/types/ledger';
import { CATEGORIES, type Category } from '@/types/vocabulary';

/** Enough to ground a question; few enough to stay inside §6.3's budget. */
export const MAX_MERCHANTS = 8;
/** One pathological receipt should not spend the whole catalog on itself. */
const MAX_MERCHANT_LENGTH = 40;

const DEFAULT_CURRENCY = 'NZD';

/**
 * Snake_case because this is a wire shape, not an app type — it is serialised
 * into the prompt exactly as §6.3 prints it.
 */
export interface DataCatalog {
  categories: readonly Category[];
  merchants_top: string[];
  data_range: { first_bill: LocalDate | null; last_bill: LocalDate | null };
  currency: string;
  bill_count: number;
}

export interface CachedCatalog {
  stamp: string;
  catalog: DataCatalog;
}

/**
 * The cache as its consumer sees it — same seam as `ProductCache`, and for the
 * same reason: MMKV is a native module and cannot load in the `node` test
 * project, so the logic is storage-agnostic and gets an in-memory
 * implementation under test.
 */
export interface CatalogCache {
  read(): CachedCatalog | null;
  write(entry: CachedCatalog): void;
}

export function createMemoryCatalogCache(): CatalogCache {
  let entry: CachedCatalog | null = null;
  return {
    read: () => entry,
    write: (next) => {
      entry = next;
    },
  };
}

// ------------------------------------------------------------------ build ---

interface StampRow {
  bills: number;
  items: number;
  touched: string;
}

/**
 * Cheap enough to run on every catalog read, and sensitive to every write:
 * an insert or delete moves a count, an edit moves `updated_at` (item edits
 * included — `ledgerRepo` touches the parent bill).
 */
async function currentStamp(db: SqlDriver): Promise<string> {
  const row = await db.get<StampRow>(
    `SELECT COUNT(*) AS bills,
            COALESCE(MAX(updated_at), '') AS touched,
            (SELECT COUNT(*) FROM bill_items) AS items
       FROM bills`
  );
  return [row?.bills ?? 0, row?.items ?? 0, row?.touched ?? ''].join(':');
}

/**
 * Grouped by `merchant_norm` (§4.8) so one shop is one entry, but reported in
 * the form it was *printed* — "PAK'nSAVE Mill Street", not "paknsave mill
 * street" — because the model echoes these back to the user. The bare
 * `merchant` column beside `MAX(purchased_at)` is SQLite's documented
 * pick-the-row-of-the-max behaviour, so the spelling comes from the most
 * recent receipt rather than an arbitrary one.
 */
async function topMerchants(db: SqlDriver): Promise<string[]> {
  const rows = await db.all<{ printed: string | null; bills: number }>(
    `SELECT merchant AS printed, COUNT(*) AS bills, MAX(purchased_at) AS latest
       FROM bills
      WHERE merchant_norm IS NOT NULL AND merchant IS NOT NULL
      GROUP BY merchant_norm
      ORDER BY bills DESC, latest DESC, merchant ASC
      LIMIT ?`,
    [MAX_MERCHANTS]
  );
  return rows
    .map((row) => (row.printed ?? '').slice(0, MAX_MERCHANT_LENGTH).trim())
    .filter((name) => name !== '');
}

/** Whatever most bills are in. Mixed-currency ledgers are out of scope for v1. */
async function dominantCurrency(db: SqlDriver): Promise<string> {
  const row = await db.get<{ currency: string }>(
    `SELECT currency
       FROM bills
      GROUP BY currency
      ORDER BY COUNT(*) DESC, currency
      LIMIT 1`
  );
  return row?.currency ?? DEFAULT_CURRENCY;
}

async function buildCatalog(db: SqlDriver): Promise<DataCatalog> {
  const [range, merchants, currency] = await Promise.all([
    getDataRange(db),
    topMerchants(db),
    dominantCurrency(db),
  ]);

  return {
    // The whole §4.7 vocabulary, not only the categories with spending in it.
    // Listing just the used ones would let the model conclude that `frozen` is
    // not a thing it may ask about, when the true answer is "nothing yet".
    categories: CATEGORIES,
    merchants_top: merchants,
    data_range: { first_bill: range.firstBill, last_bill: range.lastBill },
    currency,
    bill_count: range.billCount,
  };
}

/**
 * The catalog for this conversation, from cache when the ledger has not moved.
 *
 * Takes the cache as an argument rather than reaching for the module-level one
 * so a caller that must not cache — a test, or a screen that just wrote a
 * bill — can say so.
 */
export async function getDataCatalog(
  db: SqlDriver,
  cache: CatalogCache
): Promise<DataCatalog> {
  const stamp = await currentStamp(db);
  const cached = cache.read();
  if (cached && cached.stamp === stamp) return cached.catalog;

  const catalog = await buildCatalog(db);
  cache.write({ stamp, catalog });
  return catalog;
}

/** Exactly the JSON §6.3 shows, for splicing into the prompt. */
export function renderCatalog(catalog: DataCatalog): string {
  return JSON.stringify(catalog);
}
