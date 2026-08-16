/**
 * Barcode → product, via Open Food Facts (§5.5 check 5).
 *
 * §13 names it as the only service the app talks to besides the hub. It is
 * free, keyless and open-licensed, which is why the spec chose it over GS1 or
 * the paid barcode APIs.
 *
 * ## What a hit is allowed to change
 *
 * §5.5 says a hit "overrides the model's name/category, but never
 * `name_local`". Taken literally that is too strong, so this narrows it:
 *
 *  - **name** — taken when present. A database product name beats an OCR
 *    reading of an abbreviated till description almost every time.
 *  - **category** — taken *only* when `categoryFromOffTags` maps confidently.
 *    OFF's crowd-sourced taxonomy is not automatically better than a model
 *    that read the line in the context of a real receipt, and an unmapped tag
 *    would otherwise become `other`, which is strictly worse than the guess it
 *    replaced.
 *  - **name_local** — never touched, per §5.5. It is what the receipt printed
 *    in its own script, and no database knows that.
 *
 * ## Coverage is partial, and that is expected
 *
 * Open Food *Facts* is food-first and strongest in Europe. New Zealand
 * groceries are patchy and household goods largely absent, so a miss is the
 * common case rather than an error. Misses cache too — see `productCache` —
 * or every unknown item would re-query on every parse.
 */

import { categoryFromOffTags } from '@/capture/offCategories';
import type { Category } from '@/types/vocabulary';

export interface OffProduct {
  /** Product name as the database has it, or null when it has none. */
  name: string | null;
  /** Mapped §4.7 category, or null when no tag mapped confidently. */
  category: Category | null;
}

const ENDPOINT = 'https://world.openfoodfacts.org/api/v2/product';

/** Open Food Facts asks for an identifying User-Agent, as Nominatim does. */
const USER_AGENT = 'YourIntelliLedger/0.1 (COMPX576 student project)';

/** Only the fields used, so the response stays small on mobile data. */
const FIELDS = 'product_name,product_name_en,brands,categories_tags';

/** A lookup is an enrichment, never the critical path — it must not hang a parse. */
const TIMEOUT_MS = 6000;

export interface LookupOptions {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface OffResponse {
  status?: number;
  product?: {
    product_name?: string;
    product_name_en?: string;
    brands?: string;
    categories_tags?: string[];
  };
}

/**
 * Looks up one GTIN.
 *
 * Returns null for "not in the database", which is ordinary. Also returns null
 * on any failure — offline, rate-limited, a changed shape. Unlike geocoding
 * there is no error to report: the parse already has a name and a category
 * from the model, so a failed enrichment simply changes nothing, and telling
 * the user about it would be noise about a step they never asked for.
 */
export async function lookupBarcode(
  barcode: string,
  { fetchImpl = fetch }: LookupOptions = {}
): Promise<OffProduct | null> {
  const digits = barcode.trim();
  if (!/^\d{8,14}$/.test(digits)) return null;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${ENDPOINT}/${digits}.json?fields=${FIELDS}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: timeout.signal,
    });

    // 404 is how OFF says "no such product" — a normal answer, not a fault.
    if (!response.ok) return null;

    const body = (await response.json()) as OffResponse;
    if (body.status !== 1 || !body.product) return null;

    const product = body.product;
    const name = pickName(product);
    const category = categoryFromOffTags(product.categories_tags);

    // Nothing usable is the same as no hit, and caching it as a hit would
    // store an empty override.
    if (!name && !category) return null;

    return { name, category };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prefers the English name, then the default, and prefixes the brand when the
 * name does not already carry it — "Whittaker's Creamy Milk" reads better on a
 * ledger row than "Creamy Milk", and matches how the receipt named it.
 */
function pickName(product: NonNullable<OffResponse['product']>): string | null {
  const base = (product.product_name_en || product.product_name || '').trim();
  if (!base) return null;

  const brand = (product.brands ?? '').split(',')[0]?.trim();
  if (!brand) return base;

  return base.toLowerCase().includes(brand.toLowerCase()) ? base : `${brand} ${base}`;
}
