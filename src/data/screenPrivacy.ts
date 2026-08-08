/**
 * Screenshot blocking — spec §8.2 [A].
 *
 * On Android this sets `FLAG_SECURE`, which hides the app from screenshots and
 * from the recents-screen preview. The spec lists it as an optional Settings
 * toggle rather than a default, and it stays off unless asked for: turning it
 * on silently would look like a bug the first time a screenshot came out black.
 *
 * §8.2 also says plainly that **no `FLAG_SECURE` equivalent exists on iOS** and
 * the gap should be documented rather than faked. `expo-screen-capture` is a
 * no-op there for screenshots, so the toggle is Android-only — the Settings
 * screen should not promise iOS users protection it cannot deliver.
 *
 * Deliberately not in `src/platform/`: there is one shared API with no
 * per-platform implementation to fork, which is what §2.2 rule 5 asks for
 * before a fork is introduced.
 */

import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

/** True where the toggle does something. */
export const SCREENSHOT_BLOCKING_SUPPORTED = Platform.OS === 'android';

export async function applyScreenshotPolicy(block: boolean): Promise<void> {
  if (!SCREENSHOT_BLOCKING_SUPPORTED) return;

  if (block) await ScreenCapture.preventScreenCaptureAsync();
  else await ScreenCapture.allowScreenCaptureAsync();
}
