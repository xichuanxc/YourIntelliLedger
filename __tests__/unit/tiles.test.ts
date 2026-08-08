import { DEFAULT_ZOOM, project, TILE_SIZE, tileGrid, tileUrl } from '@/maps/tiles';

/** New World Rototuna, from the corpus — a real address the preview renders. */
const HAMILTON = { lat: -37.7395, lon: 175.2825 };

describe('project', () => {
  it('puts the origin at the centre of the world', () => {
    // At zoom 0 the whole world is one tile, so (0,0) is its middle.
    expect(project({ lat: 0, lon: 0 }, 0)).toEqual({ x: 0.5, y: 0.5 });
  });

  /**
   * ±180 is one meridian, so the projection normalises it to one x — the west
   * edge. The east edge is a limit approached, never reached. `tileGrid` wraps
   * x anyway, so both give the same tiles.
   */
  it('normalises the antimeridian to a single position', () => {
    expect(project({ lat: 0, lon: -180 }, 1).x).toBeCloseTo(0, 10);
    expect(project({ lat: 0, lon: 180 }, 1).x).toBeCloseTo(0, 10);
    expect(project({ lat: 0, lon: 179.999 }, 1).x).toBeCloseTo(2, 4);
  });

  it('puts the northern hemisphere in the top half', () => {
    // y grows downwards in tile space, which is the opposite of latitude.
    expect(project({ lat: 45, lon: 0 }, 4).y).toBeLessThan(8);
    expect(project({ lat: -45, lon: 0 }, 4).y).toBeGreaterThan(8);
  });

  it('scales by a factor of two per zoom level', () => {
    const low = project(HAMILTON, 10);
    const high = project(HAMILTON, 11);
    expect(high.x).toBeCloseTo(low.x * 2, 8);
    expect(high.y).toBeCloseTo(low.y * 2, 8);
  });

  /**
   * Mercator runs to infinity at the poles. Without the clamp the tangent
   * blows up and every downstream number becomes NaN, which shows up as a
   * blank preview with no error anywhere.
   */
  it('clamps latitude to the Mercator limit instead of returning infinity', () => {
    for (const lat of [90, -90, 89.9]) {
      const { y } = project({ lat, lon: 0 }, 4);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('wraps longitude past the antimeridian rather than running off the world', () => {
    expect(project({ lat: 0, lon: 190 }, 1).x).toBeCloseTo(project({ lat: 0, lon: -170 }, 1).x, 10);
  });
});

describe('tileGrid', () => {
  /**
   * The pin is drawn at a fixed position — the middle of the frame — so the
   * grid is what has to put the address there. If this drifts, every preview
   * is subtly wrong in a way no other test would catch.
   */
  it('centres the requested point in the viewport', () => {
    const width = 360;
    const height = 132;
    const tiles = tileGrid(HAMILTON, width, height);
    const centre = project(HAMILTON, DEFAULT_ZOOM);

    // The tile the address falls inside, and how far into it.
    const tile = tiles.find((t) => t.key === `${DEFAULT_ZOOM}/${Math.floor(centre.x)}/${Math.floor(centre.y)}`);
    expect(tile).toBeDefined();

    const screenX = tile!.left + (centre.x - Math.floor(centre.x)) * TILE_SIZE;
    const screenY = tile!.top + (centre.y - Math.floor(centre.y)) * TILE_SIZE;

    expect(screenX).toBeCloseTo(width / 2, 6);
    expect(screenY).toBeCloseTo(height / 2, 6);
  });

  it('covers the whole viewport with no gaps', () => {
    const width = 400;
    const height = 132;
    const tiles = tileGrid(HAMILTON, width, height);

    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.min(...tiles.map((t) => t.left))).toBeLessThanOrEqual(0);
    expect(Math.min(...tiles.map((t) => t.top))).toBeLessThanOrEqual(0);
    expect(Math.max(...tiles.map((t) => t.left + TILE_SIZE))).toBeGreaterThanOrEqual(width);
    expect(Math.max(...tiles.map((t) => t.top + TILE_SIZE))).toBeGreaterThanOrEqual(height);
  });

  it('fetches no more tiles than it needs', () => {
    // A 400×132 viewport spans at most three tile columns and two rows.
    expect(tileGrid(HAMILTON, 400, 132).length).toBeLessThanOrEqual(6);
  });

  it('gives every tile a distinct key', () => {
    const tiles = tileGrid(HAMILTON, 400, 300);
    expect(new Set(tiles.map((t) => t.key)).size).toBe(tiles.length);
  });

  it('spaces tiles exactly one tile apart', () => {
    const tiles = tileGrid(HAMILTON, 400, 132);
    const lefts = [...new Set(tiles.map((t) => t.left))].sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i++) {
      expect(lefts[i] - lefts[i - 1]).toBeCloseTo(TILE_SIZE, 6);
    }
  });

  it('wraps x across the antimeridian instead of asking for a tile that does not exist', () => {
    const n = 2 ** DEFAULT_ZOOM;
    const tiles = tileGrid({ lat: 0, lon: 179.999 }, 400, 132);

    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.x >= 0 && t.x < n)).toBe(true);
  });

  it('drops rows off the top of the world rather than requesting a 404', () => {
    const tiles = tileGrid({ lat: 85.05, lon: 0 }, 400, 400);
    const n = 2 ** DEFAULT_ZOOM;
    expect(tiles.every((t) => t.y >= 0 && t.y < n)).toBe(true);
  });

  it('returns nothing before the parent has measured a width', () => {
    expect(tileGrid(HAMILTON, 0, 132)).toEqual([]);
    expect(tileGrid(HAMILTON, 400, 0)).toEqual([]);
  });
});

describe('tileUrl', () => {
  it('substitutes z, x and y', () => {
    expect(tileUrl('https://tiles/{z}/{x}/{y}.png', { z: 16, x: 3, y: 4 })).toBe(
      'https://tiles/16/3/4.png'
    );
  });
});
