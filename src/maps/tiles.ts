/**
 * Web Mercator tile arithmetic — enough to lay a slippy-map preview out of
 * plain images, with no map SDK and no API key.
 *
 * A raster map is a grid of 256px PNGs addressed by `{z}/{x}/{y}`. Given a
 * point and a viewport, this file works out which tiles cover it and where
 * each one sits. That is the whole of what a static preview needs: there is
 * no panning, no zooming and no gesture handling, so pulling in a native map
 * view (and, on Android, a Google Maps API key) would be paying for a
 * capability this screen does not use.
 *
 * Pure functions with no imports, so they run in the `node` test project.
 */

export const TILE_SIZE = 256;

/**
 * Street level. Low enough that the surrounding blocks give the address
 * context, high enough that the building is distinguishable.
 */
export const DEFAULT_ZOOM = 16;

/**
 * Web Mercator cannot represent the poles — the projection runs to infinity.
 * This is the conventional cut-off, chosen so the world is exactly square.
 */
const MAX_LATITUDE = 85.05112878;

export interface LonLat {
  lon: number;
  lat: number;
}

/** A tile, and where its top-left corner lands in the viewport. */
export interface TilePlacement {
  key: string;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Point → fractional tile coordinates at `zoom`. The integer part names the
 * tile; the fraction is how far into it the point sits.
 */
export function project({ lon, lat }: LonLat, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const latRad = (clamp(lat, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180;

  return {
    x: n * ((((lon + 180) % 360) + 360) % 360) / 360,
    y: (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2,
  };
}

/**
 * The inverse of `project` — fractional tile coordinates back to a point.
 *
 * Needed wherever a centre is *computed* rather than given. Fitting several
 * pins into one viewport (`fit.ts`) works out its centre in projected space,
 * because that is the space distances are uniform in, and `tileGrid` wants a
 * longitude and latitude back.
 */
export function unproject({ x, y }: { x: number; y: number }, zoom: number): LonLat {
  const n = 2 ** zoom;
  // The Mercator inverse: sinh undoes the log-tangent in `project`.
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));

  return {
    lon: (x / n) * 360 - 180,
    lat: (latRad * 180) / Math.PI,
  };
}

/**
 * The tiles covering a `width` × `height` viewport centred on `point`, each
 * with its offset from the viewport's top-left.
 *
 * Tiles that fall off the top or bottom of the world are dropped rather than
 * clamped — requesting them would 404, and at these zooms the gap can only
 * appear in the Arctic. Longitude wraps instead, because the map does.
 */
export function tileGrid(
  point: LonLat,
  width: number,
  height: number,
  zoom: number = DEFAULT_ZOOM
): TilePlacement[] {
  if (!(width > 0) || !(height > 0)) return [];

  const n = 2 ** zoom;
  const centre = project(point, zoom);

  // Viewport edges in whole-world pixels.
  const left = centre.x * TILE_SIZE - width / 2;
  const top = centre.y * TILE_SIZE - height / 2;

  const firstX = Math.floor(left / TILE_SIZE);
  const firstY = Math.floor(top / TILE_SIZE);
  const lastX = Math.floor((left + width - 1) / TILE_SIZE);
  const lastY = Math.floor((top + height - 1) / TILE_SIZE);

  const placements: TilePlacement[] = [];

  for (let ty = firstY; ty <= lastY; ty++) {
    if (ty < 0 || ty >= n) continue;

    for (let tx = firstX; tx <= lastX; tx++) {
      const wrapped = ((tx % n) + n) % n;

      placements.push({
        // `tx` rather than `wrapped`, so two copies of the same tile either
        // side of the antimeridian stay distinct keys.
        key: `${zoom}/${tx}/${ty}`,
        z: zoom,
        x: wrapped,
        y: ty,
        left: tx * TILE_SIZE - left,
        top: ty * TILE_SIZE - top,
      });
    }
  }

  return placements;
}

/** Fills `{z}` / `{x}` / `{y}` in a tile URL template. */
export function tileUrl(template: string, tile: Pick<TilePlacement, 'z' | 'x' | 'y'>): string {
  return template
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}
