/**
 * Fitting several shops into one map (§4.14).
 *
 * The property that matters is simple to state and easy to get subtly wrong:
 * every pin must land inside the frame, with room for the pin itself, at the
 * closest zoom where that is true. A fit that is one step too close crops a
 * shop off the edge silently — the map still looks right.
 *
 * Coordinates are real New Zealand ones, so the distances under test are the
 * distances this app actually sees: shops across a city, and shops across the
 * country.
 */

import { fitPoints, placePoints } from '@/maps/fit';
import { DEFAULT_ZOOM, type LonLat } from '@/maps/tiles';

const HAMILTON: LonLat = { lat: -37.787, lon: 175.279 };
const HAMILTON_NORTH: LonLat = { lat: -37.741, lon: 175.259 };
const AUCKLAND: LonLat = { lat: -36.848, lon: 174.763 };
const CHRISTCHURCH: LonLat = { lat: -43.531, lon: 172.637 };

const WIDTH = 340;
const HEIGHT = 200;
const PADDING = 34;

const fit = (points: LonLat[]) => fitPoints(points, WIDTH, HEIGHT);

describe('choosing the view', () => {
  it('has nothing to show for no points', () => {
    expect(fit([])).toBeNull();
  });

  it('refuses a viewport with no size', () => {
    expect(fitPoints([HAMILTON], 0, HEIGHT)).toBeNull();
  });

  /** Nothing to fit, so the answer is the closest useful view. */
  it('uses the closest zoom for a single shop', () => {
    const view = fit([HAMILTON]);
    expect(view?.zoom).toBe(DEFAULT_ZOOM);
    expect(view?.centre.lat).toBeCloseTo(HAMILTON.lat, 5);
  });

  it('zooms out further for shops further apart', () => {
    const city = fit([HAMILTON, HAMILTON_NORTH])!;
    const island = fit([AUCKLAND, HAMILTON])!;
    const country = fit([AUCKLAND, CHRISTCHURCH])!;

    expect(city.zoom).toBeGreaterThan(island.zoom);
    expect(island.zoom).toBeGreaterThan(country.zoom);
  });

  it('centres between the shops it is showing', () => {
    const view = fit([AUCKLAND, CHRISTCHURCH])!;
    expect(view.centre.lat).toBeLessThan(AUCKLAND.lat);
    expect(view.centre.lat).toBeGreaterThan(CHRISTCHURCH.lat);
  });
});

describe('every pin lands inside the frame', () => {
  it.each([
    ['two shops in one city', [HAMILTON, HAMILTON_NORTH]],
    ['two cities', [AUCKLAND, HAMILTON]],
    ['the length of the country', [AUCKLAND, CHRISTCHURCH]],
    ['a cluster and an outlier', [HAMILTON, HAMILTON_NORTH, CHRISTCHURCH]],
  ])('%s', (_name, points) => {
    const view = fit(points as LonLat[])!;

    for (const placement of view.placements) {
      // Inside the padded frame: a pin is drawn above its point, so a shop at
      // the very edge would be cropped without this room.
      expect(placement.x).toBeGreaterThanOrEqual(PADDING - 1);
      expect(placement.x).toBeLessThanOrEqual(WIDTH - PADDING + 1);
      expect(placement.y).toBeGreaterThanOrEqual(PADDING - 1);
      expect(placement.y).toBeLessThanOrEqual(HEIGHT - PADDING + 1);
    }
  });

  it('keeps the placements in the order the points were given', () => {
    const view = fit([AUCKLAND, CHRISTCHURCH])!;
    // Auckland is north, so it sits above Christchurch on screen.
    expect(view.placements[0].y).toBeLessThan(view.placements[1].y);
  });
});

describe('placing against a view that is already chosen', () => {
  it('puts the centre in the middle of the frame', () => {
    const [placement] = placePoints([HAMILTON], HAMILTON, DEFAULT_ZOOM, WIDTH, HEIGHT);
    expect(placement.x).toBeCloseTo(WIDTH / 2, 5);
    expect(placement.y).toBeCloseTo(HEIGHT / 2, 5);
  });

  it('puts a point north of centre above it, and east of centre right of it', () => {
    const [placement] = placePoints([HAMILTON_NORTH], HAMILTON, DEFAULT_ZOOM, WIDTH, HEIGHT);
    // North is a smaller y in screen terms; HAMILTON_NORTH is west, so left.
    expect(placement.y).toBeLessThan(HEIGHT / 2);
    expect(placement.x).toBeLessThan(WIDTH / 2);
  });
});
