/**
 * Line reconstruction — spec §5.4, ported from the prototype's
 * `ocr_prototype.py::reconstruct_lines`.
 *
 * ## Why this exists
 *
 * On-device OCR does not return text in reading order. The prototype confirmed
 * it on the New World receipt: the entire price column came back as one
 * disjoint trailing group, positionally separated from the item names beside
 * it. Feeding that to the parser loses the association between a name and its
 * price — which is the whole receipt. So the elements are regrouped by
 * geometry: cluster into lines by vertical proximity, order left-to-right
 * within a line, and preserve the wide gap between the name and price columns
 * that the parsing prompt relies on.
 *
 * ## Faithful to the Python, not literal
 *
 * Two deliberate differences, both forced by the coordinate systems:
 *
 * 1. The Python sorts by `-y` because Vision's origin is bottom-left. Here y
 *    grows downward (ML Kit), so the sort is ascending.
 * 2. The Python anchors a line on its first element's **bottom edge**; this
 *    uses the **vertical centre**, which is what §5.4 actually specifies. For
 *    elements of similar height the two agree; the centre is steadier when a
 *    tall glyph or a two-line block sits in the row.
 *
 * The grouping comparison is against the line's **first** element, not the
 * previous one — matching the Python. Chaining against the previous element
 * would let a gently sloping row drift into a single line indefinitely.
 */

import type { OcrElement } from '@/capture/types';

export interface LineReconstructionConfig {
  /** New line when the centre-to-centre gap exceeds this × median height. */
  lineGapFactor: number;
  /** Wide-gap marker when the x-gap exceeds this × average character width. */
  columnGapFactor: number;
  /** Inserted where a wide gap is detected; preserves the price column. */
  columnSeparator: string;
  /** Inserted between words on the same line. */
  wordSeparator: string;
}

/**
 * §5.4's thresholds, tuned against the fixture corpus and kept in one place so
 * the cross-platform check in Week 5 can adjust them without touching the
 * algorithm.
 */
export const DEFAULT_LINE_CONFIG: LineReconstructionConfig = {
  lineGapFactor: 0.6,
  columnGapFactor: 2.5,
  columnSeparator: '    ',
  wordSeparator: ' ',
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Groups elements into rows, top to bottom. Exposed for testing and §5.3. */
export function groupIntoLines(
  elements: readonly OcrElement[],
  config: LineReconstructionConfig = DEFAULT_LINE_CONFIG
): OcrElement[][] {
  const usable = elements.filter((element) => element.text.trim() !== '');
  if (usable.length === 0) return [];

  const medianHeight = median(usable.map((element) => element.height));

  // Ascending: ML Kit's y grows downward, so this is top to bottom.
  const sorted = [...usable].sort((a, b) => a.yCenter - b.yCenter);

  const lines: OcrElement[][] = [];
  for (const element of sorted) {
    const current = lines[lines.length - 1];
    const anchor = current?.[0];

    if (anchor && Math.abs(anchor.yCenter - element.yCenter) <= config.lineGapFactor * medianHeight) {
      current.push(element);
    } else {
      lines.push([element]);
    }
  }

  return lines;
}

/** Renders one grouped row, inserting a wide-gap marker between columns. */
export function renderLine(
  line: readonly OcrElement[],
  config: LineReconstructionConfig = DEFAULT_LINE_CONFIG
): string {
  const ordered = [...line].sort((a, b) => a.x - b.x);
  if (ordered.length === 0) return '';

  // Per-element width divided by its own character count, averaged across the
  // row — a proportional-width estimate that survives one long word sitting
  // next to several short ones.
  const averageCharWidth = mean(
    ordered.map((element) => element.width / Math.max(element.text.length, 1))
  );

  const parts: string[] = [ordered[0].text];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    const gap = current.x - (previous.x + previous.width);

    parts.push(gap > config.columnGapFactor * averageCharWidth ? config.columnSeparator : config.wordSeparator);
    parts.push(current.text);
  }

  return parts.join('');
}

/**
 * Regroups OCR elements into reading order and renders them as text.
 *
 * The output is what the `parse_receipt` tool receives (§5.1), so its shape —
 * one row per line, wide gaps preserved — is part of the prompt's contract.
 */
export function reconstructLines(
  elements: readonly OcrElement[],
  config: LineReconstructionConfig = DEFAULT_LINE_CONFIG
): string {
  return groupIntoLines(elements, config)
    .map((line) => renderLine(line, config))
    .join('\n');
}
