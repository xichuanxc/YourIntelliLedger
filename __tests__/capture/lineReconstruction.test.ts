import {
  DEFAULT_LINE_CONFIG,
  groupIntoLines,
  reconstructLines,
} from '@/capture/lineReconstruction';
import type { OcrElement } from '@/capture/types';

/**
 * Roughly 10px per character, 20px tall — so the average character width is
 * ~10 and §5.4's 2.5x column threshold trips at a gap above ~25px. Line
 * grouping tolerates 0.6 x 20 = 12px of centre-to-centre drift.
 */
const el = (text: string, x: number, yCenter: number, width = text.length * 10, height = 20): OcrElement => ({
  text,
  x,
  yCenter,
  width,
  height,
});

describe('reconstructLines (§5.4)', () => {
  it('joins words on the same row into one line', () => {
    expect(reconstructLines([el('ANCHOR', 0, 100), el('MILK', 70, 100)])).toBe('ANCHOR MILK');
  });

  it('orders left to right regardless of the order OCR returned them', () => {
    expect(reconstructLines([el('MILK', 70, 100), el('ANCHOR', 0, 100)])).toBe('ANCHOR MILK');
  });

  it('starts a new line once the vertical gap exceeds the threshold', () => {
    // 12px is the limit; 10 stays, 30 breaks.
    expect(reconstructLines([el('A', 0, 100), el('B', 0, 110)])).toBe('A B');
    expect(reconstructLines([el('A', 0, 100), el('B', 0, 130)])).toBe('A\nB');
  });

  it('inserts a wide-gap marker between the name and price columns', () => {
    const line = reconstructLines([el('MILK', 0, 100), el('$2.40', 300, 100)]);
    expect(line).toBe(`MILK${DEFAULT_LINE_CONFIG.columnSeparator}$2.40`);
    expect(line).not.toBe('MILK $2.40');
  });

  it('uses a single space for an ordinary word gap', () => {
    expect(reconstructLines([el('BLUE', 0, 100), el('TOP', 45, 100)])).toBe('BLUE TOP');
  });

  /**
   * The failure this module exists to fix. The prototype found Vision
   * returning the whole price column as one trailing group, positionally
   * detached from the names beside it — so the parser saw prices with no
   * association to items.
   */
  it('rebuilds name/price association from a detached price column', () => {
    const elements = [
      // Names first, in reading order...
      el('BANANAS', 0, 100),
      el('BREAD', 0, 140),
      el('MILK', 0, 180),
      // ...then every price, exactly as a detection-region grouping returns them.
      el('$3.65', 300, 100),
      el('$4.20', 300, 140),
      el('$6.39', 300, 180),
    ];

    expect(reconstructLines(elements).split('\n')).toEqual([
      `BANANAS${DEFAULT_LINE_CONFIG.columnSeparator}$3.65`,
      `BREAD${DEFAULT_LINE_CONFIG.columnSeparator}$4.20`,
      `MILK${DEFAULT_LINE_CONFIG.columnSeparator}$6.39`,
    ]);
  });

  it('anchors a line on its first element, so a sloping row cannot chain forever', () => {
    // Each element sits 10px below the last — under the 12px threshold pairwise,
    // but the third is 20px from the line's anchor and must break away.
    // Kept horizontally close so the column-gap rule stays out of it.
    const elements = [el('A', 0, 100), el('B', 20, 110), el('C', 40, 120)];
    expect(reconstructLines(elements)).toBe('A B\nC');
  });

  it('ignores blank elements', () => {
    // A and B sit close enough that only an ordinary space separates them —
    // the blank element between them must not widen the gap either.
    expect(reconstructLines([el('A', 0, 100), el('   ', 12, 100), el('B', 20, 100)])).toBe('A B');
  });

  it('returns an empty string for no input', () => {
    expect(reconstructLines([])).toBe('');
    expect(reconstructLines([el('  ', 0, 0)])).toBe('');
  });

  it('handles a single element', () => {
    expect(reconstructLines([el('TOTAL', 0, 0)])).toBe('TOTAL');
  });

  it('keeps non-Latin text intact — §4.10 search depends on it surviving', () => {
    const line = reconstructLines([el('豆腐干', 0, 100, 60), el('$5.50', 300, 100)]);
    expect(line).toContain('豆腐干');
    expect(line).toBe(`豆腐干${DEFAULT_LINE_CONFIG.columnSeparator}$5.50`);
  });

  it('is driven by config, so thresholds can be retuned without touching the algorithm', () => {
    const elements = [el('MILK', 0, 100), el('$2.40', 300, 100)];
    const loose = reconstructLines(elements, { ...DEFAULT_LINE_CONFIG, columnGapFactor: 1000 });
    expect(loose).toBe('MILK $2.40');
  });
});

describe('groupIntoLines', () => {
  it('returns rows top to bottom', () => {
    const rows = groupIntoLines([el('C', 0, 300), el('A', 0, 100), el('B', 0, 200)]);
    expect(rows.map((row) => row[0].text)).toEqual(['A', 'B', 'C']);
  });

  it('scales the threshold with the median height, not a fixed pixel count', () => {
    // Same 30px gap: a break for 20px-tall text, not for 60px-tall text.
    const small = groupIntoLines([el('A', 0, 100), el('B', 0, 130)]);
    const large = groupIntoLines([
      el('A', 0, 100, 40, 60),
      el('B', 0, 130, 40, 60),
    ]);
    expect(small).toHaveLength(2);
    expect(large).toHaveLength(1);
  });
});
