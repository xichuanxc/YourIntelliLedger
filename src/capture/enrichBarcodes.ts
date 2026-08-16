/**
 * §5.5 check 5 — Open Food Facts enrichment of barcoded items.
 *
 * Separate from `postChecks.ts` because it is the one check that is not pure:
 * checks 1–4 and 6 are arithmetic over what the model returned, while this one
 * asks a server. Folding a network call into `runPostChecks` would make every
 * post-check test async and give the review screen a reason to fail that has
 * nothing to do with the receipt.
 *
 * It runs *after* the post-checks, deliberately. Check 4 nulls a barcode whose
 * check digit fails, so by the time this runs, every remaining barcode is
 * structurally valid — no lookups are spent on OCR noise.
 *
 * **Never throws, never blocks the parse.** A failed enrichment leaves the
 * item exactly as the model produced it. The user already has a usable
 * receipt; this only makes it better when it can.
 */

import { lookupBarcode, type OffProduct } from '@/capture/openFoodFacts';
import type { ParsedItem, ParsedReceipt } from '@/capture/parseContract';
import { productCache, type ProductCache } from '@/capture/productCache';

export interface EnrichmentResult {
  receipt: ParsedReceipt;
  /** Indices whose name or category the database changed. */
  enrichedIndices: number[];
}

export interface EnrichOptions {
  /** Injected in tests, so no test ever reaches the network. */
  lookup?: typeof lookupBarcode;
  /**
   * Ceiling on live lookups per receipt. Cached answers are free and do not
   * count. A 40-line receipt of unknown products would otherwise be 40
   * sequential round-trips against a free, community-funded service — and
   * §8.4 gives the whole review screen six seconds.
   */
  maxLookups?: number;
  /**
   * Injected in tests. MMKV is a native module and cannot load in the `node`
   * project — the same seam as `SqlDriver`.
   */
  cache?: ProductCache;
}

const DEFAULT_MAX_LOOKUPS = 12;

export async function enrichWithProductData(
  receipt: ParsedReceipt,
  options: EnrichOptions = {}
): Promise<EnrichmentResult> {
  const lookup = options.lookup ?? lookupBarcode;
  const maxLookups = options.maxLookups ?? DEFAULT_MAX_LOOKUPS;
  const cache = options.cache ?? productCache;

  const enrichedIndices: number[] = [];
  const items = [...receipt.items];
  let spent = 0;

  for (const [index, item] of items.entries()) {
    if (!item.barcode) continue;

    const cached = cache.read(item.barcode);
    let product: OffProduct | null;

    if (cached.kind === 'hit') {
      product = cached.product;
    } else if (cached.kind === 'miss') {
      continue;
    } else {
      if (spent >= maxLookups) continue;
      spent += 1;

      try {
        product = await lookup(item.barcode);
      } catch {
        // The promise at the top of this file — never throws, never costs the
        // user their parsed receipt — has to hold whatever the lookup does.
        // `lookupBarcode` already swallows its own failures, but this must not
        // depend on that: the injected lookup is a seam, and a future hub-side
        // implementation may well throw.
        continue;
      }

      // Only a completed lookup is cached. Caching a thrown one would record
      // "not in the database" for a product nobody managed to ask about.
      cache.write(item.barcode, product);
    }

    if (!product) continue;

    const applied = applyProduct(item, product);
    if (applied !== item) {
      items[index] = applied;
      enrichedIndices.push(index);
    }
  }

  return { receipt: { ...receipt, items }, enrichedIndices };
}

/**
 * Applies what the database knows, and nothing else.
 *
 * `name_local` is never touched (§5.5): it is what the receipt printed in its
 * own script, and no product database knows that. The category is only taken
 * when the mapping was confident — `categoryFromOffTags` returns null rather
 * than guessing, and a null must not become `other`.
 */
function applyProduct(item: ParsedItem, product: OffProduct): ParsedItem {
  const name = product.name ?? item.name;
  const category = product.category ?? item.category;

  if (name === item.name && category === item.category) return item;

  return { ...item, name, category };
}
