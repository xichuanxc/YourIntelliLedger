/**
 * Preferences — spec §4.2, "Preferences, data catalog | MMKV".
 *
 * Small key-value with no schema and no queries crossing rows, so a SQLite
 * table would buy nothing. MMKV is synchronous, which matters here: a
 * preference read on first render should not make the UI wait a frame.
 *
 * The store is created lazily rather than at module scope, so importing this
 * file in a Node test does not try to initialise a native module.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

let store: MMKV | null = null;

function mmkv(): MMKV {
  // v4 exposes `MMKV` as a type only; instances come from `createMMKV`.
  store ??= createMMKV({ id: 'yourintelliledger.prefs' });
  return store;
}

const KEYS = {
  /** §8.2 [A]: FLAG_SECURE, blocking screenshots and the recents preview. */
  blockScreenshots: 'privacy.blockScreenshots',
  /** §4.14: whether the bill screen draws a map behind the store address. */
  mapPreviews: 'privacy.mapPreviews',
} as const;

export function getBlockScreenshots(): boolean {
  // Off by default: it is a deliberate privacy trade, and turning it on
  // silently would look like a bug the first time a screenshot came out black.
  return mmkv().getBoolean(KEYS.blockScreenshots) ?? false;
}

export function setBlockScreenshots(value: boolean): void {
  mmkv().set(KEYS.blockScreenshots, value);
}

export function getMapPreviews(): boolean {
  // On by default, because a blank grey box is not a feature anyone would go
  // looking for a switch to enable. What it costs is one address at a time
  // leaving the device, stated plainly in Settings — and turning it off
  // restores §4.14's original property of no network at all.
  return mmkv().getBoolean(KEYS.mapPreviews) ?? true;
}

export function setMapPreviews(value: boolean): void {
  mmkv().set(KEYS.mapPreviews, value);
}
