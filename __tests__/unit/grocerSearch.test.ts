/**
 * Handing a bought item to grocer.nz for today's prices (demo).
 *
 * The URL is the whole feature, so what it contains is the whole test. Two
 * things matter: that a till's punctuation does not become a broken query,
 * and that a line with nothing searchable offers no link rather than an
 * empty search.
 */

import { grocerSearchTerm, grocerSearchUrl } from '@/data/grocerSearch';

describe('what to search for', () => {
  it('sends a short name unchanged', () => {
    expect(grocerSearchTerm({ name: 'Green Valley 2 Ltr' })).toBe('Green Valley 2 Ltr');
  });

  /**
   * The case this narrowing exists for. Sending all six words searches for
   * the till's contractions too, and a product matching one real word out of
   * six ranks below one matching two of its own.
   */
  it('drops the abbreviations a till pads a line with', () => {
    expect(grocerSearchTerm({ name: 'Janola Pwm C/Tg Eoc 750Ml' })).toBe('Janola Pwm Eoc 750Ml');
  });

  it('keeps only the leading words, which are the identifying ones', () => {
    expect(grocerSearchTerm({ name: 'Anchor Milk Blue Top Plastic Bottle' })).toBe(
      'Anchor Milk Blue Top'
    );
  });

  /** A size separates three milks that share every other word. */
  it('keeps a size however short it is', () => {
    expect(grocerSearchTerm({ name: 'Milk Standard Blue 2L' })).toContain('2L');
  });

  it('collapses the gaps a receipt leaves behind', () => {
    expect(grocerSearchTerm({ name: '  Bread   ---  White  ' })).toBe('Bread White');
  });

  /** A mangled OCR line must not become a paragraph of query string. */
  it('caps a runaway name', () => {
    expect(grocerSearchTerm({ name: 'x'.repeat(200) }).length).toBeLessThanOrEqual(60);
  });

  /** A poor query beats no query, so a line of fragments still searches. */
  it('falls back to the fragments when nothing else survives', () => {
    expect(grocerSearchTerm({ name: 'Pw C/Tg' })).toBe('Pw C Tg');
  });

  it('has nothing to search for in a nameless line', () => {
    expect(grocerSearchTerm({ name: '***' })).toBe('');
  });
});

describe('the link', () => {
  it('points at grocer search with the term encoded', () => {
    expect(grocerSearchUrl({ name: 'Green Valley 2 Ltr' })).toBe(
      'https://grocer.nz/search?term=Green%20Valley%202%20Ltr'
    );
  });

  /**
   * A plain https URL, not a custom scheme: grocer's Android app claims every
   * grocer.nz URL through assetlinks.json, so this opens the app where it is
   * installed and the browser where it is not, with nothing to detect.
   */
  it('is an ordinary web address', () => {
    expect(grocerSearchUrl({ name: 'Milk' })!.startsWith('https://grocer.nz/')).toBe(true);
  });

  /** No link at all beats a link to an empty search. */
  it('offers nothing for a line with no words', () => {
    expect(grocerSearchUrl({ name: '   ' })).toBeNull();
  });
});
