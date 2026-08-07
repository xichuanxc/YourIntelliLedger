/**
 * Geometry correction — spec §5.3, step 2.
 *
 * §5.3 separates two problems. **Perspective distortion** (a receipt shot at an
 * angle becomes a trapezoid) is what produced the merged-row failures in the
 * prototype, and rotation cannot fix it — the system document scanner corrects
 * that before OCR, which is the main reason §5.2 prefers it. What is left is
 * **residual rotation**, and this module handles that.
 *
 * It stays useful even though the scanner exists: gallery imports never went
 * through the scanner, Android devices without Play Services cannot run it
 * (§5.2), and the scanner can leave a degree or two behind.
 *
 * The rotation is applied to **box coordinates, not the bitmap** — cheap,
 * deterministic, and unit-testable against saved fixture boxes, with no image
 * decode. Line grouping only needs the boxes to line up; the pixels are never
 * consulted again.
 */

import type { OcrBlock, OcrElement, Point } from '@/capture/types';

/** Below this, rotating is pointless churn: half a degree moves nothing. */
export const MIN_CORRECTION_RADIANS = (0.5 * Math.PI) / 180;

/**
 * Beyond this we are not looking at skew any more — more likely a sideways
 * photo or a misdetection, and rotating by a wrong large angle is far worse
 * than leaving it alone.
 */
export const MAX_CORRECTION_RADIANS = (30 * Math.PI) / 180;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * The angle of a block's top edge, in radians, positive clockwise (y grows
 * downward). ML Kit reports corner points clockwise from top-left.
 */
export function blockAngle(corners: readonly [Point, Point, Point, Point]): number {
  const [topLeft, topRight] = corners;
  return Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x);
}

/**
 * Median skew across blocks.
 *
 * The median rather than the mean, because a single misdetected block — a logo
 * read as text, a barcode edge — would drag a mean by degrees while leaving a
 * median untouched. Returns 0 when the estimate is too small to matter or too
 * large to trust.
 */
export function estimateRotation(blocks: readonly OcrBlock[]): number {
  const angles = blocks
    .map((block) => blockAngle(block.cornerPoints))
    .filter((angle) => Number.isFinite(angle));

  if (angles.length === 0) return 0;

  const angle = median(angles);
  if (Math.abs(angle) < MIN_CORRECTION_RADIANS) return 0;
  if (Math.abs(angle) > MAX_CORRECTION_RADIANS) return 0;
  return angle;
}

/** Rotates a point about `origin` by `radians` (positive clockwise). */
export function rotatePoint(point: Point, radians: number, origin: Point): Point {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/**
 * Rotates each element's box by `-angle`, straightening the page.
 *
 * Only the centre moves; width and height are preserved. For the small
 * residual angles this stage sees, the box's own tilt is immaterial — what
 * matters is that elements which belong to one printed row end up sharing a
 * `yCenter`, which is what §5.4 groups on.
 */
export function deskewElements(
  elements: readonly OcrElement[],
  angle: number,
  origin: Point
): OcrElement[] {
  if (angle === 0) return [...elements];

  return elements.map((element) => {
    const centre = { x: element.x + element.width / 2, y: element.yCenter };
    const rotated = rotatePoint(centre, -angle, origin);
    return {
      ...element,
      x: rotated.x - element.width / 2,
      yCenter: rotated.y,
    };
  });
}

/** The centre of the page, the natural pivot for straightening it. */
export function pageCentre(width: number, height: number): Point {
  return { x: width / 2, y: height / 2 };
}

/**
 * Estimates the skew from the blocks and straightens the elements in one step.
 * Returns the applied angle so callers can log or surface it.
 */
export function correctSkew(
  elements: readonly OcrElement[],
  blocks: readonly OcrBlock[],
  page: { width: number; height: number }
): { elements: OcrElement[]; angleRadians: number } {
  const angleRadians = estimateRotation(blocks);
  return {
    elements: deskewElements(elements, angleRadians, pageCentre(page.width, page.height)),
    angleRadians,
  };
}
