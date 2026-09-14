/**
 * Asks before Android's back button leaves the app (§7).
 *
 * §7 makes handling Android system back a non-negotiable, and the root of the
 * tab stack is where it needs handling most: there is nothing to go back *to*,
 * so the default behaviour is to close the app outright. That is a surprising
 * amount of finality for a button people press absent-mindedly while reading a
 * list.
 *
 * Two properties matter and both are easy to get wrong.
 *
 * **It arms and disarms with focus.** Registered unconditionally, this would
 * intercept back on every other tab too, and a user on Insights pressing back
 * would be asked whether to exit rather than being taken to the Ledger. The
 * handler exists only while the screen that owns it is the one on screen.
 *
 * **It is Android only.** iOS has no hardware back, and `BackHandler` there is
 * an inert stub rather than an error — so a missing platform check would look
 * like it worked while doing nothing at all. Saying so explicitly keeps the
 * intent readable.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { Alert, BackHandler, Platform } from 'react-native';

export interface ExitConfirmCopy {
  title: string;
  message: string;
  /** The button that leaves. Destructive styling, and never the default. */
  confirm: string;
  cancel: string;
}

const DEFAULT_COPY: ExitConfirmCopy = {
  title: 'Close YourIntelliLedger?',
  message: 'Your bills stay on this phone either way.',
  confirm: 'Close',
  cancel: 'Stay',
};

/**
 * Intercepts back while the calling screen is focused.
 *
 * Returning `true` from the handler is what stops the default — without it the
 * app would close *and* show the dialog on the way out.
 */
export function useExitConfirm(copy: Partial<ExitConfirmCopy> = {}): void {
  const { title, message, confirm, cancel } = { ...DEFAULT_COPY, ...copy };

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        Alert.alert(title, message, [
          { text: cancel, style: 'cancel' },
          { text: confirm, style: 'destructive', onPress: () => BackHandler.exitApp() },
        ]);
        // Handled. The app closes only from the button above.
        return true;
      });

      return () => subscription.remove();
    }, [title, message, confirm, cancel])
  );
}
