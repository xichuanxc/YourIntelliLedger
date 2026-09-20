/**
 * One request per receipt (§5.2).
 *
 * The claim worth proving rather than asserting: with the separate-receipts
 * switch on, `parse_receipt` receives one receipt's text per call. Two
 * receipts in one prompt asks the model to merge two shops into a single
 * object, which it will attempt — and the result looks plausible in the
 * ledger afterwards.
 */

import { splitByPage } from '@/capture/splitPages';
import type { CapturedPage, CaptureResult } from '@/capture/pipeline';

/** The split cares about page text and numbering; the image is carried along. */
const page = (pageNo: number, text: string): CapturedPage => ({
  pageNo,
  text,
  skewDegrees: 0.5,
  elementCount: text.split(/\s+/).length,
  image: { uri: `file://page-${pageNo}.jpg` } as CapturedPage['image'],
});

const capture = (...texts: string[]): CaptureResult => ({
  pages: texts.map((text, index) => page(index + 1, text)),
  text: texts.join('\n\n'),
  path: 'scanner',
  durationMs: 900,
});

const NEW_WORLD = 'NEW WORLD\nMilk 2L 4.50\nTOTAL 4.50';
const PAKNSAVE = "PAK'nSAVE\nBread 2.20\nTOTAL 2.20";

describe('splitting a scan into separate receipts', () => {
  it('makes one capture per page', () => {
    expect(splitByPage(capture(NEW_WORLD, PAKNSAVE))).toHaveLength(2);
  });

  /** The reason the feature exists: one receipt's text per request. */
  it('gives each capture only its own page’s text', () => {
    const [first, second] = splitByPage(capture(NEW_WORLD, PAKNSAVE));

    expect(first.text).toBe(NEW_WORLD);
    expect(second.text).toBe(PAKNSAVE);
    // Neither carries the other's shop, which is what a joined prompt does.
    expect(first.text).not.toContain("PAK'nSAVE");
    expect(second.text).not.toContain('NEW WORLD');
  });

  it('gives each capture only its own page', () => {
    const split = splitByPage(capture(NEW_WORLD, PAKNSAVE));

    for (const one of split) expect(one.pages).toHaveLength(1);
    expect(split[0].pages[0].image.uri).toBe('file://page-1.jpg');
    expect(split[1].pages[0].image.uri).toBe('file://page-2.jpg');
  });

  /**
   * Each becomes the first page of its own bill, and images are stored at
   * receipts/{bill_id}/{page_no}.jpg — a page still numbered 2 would write
   * the second bill's image to a path no one reads.
   */
  it('renumbers every page to one', () => {
    for (const one of splitByPage(capture(NEW_WORLD, PAKNSAVE, 'THIRD SHOP\nTOTAL 1.00'))) {
      expect(one.pages[0].pageNo).toBe(1);
    }
  });

  it('carries the capture path and timing onto each', () => {
    for (const one of splitByPage(capture(NEW_WORLD, PAKNSAVE))) {
      expect(one.path).toBe('scanner');
      expect(one.durationMs).toBe(900);
    }
  });

  it('leaves a single-page scan as one capture', () => {
    const split = splitByPage(capture(NEW_WORLD));

    expect(split).toHaveLength(1);
    expect(split[0].text).toBe(NEW_WORLD);
  });

  it('does not touch the capture it was given', () => {
    const original = capture(NEW_WORLD, PAKNSAVE);
    splitByPage(original);

    expect(original.pages).toHaveLength(2);
    expect(original.text).toBe(`${NEW_WORLD}\n\n${PAKNSAVE}`);
    expect(original.pages[1].pageNo).toBe(2);
  });
});
