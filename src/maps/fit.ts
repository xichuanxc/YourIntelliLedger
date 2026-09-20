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
 * The centre after dragging the map by `dx`, `dy` screen pixels.
 *
 * The sign is the part worth stating: dragging the map to the *right* shows
 * what was off the left edge, so the centre moves **west**, not east. Getting
 * it backwards produces a map that fights the finger, which is obvious in the
 * hand and invisible in the code — hence a test.
 *
 * Distance per pixel depends on zoom, which is why the pan is applied in
 * projected space at the zoom being displayed rather than stored as an offset
 * and reinterpreted later.
 */
export function panCentre(centre: LonLat, zoom: number, dx: number, dy: number): LonLat {
  const origin = project(centre, zoom);
  return unproject({ x: origin.x - dx / TILE_SIZE, y: origin.y - dy / TILE_SIZE }, zoom);
}

/** How far apart two fingers are, in screen pixels. */
export function touchDistance(
  a: { pageX: number; pageY: number },
  b: { pageX: number; pageY: number }
): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/**
 * Whole zoom steps a pinch represents.
 *
 * A zoom level doubles the scale, so the natural mapping is the base-2
 * logarithm of how much the fingers spread: twice as far apart is one level
 * in. Rounded, because this map zooms in whole steps — a continuous scale
 * would mean re-fetching tiles for every frame of the gesture and blurring
 * them in between.
 */
export function zoomStepsFor(from: number, to: number): number {
  if (!(from > 0) || !(to > 0)) return 0;

  const steps = Math.round(Math.log2(to / from));
  // `Math.round` of a small negative is -0, and -0 is not 0 under `Object.is`
  // — which is what `toBe` and a good many equality checks use. Handing one
  // out of a public function is a trap for whoever compares against it next.
  return steps === 0 ? 0 : steps;
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
