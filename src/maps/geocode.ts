/**
 * Address → coordinate, on demand (§4.14).
 *
 * The spec is deliberate about this: `bills.merchant_address` stays as printed,
 * and if a version ever wants a pin rather than a "navigate to" action it
 * should "geocode **on demand when the user opens the map view**, not at parse
 * time". That is exactly when this runs — opening a bill that has an address,
 * with map previews left on.
 *
 * Nominatim is used because it needs no key, which keeps §4.14's "no key, no
 * geocoding API call" property for everyone who turns the preview off. Its
 * usage policy is the constraint that shapes this file:
 *
 *  - an identifying User-Agent (set below),
 *  - at most one request per second (the app makes one per bill opened, and
 *    only for an address it has not seen),
 *  - results must be cached — see `geocodeCache.ts`, which caches misses too.
 *
 * A heavier deployment should move to a keyed provider; only `ENDPOINT` and
 * the response shape below would change.
 */

import { addressQueries } from './addressQueries';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export class GeocodeError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GeocodeError';
  }
}

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

/** Nominatim asks for something that identifies the application. */
const USER_AGENT = 'YourIntelliLedger/0.1 (COMPX576 student project)';

/** A preview is a nicety; it must not hold the screen up. */
const TIMEOUT_MS = 8000;

/** Nominatim's published ceiling is one request per second. */
const MIN_INTERVAL_MS = 1100;

export interface GeocodeOptions {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  /** Overridden to 0 in tests, so they do not sit through the rate limiter. */
  minIntervalMs?: number;
}

/**
 * Resolves a printed address, trying `addressQueries`' ladder in order and
 * taking the first that lands.
 *
 * Returns `null` when no candidate is found — a normal outcome for a
 * half-legible thermal receipt, and one the caller shows as "no map" rather
 * than as an error. Throws `GeocodeError` when the lookup itself failed, which
 * is a different thing: offline, rate-limited, or a changed response shape.
 * A failure aborts the ladder rather than burning the remaining candidates on
 * a service that is not answering.
 */
export async function geocode(
  address: string,
  options: GeocodeOptions = {}
): Promise<GeoPoint | null> {
  for (const query of addressQueries(address)) {
    const point = await search(query, options);
    if (point) return point;
  }

  return null;
}

async function search(
  query: string,
  { fetchImpl = fetch, signal, minIntervalMs = MIN_INTERVAL_MS }: GeocodeOptions
): Promise<GeoPoint | null> {
  await rateLimit(minIntervalMs);

  const url = `${ENDPOINT}?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`;

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: signal ?? timeout.signal,
    });
  } catch (error) {
    throw new GeocodeError('Could not reach the geocoding service.', error);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new GeocodeError(`Geocoding failed with HTTP ${response.status}.`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new GeocodeError('Geocoding returned something that was not JSON.', error);
  }

  if (!Array.isArray(body)) {
    throw new GeocodeError('Geocoding returned an unexpected shape.');
  }

  return firstPoint(body);
}

/**
 * Serialises every lookup this process makes and spaces them out.
 *
 * Per-call throttling would not be enough: opening two bills in quick
 * succession, or one address walking its ladder, are both several requests
 * that must still add up to one per second. The queue is a promise chain, and
 * a failed link is swallowed so one error does not wedge every later lookup.
 */
let queue: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

function rateLimit(minIntervalMs: number): Promise<void> {
  if (minIntervalMs <= 0) return Promise.resolve();

  const turn = queue.then(async () => {
    const wait = minIntervalMs - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });

  queue = turn.catch(() => undefined);
  return turn;
}

/**
 * Nominatim returns lat/lon as *strings*, so this parses rather than casts,
 * and range-checks: a NaN would place the pin nowhere and blank the preview
 * with no explanation.
 */
function firstPoint(results: unknown[]): GeoPoint | null {
  for (const result of results) {
    if (typeof result !== 'object' || result === null) continue;

    const lat = Number((result as { lat?: unknown }).lat);
    const lon = Number((result as { lon?: unknown }).lon);

    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat, lon };
    }
  }

  return null;
}
