/**
 * Keys a demo build was given, for filling the Settings field without typing.
 *
 * Pasting a provider key into a phone is unpleasant, and on iOS there is no
 * `adb shell input text` to do it from the laptop. A build for a demonstration
 * can therefore carry a key or two, offered as a picker beside the key field.
 *
 * Gated twice, because the thing being handled is a credential. The list is
 * empty unless `DEMO_KEYS` was in the environment of the build, and it is
 * ignored altogether unless that build also opened the development door
 * (`DEV_TOOLS=1`, or `__DEV__`). An ordinary release has neither, so the
 * picker does not exist in it — which is what keeps §8.2's "no API keys in
 * the app binary" true of every build anybody else could install.
 *
 * Nothing here is written down in the repository: the values come from
 * `.env.local`, which is gitignored.
 */

import Constants from 'expo-constants';

import { DEV_TOOLS_ENABLED } from '@/ui/devTools';

function configured(): string[] {
  const keys = Constants.expoConfig?.extra?.demoKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
}

export const DEMO_KEYS: readonly string[] = DEV_TOOLS_ENABLED ? configured() : [];
