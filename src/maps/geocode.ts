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

export interface GeocodeOptions {
  /** Injected in tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Resolves a printed address.
 *
 * Returns `null` when the address is simply not found — a normal outcome for
 * a half-legible thermal receipt, and one the caller shows as "no map" rather
 * than as an error. Throws `GeocodeError` when the lookup itself failed, which
 * is a different thing: offline, rate-limited, or a changed response shape.
 */
export async function geocode(
  address: string,
  { fetchImpl = fetch, signal }: GeocodeOptions = {}
): Promise<GeoPoint | null> {
  const query = address.trim();
  if (!query) return null;

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
