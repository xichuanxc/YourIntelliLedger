/**
 * Two keys, because Ask and receipt parsing can now reach different companies
 * — parsing goes straight to Google, while `chat-fast` may be pointed at
 * DeepSeek in the hub's config (§13.5).
 *
 * The fallback is the part worth pinning: one key must keep working for the
 * people who have not pointed the two anywhere different.
 */

import {
  clearAskKey,
  clearByokKey,
  getAskKey,
  getByokKey,
  hasOwnAskKey,
  setAskKey,
  setByokKey,
} from '@/agent/byokKey';

// `mock`-prefixed because Jest hoists the factory above this declaration and
// only allows out-of-scope names it can be sure are mocks.
const mockStore = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));

beforeEach(() => {
  mockStore.clear();
});

describe('the Ask key', () => {
  it('falls back to the receipt key, so one key still works', async () => {
    await setByokKey('shared-key');
    expect(await getAskKey()).toBe('shared-key');
    expect(await hasOwnAskKey()).toBe(false);
  });

  it('takes its own once set, leaving the receipt key alone', async () => {
    await setByokKey('google-key');
    await setAskKey('deepseek-key');

    expect(await getAskKey()).toBe('deepseek-key');
    expect(await getByokKey()).toBe('google-key');
    expect(await hasOwnAskKey()).toBe(true);
  });

  /** Clearing hands Ask back to the receipt key rather than leaving it keyless. */
  it('reverts to the receipt key when cleared', async () => {
    await setByokKey('google-key');
    await setAskKey('deepseek-key');
    await clearAskKey();

    expect(await getAskKey()).toBe('google-key');
    expect(await hasOwnAskKey()).toBe(false);
  });

  /**
   * A blank box used to clear the separate key and hand Ask back to the
   * receipt key. It no longer does: the field says leaving it blank keeps
   * what is there, and the switch above it is how Ask is handed back.
   */
  it('keeps its own key when the box is left blank', async () => {
    await setByokKey('google-key');
    await setAskKey('deepseek-key');
    await setAskKey('   ');

    expect(await hasOwnAskKey()).toBe(true);
    expect(await getAskKey()).toBe('deepseek-key');
  });

  it('has nothing to offer when neither is set', async () => {
    expect(await getAskKey()).toBeNull();
  });

  it('trims, because a pasted key often arrives with whitespace', async () => {
    await setAskKey('  deepseek-key\n');
    expect(await getAskKey()).toBe('deepseek-key');
  });
});

/**
 * Saving an empty box.
 *
 * The field says "leave blank to keep the current key", and this used to
 * clear the keystore instead: the one gesture meant to change nothing took
 * the key away, and the next receipt could not be read. Removing a key has
 * its own button.
 */
describe('an empty key', () => {
  it('leaves the receipt key where it was', async () => {
    await setByokKey('AIzaREALkey');

    await setByokKey('');

    expect(await getByokKey()).toBe('AIzaREALkey');
  });

  it('is not fooled by a box holding only spaces', async () => {
    await setByokKey('AIzaREALkey');

    await setByokKey('   ');

    expect(await getByokKey()).toBe('AIzaREALkey');
  });

  it('leaves the Ask key where it was', async () => {
    await setAskKey('sk-ASKkey');

    await setAskKey('');

    expect(await hasOwnAskKey()).toBe(true);
    expect(await getAskKey()).toBe('sk-ASKkey');
  });

  /** Clearing still works — it just has to be asked for. */
  it('still clears when clearing is what was asked for', async () => {
    await setByokKey('AIzaREALkey');

    await clearByokKey();

    expect(await getByokKey()).toBeNull();
  });
});
