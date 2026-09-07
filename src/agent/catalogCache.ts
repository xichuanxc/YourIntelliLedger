/**
 * The MMKV-backed `CatalogCache` (§6.3, §4.2's "Preferences, data catalog |
 * MMKV" row).
 *
 * Split from `catalog.ts` so the catalog logic stays importable in the `node`
 * test project: MMKV is a native module, and importing it there resolves to a
 * web build that wants `localStorage`. Same split as `productCache`.
 *
 * A read that throws or returns something unrecognisable is treated as a miss
 * rather than an error — the catalog is a cache, and a device with a stored
 * shape from an older build should rebuild it, not fail to answer a question.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

import type { CachedCatalog, CatalogCache } from '@/agent/catalog';

let store: MMKV | null = null;

function mmkv(): MMKV {
  store ??= createMMKV({ id: 'yourintelliledger.catalog' });
  return store;
}

const CACHE_KEY = 'v1.catalog';

export const catalogCache: CatalogCache = {
  read(): CachedCatalog | null {
    try {
      const raw = mmkv().getString(CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedCatalog;
      if (typeof parsed?.stamp !== 'string') return null;
      if (!Array.isArray(parsed.catalog?.merchants_top)) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  write(entry: CachedCatalog): void {
    try {
      mmkv().set(CACHE_KEY, JSON.stringify(entry));
    } catch {
      // A full or unwritable store costs a rebuild next time, nothing more.
    }
  },
};
