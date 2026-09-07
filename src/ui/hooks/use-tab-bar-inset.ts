import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * UIKit's standard tab bar, excluding the home indicator area, which
 * `useSafeAreaInsets` reports separately and which is 0 on a device without
 * one (an iPhone SE, for instance).
 */
export const IOS_TAB_BAR_HEIGHT = 49;

/**
 * How much space at the bottom of a tab screen is already spoken for.
 *
 * UIKit's tab bar is translucent and the screen's content scrolls *underneath*
 * it, so anything at the bottom of a tab screen on iOS is drawn in occupied
 * space — the last row of a list, the last card of a summary. Android has no
 * such problem: its tab bar is a sibling view below the content, so the answer
 * there is zero and adding padding would only leave a gap.
 *
 * `expo-router/unstable-native-tabs` exposes no tab-bar-height hook, so this is
 * arithmetic over a known constant. That is not good enough for a control that
 * must be tappable — a wrong constant could put it out of reach — but it is
 * the right trade for scroll padding, which fails softly: a few points out
 * moves the resting position of a scroll, and never hides anything the user
 * cannot reach by scrolling.
 *
 * Only routes inside `(tabs)` need this. Everything else in the stack is
 * pushed over the tab bar and covers it.
 */
export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === 'android' ? 0 : insets.bottom + IOS_TAB_BAR_HEIGHT;
}
