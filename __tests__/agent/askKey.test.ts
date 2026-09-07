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

  it('treats a blank entry as clearing, not as a key', async () => {
    await setByokKey('google-key');
    await setAskKey('deepseek-key');
    await setAskKey('   ');

    expect(await hasOwnAskKey()).toBe(false);
    expect(await getAskKey()).toBe('google-key');
  });

  it('has nothing to offer when neither is set', async () => {
    expect(await getAskKey()).toBeNull();
  });

  it('trims, because a pasted key often arrives with whitespace', async () => {
    await setAskKey('  deepseek-key\n');
    expect(await getAskKey()).toBe('deepseek-key');
  });
});
