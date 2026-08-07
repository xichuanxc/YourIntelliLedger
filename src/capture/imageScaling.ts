/**
 * Pure sizing rules for captured images — spec §5.2.
 *
 * Kept apart from `image.ts` because that module imports
 * `expo-image-manipulator`, which reaches `expo-modules-core` and cannot load
 * in the Node test project. The arithmetic is the part worth testing, so it
 * lives where the fast test project can reach it.
 */

export const CAPTURE_IMAGE_CONFIG = {
  /** §5.2: larger inputs cost time without buying accuracy. */
  maxLongEdge: 2000,
  jpegQuality: 0.85,
} as const;

/**
 * The factor to multiply both dimensions by, so the long edge lands on the
 * cap. Returns 1 when the image is already small enough.
 *
 * One factor for both axes, deliberately: OCR box coordinates are consumed by
 * §5.3 and §5.4 in the image's own space, so a non-uniform scale would distort
 * the geometry those steps reason about.
 */
export function resizeScale(
  width: number,
  height: number,
  maxLongEdge: number = CAPTURE_IMAGE_CONFIG.maxLongEdge
): number {
  const longEdge = Math.max(width, height);
  return longEdge <= maxLongEdge ? 1 : maxLongEdge / longEdge;
}
