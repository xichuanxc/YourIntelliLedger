/**
 * Which model answers, decided by the hub rather than the binary — §13.4/§13.5.
 *
 * §13.5: "The **alias is the only model name the app knows**. Remapping happens
 * in Worker config, so a provider change requires no app release on either
 * platform." That is the whole point of this file. Changing which model reads
 * receipts becomes a Worker edit and a redeploy — both platforms, no rebuild,
 * no store release, nothing for the user to do.
 *
 * ## Three sources, in order
 *
 * 1. **The user's Settings override**, when set. Kept deliberately: it is how a
 *    model gets evaluated before the hub is repointed at it, and §8.2 treats
 *    BYOK as a first-class mode rather than a workaround.
 * 2. **The hub's alias table**, cached 24 h (§13.4).
 * 3. **A built-in default**, so a device that has never reached the hub still
 *    reads receipts.
 *
 * ## Failure is invisible on purpose
 *
 * Nothing here throws, and nothing waits on the network to answer. An
 * unreachable hub falls through to the last known table, then to the default.
 * A config service that can stop a receipt being read would be a worse feature
 * than no config service — §13.3 says the same of quota: "never blocks app
 * functionality".
 *
 * Stage A is config only. `POST /v1/chat` (§13.2) is not implemented, so
 * receipt text still goes straight from the device to the provider under the
 * user's own key, and the hub never sees it.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Stage A has no `hub-dev` / `hub` split (§13's base URLs) because there is one
 * Worker and no custom domain yet. When that changes, select on `__DEV__`.
 */
const HUB_BASE_URL = 'https://yourintelliledger-hub.xcnz.workers.dev';

/** §13.5's aliases. `parse-strong` reads receipts; `chat-fast` is for §6. */
export type ModelAlias = 'parse-strong' | 'chat-fast';

/**
 * What to use when the hub has never been reached. Matches what the app shipped
 * with, so a first run with no network behaves exactly as it did before the hub
 * existed.
 */
const BUILTIN_DEFAULTS: Record<ModelAlias, string> = {
  'parse-strong': 'gemini-3.6-flash',
  'chat-fast': 'gemini-3.6-flash',
};

/** §13.4: "Cached in MMKV for 24 h." */
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** A config fetch must never be the reason a parse feels slow. */
const FETCH_TIMEOUT_MS = 4000;

interface HubConfig {
  aliases: Record<string, string>;
  min_app_version: string;
  notices: string[];
}

interface CachedConfig {
  config: HubConfig;
  fetchedAt: number;
}

let store: MMKV | null = null;

function mmkv(): MMKV {
  store ??= createMMKV({ id: 'yourintelliledger.hubconfig' });
  return store;
}

const CACHE_KEY = 'v1.config';

function readCache(): CachedConfig | null {
  try {
    const raw = mmkv().getString(CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedConfig;
    // Validated rather than trusted: a stored shape from an older build must
    // not reach the caller as a model name.
    if (typeof parsed?.config?.aliases !== 'object' || parsed.config.aliases === null) return null;
    if (typeof parsed.fetchedAt !== 'number') return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Refreshes the alias table if the cache is stale. Safe to call often and safe
 * to ignore — it resolves either way.
 */
export async function refreshHubConfig(fetchImpl: typeof fetch = fetch): Promise<void> {
  const cached = readCache();
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(`${HUB_BASE_URL}/v1/config`, {
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!response.ok) return;

    const config = (await response.json()) as HubConfig;
    if (typeof config?.aliases !== 'object' || config.aliases === null) return;

    mmkv().set(CACHE_KEY, JSON.stringify({ config, fetchedAt: Date.now() } satisfies CachedConfig));
  } catch {
    // Offline, timed out, or the hub is down. The previous table stands; if
    // there is none, callers fall through to the built-in default.
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The concrete model for an alias, from the cached hub table or the built-in
 * default. Synchronous — a caller deciding which model to call must not wait on
 * a network round-trip to find out.
 *
 * A *stale* cache is used deliberately rather than discarded: yesterday's
 * answer from the hub is better than a default that predates it.
 */
export function modelForAlias(alias: ModelAlias): string {
  return readCache()?.config.aliases[alias] ?? BUILTIN_DEFAULTS[alias];
}

/** Whether the alias table came from the hub — for Settings to show honestly. */
export function hubConfigStatus(): { source: 'hub' | 'built-in'; fetchedAt: number | null } {
  const cached = readCache();
  return cached
    ? { source: 'hub', fetchedAt: cached.fetchedAt }
    : { source: 'built-in', fetchedAt: null };
}
