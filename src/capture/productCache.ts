/**
 * Barcode → product cache — §4.2's "Barcode→product cache | MMKV" row.
 *
 * §4.2's rule of thumb: a table earns its place only when queries *cross* its
 * rows. This is read by exact key and never aggregated, so MMKV is the right
 * home and a table would buy nothing.
 *
 * §5.5 gives the reason it exists: "so repeat purchases and offline scans
 * resolve without a network call". A weekly shop repeats the same twenty
 * products, and a cached hit turns an enrichment that costs a round-trip per
 * item into one that usually costs nothing.
 *
 * **Misses are cached too.** Open Food Facts is food-first and thin on New
 * Zealand groceries, so a miss is the common case, not the exception. Without
 * caching them, every unrecognised item would re-query on every parse — the
 * worst load for the least benefit.
 *
 * Same lazy-init pattern as `prefs.ts`: no native module touched at import.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

import type { OffProduct } from '@/capture/openFoodFacts';
import { isCategory } from '@/types/vocabulary';

let store: MMKV | null = null;

function mmkv(): MMKV {
  store ??= createMMKV({ id: 'yourintelliledger.products' });
  return store;
}

export type CachedProduct =
  | { kind: 'hit'; product: OffProduct }
  | { kind: 'miss' }
  | { kind: 'unknown' };

/**
 * The cache as its consumer sees it.
 *
 * An interface because MMKV is a native module and cannot load in the `node`
 * test project — it resolves to a web build that wants `localStorage`. The
 * same seam as `SqlDriver`: the logic above is storage-agnostic and gets an
 * in-memory implementation under test, so caching behaviour is covered
 * without a device.
 */
export interface ProductCache {
  read(barcode: string): CachedProduct;
  write(barcode: string, product: OffProduct | null): void;
}

/** The real one, backed by MMKV. */
export const productCache: ProductCache = {
  read: (barcode) => readProduct(barcode),
  write: (barcode, product) => writeProduct(barcode, product),
};

/** In-memory, for tests and for anywhere a cache would be wrong. */
export function createMemoryProductCache(): ProductCache {
  const entries = new Map<string, OffProduct | null>();

  return {
    read: (barcode) =>
      entries.has(barcode)
        ? ((entries.get(barcode) ?? null) === null
            ? { kind: 'miss' }
            : { kind: 'hit', product: entries.get(barcode)! })
        : { kind: 'unknown' },
    write: (barcode, product) => {
      entries.set(barcode, product);
    },
  };
}

export function readProduct(barcode: string): CachedProduct {
  const raw = mmkv().getString(barcode);
  if (raw === undefined) return { kind: 'unknown' };
  if (raw === '') return { kind: 'miss' };

  try {
    const parsed = JSON.parse(raw) as { name?: unknown; category?: unknown };
    return {
      kind: 'hit',
      product: {
        name: typeof parsed.name === 'string' ? parsed.name : null,
        // Validated on read, not trusted: a stored category that is no longer
        // in the §4.7 vocabulary would fail the CHECK constraint on write.
        // Migrations change vocabularies; this cache is not migrated.
        category: isCategory(parsed.category) ? parsed.category : null,
      },
    };
  } catch {
    return { kind: 'unknown' };
  }
}

export function writeProduct(barcode: string, product: OffProduct | null): void {
  mmkv().set(barcode, product ? JSON.stringify(product) : '');
}

/** Used by delete-all (§15.2) — a shopping history is inferable from it. */
export function clearProductCache(): void {
  mmkv().clearAll();
}
