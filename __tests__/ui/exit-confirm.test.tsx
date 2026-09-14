/**
 * Asking before Android's back button closes the app (§7).
 *
 * Tested as a hook against a bare host rather than through the Ledger screen,
 * which would drag in the store, the database and the development tools to
 * exercise four lines of behaviour.
 *
 * The `ui` project runs the `jest-expo/android` preset, so `Platform.OS` is
 * 'android' here — which is the platform this hook exists for.
 */

import { act, render } from '@testing-library/react-native';
import { Alert, BackHandler } from 'react-native';

import { useExitConfirm } from '@/ui/hooks/use-exit-confirm';

// `useFocusEffect` needs a navigation context that does not exist here. A
// plain effect keeps the mount/unmount behaviour the hook depends on.
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => undefined | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));

function Host() {
  useExitConfirm();
  return null;
}

type BackButtons = { text: string; onPress?: () => void }[];

let backPress: (() => boolean) | null = null;
let remove: jest.Mock;
let alert: jest.SpyInstance;
let exitApp: jest.SpyInstance;

beforeEach(() => {
  backPress = null;
  remove = jest.fn();

  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((event, handler) => {
    // Parameters infer from the spy: RN declares the handler as taking a
    // `HardwareBackPressEvent`, and annotating it as nil-ary here was a claim
    // about someone else's type.
    if (event === 'hardwareBackPress') backPress = handler as unknown as () => boolean;
    return { remove } as never;
  });

  alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  exitApp = jest.spyOn(BackHandler, 'exitApp').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Runs the named button from the dialog the handler raised. */
const choose = async (label: string) => {
  const buttons = alert.mock.calls[0][2] as BackButtons;
  await act(async () => {
    buttons.find((button) => button.text === label)?.onPress?.();
  });
};

describe('the back button on the root screen', () => {
  it('takes over the back button while the screen is focused', async () => {
    await render(<Host />);
    expect(backPress).not.toBeNull();
  });

  /**
   * Returning true is what stops the default. Without it the app would close
   * *and* show the dialog on the way out.
   */
  it('asks rather than closing, and reports the press as handled', async () => {
    await render(<Host />);

    let handled: boolean | undefined;
    await act(async () => {
      handled = backPress?.();
    });

    expect(handled).toBe(true);
    expect(alert).toHaveBeenCalled();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('closes the app only when that button is chosen', async () => {
    await render(<Host />);
    await act(async () => {
      backPress?.();
    });

    await choose('Close');

    expect(exitApp).toHaveBeenCalled();
  });

  it('stays in the app when the press was a mistake', async () => {
    await render(<Host />);
    await act(async () => {
      backPress?.();
    });

    await choose('Stay');

    expect(exitApp).not.toHaveBeenCalled();
  });

  /**
   * The handler must not outlive the screen. Left registered, it would answer
   * back on every other tab — so pressing back on Insights would offer to
   * close the app instead of returning to the Ledger.
   */
  it('gives the back button up when the screen goes away', async () => {
    const view = await render(<Host />);
    await act(async () => {
      view.unmount();
    });

    expect(remove).toHaveBeenCalled();
  });
});
