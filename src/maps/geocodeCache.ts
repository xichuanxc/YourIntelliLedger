/**
 * A tiny persistent cache of address → coordinate.
 *
 * Nominatim's usage policy requires callers to cache results, and the shape of
 * this app makes that easy: the same handful of shops recur across a ledger,
 * so after the first open of each merchant the preview costs no network at all.
 *
 * Misses are cached too. Without that, a bill whose address cannot be resolved
 * would re-query on every single open — the worst case for the rate limit, and
 * the one most likely to happen, since unresolvable addresses are exactly the
 * ones a user reopens while wondering why there is no map.
 *
 * Same lazy-init pattern as `prefs.ts`: no native module touched at import.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

import type { GeoPoint } from './geocode';

let store: MMKV | null = null;

function mmkv(): MMKV {
  store ??= createMMKV({ id: 'yourintelliledger.geocode' });
  return store;
}

/** Matches the key normalisation used for merchants (§4.8): case and spacing only. */
function cacheKey(address: string): string {
  return address.toLowerCase().replace(/\s+/g, ' ').trim();
}

export type CachedGeocode =
  | { kind: 'hit'; point: GeoPoint }
  | { kind: 'miss' }
  | { kind: 'unknown' };

export function readCache(address: string): CachedGeocode {
  const raw = mmkv().getString(cacheKey(address));
  if (raw === undefined) return { kind: 'unknown' };
  if (raw === '') return { kind: 'miss' };

  const [lat, lon] = raw.split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { kind: 'unknown' };

  return { kind: 'hit', point: { lat, lon } };
}

export function writeCache(address: string, point: GeoPoint | null): void {
  // Stored as "lat,lon" rather than JSON — two numbers do not need a parser,
  // and the empty string is an unambiguous marker for a cached miss.
  mmkv().set(cacheKey(address), point ? `${point.lat},${point.lon}` : '');
}

/** Used by delete-all (§15.2) once it exists; the coordinates are bill data. */
export function clearGeocodeCache(): void {
  mmkv().clearAll();
}
