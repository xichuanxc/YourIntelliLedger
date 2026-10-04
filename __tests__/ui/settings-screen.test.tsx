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
  // null means "no choice of my own", which is what the Automatic option is.
  getByokModelOverride: async () => store.model,
  setByokModel: async (model: string) => {
    store.model = model.trim() === '' ? null : model.trim();
  },
  maskKey: (key: string) => (key.length <= 8 ? '••••' : `${key.slice(0, 4)}…${key.slice(-4)}`),
}));

/**
 * The keys a demo build was compiled with. A getter, so a test can decide
 * whether this build is one of those or an ordinary release.
 */
const demoKeys: string[] = [];

jest.mock('@/ui/devKeys', () => ({
  get DEMO_KEYS() {
    return demoKeys;
  },
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
  // §6.8's two figures. Nulls, so the screen renders its "ask a few
  // questions" state rather than numbers this test would have invented.
  getResponseTimes: async () => ({
    fastpathCount: 0,
    agentCount: 0,
    fastpathP95Ms: null,
    agentFirstTokenP50Ms: null,
    agentFirstTokenP95Ms: null,
  }),
}));

/** Mutable so a test can start from "already switched on". */
const mockPrefs = { saveHistory: false };

jest.mock('@/data/prefs', () => ({
  getBlockScreenshots: () => false,
  setBlockScreenshots: jest.fn(),
  getMapPreviews: () => true,
  setMapPreviews: jest.fn(),
  getPriceLookup: () => true,
  setPriceLookup: jest.fn(),
  getVisionParse: () => false,
  setVisionParse: jest.fn(),
  getSaveAskHistory: () => mockPrefs.saveHistory,
  setSaveAskHistory: jest.fn(),
}));

jest.mock('@/data/conversationRepo', () => ({ clearConversation: jest.fn() }));

/**
 * The hub's cached alias table, which reaches MMKV at import time. Only the
 * name the "Automatic" model option shows is wanted here.
 */
jest.mock('@/agent/modelConfig', () => ({
  modelForAlias: () => 'gemini-3.6-flash-lite',
}));

/**
 * The boundary between the screen and the platform. Mocking here keeps the
 * file system, the share sheet and five MMKV stores out of a test about
 * which buttons appear and when they are allowed to be pressed.
 */
jest.mock('@/data/backupFile', () => ({
  exportLedger: jest.fn(async () => ({ bills: 3, uri: 'file:///tmp/export.json' })),
  importLedger: jest.fn(async () => ({ imported: 2, skipped: 1 })),
  eraseLedger: jest.fn(async () => ({ bills: 3, queryLogRows: 0 })),
}));

const { setSaveAskHistory, setPriceLookup } = jest.requireMock('@/data/prefs');
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
  demoKeys.length = 0;
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
  it('still saves its own key', async () => {
    await draw();
    await type('Replace key', 'AIzaNEWreceipt2222');
    await press('Save');

    await waitFor(() => expect(store.receipt).toBe('AIzaNEWreceipt2222'));
  });
});

/**
 * The keys a demo build may carry (§8.2).
 *
 * Typing a provider key into a phone is unpleasant and iOS has no way to do
 * it from the laptop, so a build made for a demonstration can hold one. The
 * test that matters is the other one: an ordinary build must not offer this
 * at all, which is what keeps "no API keys in the app binary" true of every
 * build anybody else could install.
 */
describe('a key compiled into a demo build', () => {
  const KEY_PICKER = 'Use a build-in key';

  it('is not offered at all in an ordinary build', async () => {
    await draw();

    expect(screen.queryByLabelText(KEY_PICKER)).toBeNull();
  });

  it('saves the key that was chosen', async () => {
    demoKeys.push('AQ.DEMOkeyONE000000000000000000000000000000000000000');
    await draw();

    await press(KEY_PICKER);
    await press('Key 1 · AQ.D…0000');

    await waitFor(() => expect(store.receipt).toBe(demoKeys[0]));
  });

  it('shows each key masked, never in full', async () => {
    demoKeys.push('AQ.DEMOkeyONE000000000000000000000000000000000000111');
    await draw();

    await press(KEY_PICKER);

    expect(screen.queryByText(demoKeys[0])).toBeNull();
  });
});

/**
 * Choosing which model reads receipts.
 *
 * A dropdown rather than a text box because the names are not guessable, and
 * it writes as it is used rather than on Save: the reason to change it is
 * usually that a free-tier daily allowance has just run out partway through a
 * batch of receipts, and that is not an edit to leave half-finished.
 */
describe('the parse model', () => {
  it('starts on Automatic when no model has been chosen', async () => {
    await draw();

    expect(screen.getByText('Automatic')).toBeTruthy();
  });

  it('shows the model the hub names while Automatic is selected', async () => {
    await draw();

    expect(screen.getByText(/Currently gemini-3.6-flash-lite/)).toBeTruthy();
  });

  it('writes the choice without waiting for Save', async () => {
    await draw();

    await press('Model');
    await press('gemini-3.7-flash');

    await waitFor(() => expect(store.model).toBe('gemini-3.7-flash'));
  });

  /** Picking Automatic again has to clear the override, not store a name. */
  it('hands the choice back to the hub', async () => {
    store.model = 'gemini-3.8-flash';
    await draw();

    await press('Model');
    await press('Automatic');

    await waitFor(() => expect(store.model).toBeNull());
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

/**
 * The grocer.nz price lookup.
 *
 * Nothing leaves the device until a line is tapped, which is why the switch
 * can default to on — but it is still a shop learning what somebody bought,
 * so the switch has to exist and has to be written the moment it moves.
 */
describe('comparing prices', () => {
  const COMPARE = 'Compare prices on grocer.nz';

  it('is on unless it is switched off', async () => {
    await draw();

    // `on` rather than `value`: that is the prop the host switch is given.
    expect(screen.getByLabelText(COMPARE).props.on).toBe(true);
  });

  it('is written the moment it is switched off', async () => {
    await draw();

    await fireEvent(screen.getByLabelText(COMPARE), 'valueChange', false);

    expect(setPriceLookup).toHaveBeenCalledWith(false);
  });
});

/**
 * Export, import and delete-all (§15.1, §15.2).
 *
 * The behaviour worth pinning is the gate. §15.2 asks for type-to-confirm
 * because a second "are you sure" is answered by the same reflex that
 * pressed the first, so the test that matters is the one proving the delete
 * cannot fire until the word is typed.
 */
describe('your data', () => {
  const { eraseLedger, exportLedger, importLedger } = jest.requireMock('@/data/backupFile');

  // Counts, not implementations: without this each test inherits the calls
  // the one before it made, and an assertion that nothing happened passes or
  // fails on the order the file happens to run in.
  beforeEach(() => {
    exportLedger.mockClear();
    importLedger.mockClear();
    eraseLedger.mockClear();
  });

  const reveal = async () => {
    await draw();
    await fireEvent.press(screen.getByText('Delete everything…'));
  };

  it('exports, and says how much went', async () => {
    await draw();

    await fireEvent.press(screen.getByText('Export…'));

    expect(exportLedger).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(/Exported 3 bills/)).toBeTruthy());
  });

  /** "Imported 0" and "imported 0, 47 already here" are different outcomes. */
  it('reports what an import skipped as well as what it added', async () => {
    await draw();

    await fireEvent.press(screen.getByText('Import a backup…'));

    expect(importLedger).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText(/Imported 2 bills; 1 were already here/)).toBeTruthy()
    );
  });

  /** Dismissing the file picker is not a failure and must not read as one. */
  it('says nothing when the picker is dismissed', async () => {
    importLedger.mockResolvedValueOnce(null);
    await draw();

    await fireEvent.press(screen.getByText('Import a backup…'));

    await waitFor(() => expect(importLedger).toHaveBeenCalled());
    expect(screen.queryByText(/Imported/)).toBeNull();
  });

  it('asks before destroying anything', async () => {
    await draw();

    await fireEvent.press(screen.getByText('Delete everything…'));

    expect(eraseLedger).not.toHaveBeenCalled();
    expect(screen.getByText('This cannot be undone.')).toBeTruthy();
  });

  it('will not delete until the word is typed', async () => {
    await reveal();

    await fireEvent.press(screen.getByText('Delete everything'));

    expect(eraseLedger).not.toHaveBeenCalled();
  });

  it('refuses a word that is nearly right', async () => {
    await reveal();

    await fireEvent.changeText(screen.getByLabelText(/Type DELETE/), 'DELET');
    await fireEvent.press(screen.getByText('Delete everything'));

    expect(eraseLedger).not.toHaveBeenCalled();
  });

  it('deletes once the word is typed, and reports the count', async () => {
    await reveal();

    await fireEvent.changeText(screen.getByLabelText(/Type DELETE/), 'DELETE');
    await fireEvent.press(screen.getByText('Delete everything'));

    await waitFor(() => expect(eraseLedger).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Deleted 3 bills/)).toBeTruthy());
  });

  /** Backing out must leave nothing armed behind it. */
  it('can be cancelled', async () => {
    await reveal();

    await fireEvent.press(screen.getByText('Cancel'));

    expect(screen.queryByText('This cannot be undone.')).toBeNull();
    expect(eraseLedger).not.toHaveBeenCalled();
  });

  /** A failed backup that says nothing is worse than one that says it failed. */
  it('shows the reason an export failed', async () => {
    exportLedger.mockRejectedValueOnce(new Error('There are no bills to export yet.'));
    await draw();

    await fireEvent.press(screen.getByText('Export…'));

    await waitFor(() =>
      expect(screen.getByText('There are no bills to export yet.')).toBeTruthy()
    );
  });
});
