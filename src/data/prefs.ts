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
  /** Send the receipt photograph to the model, not only the OCR text (§5.1). */
  visionParse: 'parse.vision',
  /** Keep the Ask conversation across launches (§6) — see `conversationRepo`. */
  saveAskHistory: 'ask.saveHistory',
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

export function getVisionParse(): boolean {
  // Off by default, and this one is not a close call. §5.1's pipeline stops at
  // text deliberately, and §0 puts only "per-question minimal payloads" on the
  // wire — a photograph of a receipt is neither minimal nor text. Turning it on
  // is a trade the user makes knowingly: better accuracy for the picture
  // leaving the device.
  return mmkv().getBoolean(KEYS.visionParse) ?? false;
}

export function setVisionParse(value: boolean): void {
  mmkv().set(KEYS.visionParse, value);
}

export function getSaveAskHistory(): boolean {
  // Off by default, and for a stronger reason than the other two. A saved
  // conversation is a transcript: the questions *and* the answers, and an
  // answer quotes amounts. §8.2's posture is that nothing outlives the
  // session unless the user asks for it, and the app is fully usable without
  // this — a conversation still survives switching tabs, it just does not
  // survive closing the app.
  return mmkv().getBoolean(KEYS.saveAskHistory) ?? false;
}

export function setSaveAskHistory(value: boolean): void {
  mmkv().set(KEYS.saveAskHistory, value);
}
