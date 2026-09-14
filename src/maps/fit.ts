/**
 * Fitting several points into one viewport (§4.14).
 *
 * `tiles.ts` centres a map on a single address, which is all a bill preview
 * ever needs. A map of the shops behind a period needs the other thing: a
 * centre *and* a zoom chosen so every pin lands inside the frame, whether the
 * shops are four suburbs apart or four hundred kilometres.
 *
 * Pure Mercator arithmetic with no imports beyond `tiles`, so it runs in the
 * `node` test project alongside the rest of the map maths.
 */

import { DEFAULT_ZOOM, TILE_SIZE, project, unproject, type LonLat } from '@/maps/tiles';

/** Below this the map is an ocean with specks on it; nothing is legible. */
const MIN_ZOOM = 2;

/**
 * Room at the edges, in pixels.
 *
 * A pin is drawn *above* the point it marks, so a shop at the very top of the
 * frame would have its head cropped. This is the pin's height plus a little,
 * and it is why the fit is computed against a viewport smaller than the real
 * one.
 */
const DEFAULT_PADDING = 34;

export interface FitOptions {
  padding?: number;
  /** Street level by default — the same ceiling a single-address preview uses. */
  maxZoom?: number;
}

export interface FittedView {
  centre: LonLat;
  zoom: number;
  /**
   * Where each input point lands, in viewport pixels, in the order given.
   * The caller positions its pins from these.
   */
  placements: { x: number; y: number }[];
}

/**
 * Chooses a centre and zoom containing every point, and places them.
 *
 * Returns null for no points: there is no meaningful centre for an empty set,
 * and a caller that must decide whether to show a map at all should not have
 * to interpret a zero.
 *
 * A single point gets `maxZoom` — there is nothing to fit, so the answer is
 * the closest useful view, which is exactly what a bill preview shows.
 */
export function fitPoints(
  points: readonly LonLat[],
  width: number,
  height: number,
  options: FitOptions = {}
): FittedView | null {
  if (points.length === 0 || !(width > 0) || !(height > 0)) return null;

  const padding = options.padding ?? DEFAULT_PADDING;
  const maxZoom = options.maxZoom ?? DEFAULT_ZOOM;

  // Projected at zoom 0, where one unit is the whole world. Every other zoom
  // is this scaled by 2**zoom, so the fit can be solved once rather than
  // searched for.
  const projected = points.map((point) => project(point, 0));

  const minX = Math.min(...projected.map((p) => p.x));
  const maxX = Math.max(...projected.map((p) => p.x));
  const minY = Math.min(...projected.map((p) => p.y));
  const maxY = Math.max(...projected.map((p) => p.y));

  const centre = unproject({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, 0);

  // The usable frame, once the pins have their room.
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  /**
   * The largest zoom whose span still fits. `span * 2**zoom * TILE_SIZE` is
   * the width in pixels, so the zoom that exactly fills the frame is
   * `log2(usable / (span * TILE_SIZE))`, and flooring it keeps everything
   * inside rather than a fraction over the edge.
   */
  const zoomFor = (span: number, usable: number) =>
    span <= 0 ? maxZoom : Math.log2(usable / (span * TILE_SIZE));

  const zoom = Math.max(
    MIN_ZOOM,
    Math.min(maxZoom, Math.floor(Math.min(zoomFor(spanX, usableWidth), zoomFor(spanY, usableHeight))))
  );

  return { centre, zoom, placements: placePoints(points, centre, zoom, width, height) };
}

/**
 * Where each point sits in a viewport of `width` × `height` centred on
 * `centre` at `zoom`, in pixels from the top-left.
 *
 * Exported because a caller that already knows its centre and zoom — a map
 * following the bill preview's single-address convention, say — still needs
 * to place pins on it.
 */
export function placePoints(
  points: readonly LonLat[],
  centre: LonLat,
  zoom: number,
  width: number,
  height: number
): { x: number; y: number }[] {
  const origin = project(centre, zoom);

  return points.map((point) => {
    const projected = project(point, zoom);
    return {
      x: (projected.x - origin.x) * TILE_SIZE + width / 2,
      y: (projected.y - origin.y) * TILE_SIZE + height / 2,
    };
  });
}
