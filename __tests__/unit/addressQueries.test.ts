import { addressQueries } from '@/maps/addressQueries';

/**
 * The three corpus addresses Nominatim rejected as printed, with the form that
 * was verified to resolve. Measured against the live service, not guessed —
 * see the file comment in `addressQueries.ts`.
 */
const CORPUS_FAILURES = [
  {
    merchant: 'Chemist Warehouse',
    printed: 'Shop 50 and 65 Centre Place 501 Victoria Street Hamilton Central HAMILTON',
    resolves: '501 Victoria Street Hamilton Central HAMILTON',
  },
  {
    merchant: 'TAIER CBD',
    printed: 'Shop A/33 Lorne Street, Auckland Central, Auckland 1010',
    resolves: '33 Lorne Street, Auckland Central, Auckland 1010',
  },
  {
    merchant: 'The Warehouse',
    printed: 'Te Rapa, The Base Shopping Centre, Te Rapa Road, Te Rapa',
    resolves: 'Te Rapa Road, Te Rapa',
  },
];

/** The six that resolved as printed. Nothing here may change them. */
const CORPUS_HITS = [
  '4 ENDERLEY AVENUE HAMILTON 3214',
  '17 Mill Street, Hamilton',
  '130-136 Tristram Street, Hamilton',
  '87 Thames St, Morrinsville',
  '27 Liverpool St. Hamilton',
  '44 Horsham Downs Road, Rototuna, Hamilton',
];

describe('addressQueries', () => {
  it('always tries the address as printed first', () => {
    for (const address of [...CORPUS_HITS, ...CORPUS_FAILURES.map((c) => c.printed)]) {
      expect(addressQueries(address)[0]).toBe(address.replace(/\s+/g, ' ').trim());
    }
  });

  it.each(CORPUS_FAILURES)('offers a form that resolves for $merchant', ({ printed, resolves }) => {
    expect(addressQueries(printed)).toContain(resolves);
  });

  /**
   * The fallbacks only ever run after the printed address has already missed,
   * so they cannot break a working address — but a single candidate also means
   * no wasted request for the common case.
   */
  it.each(CORPUS_HITS)('asks only once for %s, which already resolves', (address) => {
    expect(addressQueries(address)).toHaveLength(1);
  });

  it('strips a shop unit glued to the street number', () => {
    expect(addressQueries('Shop A/33 Lorne Street, Auckland')).toContain('33 Lorne Street, Auckland');
    expect(addressQueries('Unit 2/17 Mill Street')).toContain('17 Mill Street');
  });

  it('restarts at the building number when a mall numbers the shop first', () => {
    expect(addressQueries('Shop 50 and 65 Centre Place 501 Victoria Street Hamilton')).toContain(
      '501 Victoria Street Hamilton'
    );
  });

  it('peels leading segments off a comma-separated address', () => {
    const queries = addressQueries('Te Rapa, The Base Shopping Centre, Te Rapa Road, Te Rapa');
    expect(queries).toContain('The Base Shopping Centre, Te Rapa Road, Te Rapa');
    expect(queries).toContain('Te Rapa Road, Te Rapa');
  });

  /**
   * Peeling too far resolves a suburb and drops a pin in the wrong place with
   * nothing to show anything was lost. A missing map is honest; a confidently
   * wrong one is not.
   */
  it('never peels down to a single segment', () => {
    for (const query of addressQueries('A, B, C, D, E, F')) {
      expect(query.split(',').length).toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * Caught by a test, not by reading the code: this turned a street address
   * into "Rototuna, Hamilton" — a suburb two kilometres wide.
   */
  it('never peels away a segment that carries a number', () => {
    expect(addressQueries('44 Horsham Downs Road, Rototuna, Hamilton')).toEqual([
      '44 Horsham Downs Road, Rototuna, Hamilton',
    ]);
    expect(addressQueries('Shop A/33 Lorne Street, Auckland Central, Auckland 1010')).not.toContain(
      'Auckland Central, Auckland 1010'
    );
  });

  it('does not mistake a trailing postcode for a street number', () => {
    // "1010" is last, but nothing follows it to be a street name.
    expect(addressQueries('Shop A/33 Lorne Street Auckland 1010')).not.toContain('1010');
  });

  it('caps the ladder, so one bad address cannot spend the rate limit', () => {
    const queries = addressQueries('Shop 1 and 2 Some Mall 44 Long Street, A, B, C, D, E');
    expect(queries.length).toBeLessThanOrEqual(4);
  });

  it('never repeats a candidate', () => {
    for (const address of [...CORPUS_HITS, ...CORPUS_FAILURES.map((c) => c.printed)]) {
      const queries = addressQueries(address);
      expect(new Set(queries).size).toBe(queries.length);
    }
  });

  it('collapses the whitespace an OCR line break leaves behind', () => {
    expect(addressQueries('17  Mill\n Street,  Hamilton')[0]).toBe('17 Mill Street, Hamilton');
  });

  it('has nothing to ask for a blank address', () => {
    expect(addressQueries('')).toEqual([]);
    expect(addressQueries('   ')).toEqual([]);
  });
});
