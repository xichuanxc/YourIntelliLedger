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
  /** Whether a line on a bill offers to look its price up on grocer.nz. */
  priceLookup: 'privacy.priceLookup',
  /** Keep the Ask conversation across launches (§6) — see `conversationRepo`. */
  saveAskHistory: 'ask.saveHistory',
  /** The Insights period, so the screen opens where it was left. */
  insightsRange: 'insights.range',
  /** The hand-picked range behind `insights.range === 'custom'`. */
  insightsCustomFrom: 'insights.customFrom',
  insightsCustomTo: 'insights.customTo',
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

export function getPriceLookup(): boolean {
  // On by default, which is a weaker claim than it looks: nothing leaves the
  // device until somebody taps a line, and what leaves then is a few words of
  // a product name, in a browser, to a site they can see they are visiting.
  // The switch is here because that is still a shop learning what is on
  // somebody's receipt, and because a row that silently opens a browser is
  // worth being able to turn off.
  return mmkv().getBoolean(KEYS.priceLookup) ?? true;
}

export function setPriceLookup(value: boolean): void {
  mmkv().set(KEYS.priceLookup, value);
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
  // On by default. It was off originally, on the §8.2 reasoning that a
  // transcript holds answers and answers quote amounts — but a conversation
  // that evaporates when the app closes surprises people who expect a chat to
  // still be there, and losing an answer is its own kind of harm. The switch
  // stays, so anyone who would rather it did not persist can say so, and
  // turning it off still deletes what was kept.
  return mmkv().getBoolean(KEYS.saveAskHistory) ?? true;
}

export function setSaveAskHistory(value: boolean): void {
  mmkv().set(KEYS.saveAskHistory, value);
}

/**
 * The Insights period, remembered across launches.
 *
 * Returned as a plain string rather than the screen's own union: a value
 * written by an older build may name a preset that no longer exists, and the
 * screen is the right place to decide what to do about that.
 */
export function getInsightsRange(): string | null {
  return mmkv().getString(KEYS.insightsRange) ?? null;
}

export function setInsightsRange(value: string): void {
  mmkv().set(KEYS.insightsRange, value);
}

/** The dates behind a custom period, or null when none has been picked. */
export function getInsightsCustom(): { from: string; to: string } | null {
  const from = mmkv().getString(KEYS.insightsCustomFrom);
  const to = mmkv().getString(KEYS.insightsCustomTo);
  return from && to ? { from, to } : null;
}

export function setInsightsCustom(period: { from: string; to: string }): void {
  mmkv().set(KEYS.insightsCustomFrom, period.from);
  mmkv().set(KEYS.insightsCustomTo, period.to);
}

/**
 * Forgets the hand-picked range.
 *
 * Called when a preset is chosen, because the two controls describe one
 * period between them: a preset that left dates behind would have the screen
 * saying "Last 3 months" and "1 – 30 June" at once, and only one of them
 * would be true of the charts.
 */
export function clearInsightsCustom(): void {
  mmkv().remove(KEYS.insightsCustomFrom);
  mmkv().remove(KEYS.insightsCustomTo);
}

/**
 * Forgets every preference, returning the app to its defaults (§15.2).
 *
 * Preferences are not spending, but several of them describe it — the
 * Insights period somebody keeps coming back to, whether they leave map
 * previews on. An erase that kept them would leave the next user of the
 * handset looking at the last one's habits.
 */
export function clearPreferences(): void {
  mmkv().clearAll();
}

/**
 * Every preference, for the backup (§15.1).
 *
 * Keys as stored, not as the UI names them, so a restore into a later build
 * can still recognise them. Absent keys are simply absent: a preference
 * never set should come back unset rather than as somebody else's default.
 */
export function exportedPreferences(): Record<string, string | number | boolean | null> {
  const store = mmkv();
  const out: Record<string, string | number | boolean | null> = {};

  for (const key of Object.values(KEYS)) {
    const asBoolean = store.getBoolean(key);
    if (asBoolean !== undefined) {
      out[key] = asBoolean;
      continue;
    }
    const asString = store.getString(key);
    if (asString !== undefined) out[key] = asString;
  }

  return out;
}
