/**
 * Coordinate-system-neutral OCR shapes.
 *
 * ML Kit reports pixels with a **top-left origin**, y growing downward. The
 * Python prototype that validated this pipeline used Apple Vision, which
 * reports normalised [0,1] coordinates with a **bottom-left origin**, y growing
 * upward. Everything above this file works in ML Kit's convention; the adapter
 * that produces `OcrElement`s owns the conversion, so no algorithm has to care.
 */

/** One recognised word, reduced to what §5.4 needs. */
export interface OcrElement {
  text: string;
  /** Left edge, pixels. */
  x: number;
  /** Vertical centre, pixels. §5.4 groups on the centre, not an edge. */
  yCenter: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A recognised block, kept only for the rotation estimate in §5.3. */
export interface OcrBlock {
  /** Clockwise from top-left, as ML Kit reports them. */
  cornerPoints: readonly [Point, Point, Point, Point];
}
