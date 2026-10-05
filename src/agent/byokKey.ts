/**
 * Storage for a user-supplied provider key — spec §8.2.
 *
 * `expo-secure-store` puts this in the Android Keystore and the iOS Keychain,
 * so it is not readable from the app's own files, is not included in any
 * export (§15.1), and never appears in the binary.
 *
 * Deliberately minimal: get, set, clear. Anything that formats or logs the key
 * is a way for it to escape.
 */

import * as SecureStore from 'expo-secure-store';

const KEY = 'byok.provider.key';
const ASK_KEY = 'byok.ask.key';
const MODEL_KEY = 'byok.provider.model';

/** The prototype's model, whose output §5.7's accuracy figures were measured on. */
export const DEFAULT_BYOK_MODEL = 'gemini-3.6-flash';

export async function getByokKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

/**
 * Stores a key, and does nothing at all when handed an empty one.
 *
 * Emptiness is not an instruction here. The field it comes from says "leave
 * blank to keep the current key", and it used to do the opposite: saving with
 * an empty box called this, which cleared the keystore, so the one gesture
 * that was supposed to change nothing silently took the key away. Removing a
 * key has its own button; this function only sets.
 */
export async function setByokKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') return;
  await SecureStore.setItemAsync(KEY, trimmed);
}

export async function clearByokKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

/**
 * The key Ask sends to the hub, which forwards it to whichever provider the
 * §13.5 alias table names.
 *
 * A second key because the two features can now reach different companies:
 * receipt parsing goes straight to Google, while `chat-fast` may be pointed at
 * DeepSeek in the Worker's config. One field would mean choosing which of the
 * two to break.
 *
 * **Falls back to the parse key when unset.** Almost everyone is running both
 * on Gemini with one key, and requiring a second before Ask would work again
 * would be a setup step imposed on people who did not ask for a second
 * provider. Setting this is only necessary once the two differ.
 */
export async function getAskKey(): Promise<string | null> {
  return (await SecureStore.getItemAsync(ASK_KEY)) ?? (await getByokKey());
}

/** Whether a distinct Ask key has been set, as opposed to inherited. */
export async function hasOwnAskKey(): Promise<boolean> {
  return (await SecureStore.getItemAsync(ASK_KEY)) !== null;
}

/** Empty means "unchanged", as it does for the receipt key. */
export async function setAskKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') return;
  await SecureStore.setItemAsync(ASK_KEY, trimmed);
}

/** Clearing hands Ask back to the parse key rather than leaving it keyless. */
export async function clearAskKey(): Promise<void> {
  await SecureStore.deleteItemAsync(ASK_KEY);
}

/**
 * The user's explicit model choice, or null when they have not made one.
 *
 * The distinction matters now that §13.5's alias table supplies the default:
 * "no choice" means follow the hub, and only a deliberate entry overrides it.
 * `getByokModel` cannot express that, because it substitutes a default for
 * absence.
 */
export async function getByokModelOverride(): Promise<string | null> {
  const stored = (await SecureStore.getItemAsync(MODEL_KEY))?.trim();
  return stored ? stored : null;
}

export async function getByokModel(): Promise<string> {
  return (await SecureStore.getItemAsync(MODEL_KEY)) ?? DEFAULT_BYOK_MODEL;
}

/**
 * Blank clears the override rather than storing the built-in default, so
 * emptying the field in Settings hands the choice back to the hub. Without
 * this there would be no way to undo an override.
 */
export async function setByokModel(model: string): Promise<void> {
  const trimmed = model.trim();
  if (trimmed) {
    await SecureStore.setItemAsync(MODEL_KEY, trimmed);
  } else {
    await SecureStore.deleteItemAsync(MODEL_KEY);
  }
}

/**
 * Whether a key is configured, without returning it — for Settings to show
 * state, and for capture to decide whether parsing is possible at all.
 */
export async function hasByokKey(): Promise<boolean> {
  return (await getByokKey()) !== null;
}

/** `AIza…7f3b` — enough to tell two keys apart, not enough to use one. */
export function maskKey(key: string): string {
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
