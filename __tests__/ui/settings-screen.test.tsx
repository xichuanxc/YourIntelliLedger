/**
 * Settings, and specifically the two keys (§8.2).
 *
 * This screen had no suite, which is how it shipped with an Ask key field and
 * no way to save it: the value was committed by the *receipts* Save button,
 * which also rewrote the receipt key. So the tests here are mostly about which
 * control writes which key — the part that was wrong.
 *
 * The keystore is faked rather than mocked call-by-call, so "Ask inherits the
 * receipt key until it has one of its own" is exercised as behaviour instead
 * of asserted as a call. That inheritance is the rule the screen exists to
 * make visible.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider, type Metrics } from 'react-native-safe-area-context';

import SettingsScreen from '@/app/settings';

/** A stand-in for the Android Keystore / iOS Keychain. */
const store: { receipt: string | null; ask: string | null; model: string | null } = {
  receipt: null,
  ask: null,
  model: null,
};

jest.mock('@/agent/byokKey', () => ({
  DEFAULT_BYOK_MODEL: 'gemini-3.6-flash',
  getByokKey: async () => store.receipt,
  setByokKey: async (key: string) => {
    store.receipt = key.trim() === '' ? store.receipt : key.trim();
  },
  clearByokKey: async () => {
    store.receipt = null;
  },
  // The real fallback: Ask borrows the receipt key until it has its own.
  getAskKey: async () => store.ask ?? store.receipt,
  hasOwnAskKey: async () => store.ask !== null,
  setAskKey: async (key: string) => {
    store.ask = key.trim() === '' ? null : key.trim();
  },
  clearAskKey: async () => {
    store.ask = null;
  },
  getByokModel: async () => store.model ?? 'gemini-3.6-flash',
  setByokModel: async (model: string) => {
    store.model = model.trim() === '' ? null : model.trim();
  },
  maskKey: (key: string) => (key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`),
}));

jest.mock('@/data/db', () => ({ getDb: async () => ({}) }));

jest.mock('@/data/telemetryRepo', () => ({
  getUsageForMonth: async () => ({
    month: '2026-09',
    requests: 0,
    receiptReads: 0,
    tokensIn: 0,
    tokensOut: 0,
    medianLatencyMs: null,
    failures: 0,
  }),
}));

/** Mutable so a test can start from "already switched on". */
const mockPrefs = { saveHistory: false };

jest.mock('@/data/prefs', () => ({
  getBlockScreenshots: () => false,
  setBlockScreenshots: jest.fn(),
  getMapPreviews: () => true,
  setMapPreviews: jest.fn(),
  getVisionParse: () => false,
  setVisionParse: jest.fn(),
  getSaveAskHistory: () => mockPrefs.saveHistory,
  setSaveAskHistory: jest.fn(),
}));

jest.mock('@/data/conversationRepo', () => ({ clearConversation: jest.fn() }));

const { setSaveAskHistory } = jest.requireMock('@/data/prefs');
const { clearConversation } = jest.requireMock('@/data/conversationRepo');

jest.mock('@/data/screenPrivacy', () => ({
  applyScreenshotPolicy: async () => true,
  SCREENSHOT_BLOCKING_SUPPORTED: false,
}));

// `useFocusEffect` needs a navigation context that does not exist here, so it
// stands in as a plain effect — the screen only uses it to refresh usage.
jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  useFocusEffect: (callback: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));

const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 375, height: 667 },
  insets: { top: 20, left: 0, right: 0, bottom: 0 },
};

const draw = async () => {
  await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SettingsScreen />
    </SafeAreaProvider>
  );
  // The screen loads both keys in an effect; wait for that to land.
  await waitFor(() => expect(screen.getByLabelText(SHARE)).toBeTruthy());
};

const SHARE = 'Use the same key as reading receipts';
const share = (value: boolean) => fireEvent(screen.getByLabelText(SHARE), 'valueChange', value);
const type = (label: string, value: string) =>
  fireEvent.changeText(screen.getByLabelText(label), value);
const press = (label: string) => fireEvent.press(screen.getByLabelText(label));

beforeEach(() => {
  store.receipt = 'AIzaRECEIPTkey0001';
  store.ask = null;
  store.model = null;
  mockPrefs.saveHistory = false;
  setSaveAskHistory.mockClear();
  clearConversation.mockClear();
});

describe('sharing one key between receipts and Ask', () => {
  it('shares by default, and offers no key field while it does', async () => {
    await draw();

    // The switch's state is only meaningful through what it hides or shows,
    // so that is what is asserted — reaching into the control's own props
    // tests React Native, not this screen.
    expect(screen.queryByLabelText('Key for Ask')).toBeNull();
    expect(screen.queryByLabelText('Save Ask key')).toBeNull();
    expect(screen.getByText(/Using the receipt key/)).toBeTruthy();
  });

  it('reveals a field and its own save button when switched off', async () => {
    await draw();
    await share(false);

    expect(screen.getByLabelText('Key for Ask')).toBeTruthy();
    expect(screen.getByLabelText('Save Ask key')).toBeTruthy();
  });

  it('starts switched off for someone who already has a separate key', async () => {
    store.ask = 'sk-DEEPSEEKkey9999';
    await draw();

    // Switched off means the field is there, already offering to replace the
    // key rather than asking for a first one.
    expect(screen.getByLabelText('Replace the Ask key')).toBeTruthy();
    expect(screen.getByLabelText('Save Ask key')).toBeTruthy();
    // Named by its masked value, not just /Key set/: the receipts section
    // shows a "Key set" line too, and the point here is that Ask is showing
    // *its own* key rather than the one it inherits.
    expect(screen.getByText('Key set — sk-D…9999')).toBeTruthy();
  });
});

describe('saving the Ask key', () => {
  it('saves it with its own button, leaving the receipt key alone', async () => {
    await draw();
    await share(false);
    await type('Key for Ask', 'sk-DEEPSEEKkey9999');
    await press('Save Ask key');

    await waitFor(() => expect(store.ask).toBe('sk-DEEPSEEKkey9999'));
    expect(store.receipt).toBe('AIzaRECEIPTkey0001');
    expect(screen.getByText(/Ask is using its own key/)).toBeTruthy();
  });

  /**
   * The reported bug. The receipts Save button used to commit `askDraft` as
   * well, so the Ask box was saved by a control in another section — and that
   * control also rewrote the receipt key and model.
   */
  it('is not saved by the receipts Save button', async () => {
    await draw();
    await share(false);
    await type('Key for Ask', 'sk-TYPEDbutNOTsaved');
    await press('Save');

    await waitFor(() => expect(screen.getByText('Saved.')).toBeTruthy());
    expect(store.ask).toBeNull();
  });

  it('will not save an empty box', async () => {
    await draw();
    await share(false);

    expect(screen.getByLabelText('Save Ask key').props.accessibilityState.disabled).toBe(true);

    await press('Save Ask key');
    expect(store.ask).toBeNull();
  });

  it('clears the box after saving, so a key is never left on screen', async () => {
    await draw();
    await share(false);
    await type('Key for Ask', 'sk-DEEPSEEKkey9999');
    await press('Save Ask key');

    await waitFor(() =>
      expect(screen.getByLabelText('Replace the Ask key').props.value).toBe('')
    );
  });
});

describe('going back to one key', () => {
  it('drops the separate key rather than leaving it dormant', async () => {
    store.ask = 'sk-DEEPSEEKkey9999';
    await draw();

    await share(true);

    await waitFor(() => expect(store.ask).toBeNull());
    expect(screen.queryByLabelText('Replace the Ask key')).toBeNull();
    expect(screen.getByText(/Ask is using the receipt key/)).toBeTruthy();
  });
});

describe('the receipts key', () => {
  it('still saves its own key and model', async () => {
    await draw();
    await type('Replace key', 'AIzaNEWreceipt2222');
    await type('Model', 'gemini-3.6-pro');
    await press('Save');

    await waitFor(() => expect(store.receipt).toBe('AIzaNEWreceipt2222'));
    expect(store.model).toBe('gemini-3.6-pro');
  });
});

/**
 * Keeping the Ask conversation (§6). Off by default because a transcript
 * holds answers, and answers quote amounts — so the interesting behaviour is
 * what happens when it is turned back off.
 */
describe('saving conversation records', () => {
  const SAVE = 'Save conversation records';

  it('is off until it is switched on', async () => {
    await draw();

    await fireEvent(screen.getByLabelText(SAVE), 'valueChange', true);

    expect(setSaveAskHistory).toHaveBeenCalledWith(true);
  });

  it('keeps what is stored while it stays on', async () => {
    await draw();

    await fireEvent(screen.getByLabelText(SAVE), 'valueChange', true);

    expect(clearConversation).not.toHaveBeenCalled();
  });

  /**
   * A switch reading "off" while a record of every answer survives would be
   * the kind of quiet privacy failure a user cannot see.
   */
  it('deletes the saved conversation when switched off', async () => {
    mockPrefs.saveHistory = true;
    await draw();

    await fireEvent(screen.getByLabelText(SAVE), 'valueChange', false);

    expect(setSaveAskHistory).toHaveBeenCalledWith(false);
    await waitFor(() => expect(clearConversation).toHaveBeenCalled());
  });
});
