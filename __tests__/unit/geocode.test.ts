import { geocode, GeocodeError } from '@/maps/geocode';
import { expectRejection } from '../support/expectRejection';

const ok = (body: unknown): typeof fetch =>
  (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as Response) as unknown as typeof fetch;

/** What Nominatim actually returns: lat and lon as strings, not numbers. */
const NOMINATIM_HIT = [
  { lat: '-37.7395123', lon: '175.2825456', display_name: 'New World Rototuna, Hamilton' },
];

describe('geocode', () => {
  it('parses the first result', async () => {
    const point = await geocode('44 Horsham Downs Road, Rototuna, Hamilton', {
      fetchImpl: ok(NOMINATIM_HIT),
    });

    expect(point).toEqual({ lat: -37.7395123, lon: 175.2825456 });
  });

  it('asks for one result in JSON, with the address escaped', async () => {
    let seen = '';
    const spy = (async (url: string) => {
      seen = url;
      return { ok: true, status: 200, json: async () => NOMINATIM_HIT } as Response;
    }) as unknown as typeof fetch;

    await geocode('17 Mill Street, Hamilton', { fetchImpl: spy });

    expect(seen).toContain('format=jsonv2');
    expect(seen).toContain('limit=1');
    expect(seen).toContain(encodeURIComponent('17 Mill Street, Hamilton'));
  });

  it('identifies the app, as Nominatim asks callers to', async () => {
    let headers: Record<string, string> = {};
    const spy = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return { ok: true, status: 200, json: async () => NOMINATIM_HIT } as Response;
    }) as unknown as typeof fetch;

    await geocode('somewhere', { fetchImpl: spy });

    expect(headers['User-Agent']).toContain('YourIntelliLedger');
  });

  /**
   * "Not found" is an ordinary outcome for a faded thermal receipt, and the
   * caller draws no map for it. An *error* means the lookup itself failed and
   * is worth retrying later — the two must not collapse into one, or a cached
   * "no such place" would poison an address that was merely offline once.
   */
  it('returns null for no results rather than throwing', async () => {
    expect(await geocode('nowhere at all', { fetchImpl: ok([]) })).toBeNull();
  });

  it('returns null for a blank address without going near the network', async () => {
    const never = (() => {
      throw new Error('should not have been called');
    }) as unknown as typeof fetch;

    expect(await geocode('   ', { fetchImpl: never })).toBeNull();
  });

  it('skips a result whose coordinates will not parse', async () => {
    const point = await geocode('x', {
      fetchImpl: ok([{ lat: 'nonsense', lon: '1' }, ...NOMINATIM_HIT]),
    });

    expect(point).toEqual({ lat: -37.7395123, lon: 175.2825456 });
  });

  it('rejects coordinates outside the world', async () => {
    expect(await geocode('x', { fetchImpl: ok([{ lat: '95', lon: '0' }]) })).toBeNull();
    expect(await geocode('x', { fetchImpl: ok([{ lat: '0', lon: '-200' }]) })).toBeNull();
  });

  it('reports a rate limit as a failure, not as an address that does not exist', async () => {
    const rateLimited = (async () => ({ ok: false, status: 429 }) as Response) as unknown as typeof fetch;

    const error = await expectRejection(() => geocode('x', { fetchImpl: rateLimited }));
    expect(error).toBeInstanceOf(GeocodeError);
    expect((error as Error).message).toContain('429');
  });

  it('reports being offline as a failure', async () => {
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    const error = await expectRejection(() => geocode('x', { fetchImpl: offline }));
    expect(error).toBeInstanceOf(GeocodeError);
  });

  it('reports a non-JSON body as a failure', async () => {
    const html = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }) as unknown as Response) as unknown as typeof fetch;

    expect(await expectRejection(() => geocode('x', { fetchImpl: html }))).toBeInstanceOf(GeocodeError);
  });

  it('reports an unexpected shape as a failure rather than crashing on it', async () => {
    expect(await expectRejection(() => geocode('x', { fetchImpl: ok({ error: 'nope' }) }))).toBeInstanceOf(
      GeocodeError
    );
  });
});
