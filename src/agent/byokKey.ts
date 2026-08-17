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
const MODEL_KEY = 'byok.provider.model';

/** The prototype's model, whose output §5.7's accuracy figures were measured on. */
export const DEFAULT_BYOK_MODEL = 'gemini-3.6-flash';

export async function getByokKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setByokKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (trimmed === '') {
    await clearByokKey();
    return;
  }
  await SecureStore.setItemAsync(KEY, trimmed);
}

export async function clearByokKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
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
