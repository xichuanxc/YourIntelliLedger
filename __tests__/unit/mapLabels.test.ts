/**
 * Arranging map labels so they can be read (§4.14).
 *
 * The case this exists for: shops cluster, so labels at a fixed offset land
 * on top of each other. What matters is that no two drawn labels overlap,
 * that the biggest spend keeps the position a reader expects, and that a
 * label with nowhere to go is dropped rather than piled on another.
 */

import { layoutLabels, type LabelBox } from '@/maps/labels';

const HEIGHT = 200;
const BASE = 12;

const box = (x: number, y: number, weight: number, width = 80): LabelBox => ({
  x,
  y,
  width,
  height: 14,
  weight,
});

/** The rectangle a placement actually occupies. */
const rectOf = (one: LabelBox, dy: number) => ({
  left: one.x - one.width / 2,
  right: one.x + one.width / 2,
  top: one.y + dy,
  bottom: one.y + dy + one.height,
});

const collide = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('labels that do not compete', () => {
  it('leaves well-separated labels where they belong', () => {
    const boxes = [box(50, 20, 10), box(50, 120, 5)];
    const placed = layoutLabels(boxes, HEIGHT, BASE);

    expect(placed.every((one) => one.dy === BASE)).toBe(true);
    expect(placed.every((one) => one.hidden)).toBe(false);
  });

  /** Side by side is not a collision, however close the pins are vertically. */
  it('ignores labels that share a row but not a column', () => {
    const placed = layoutLabels([box(40, 30, 10, 60), box(200, 30, 5, 60)], HEIGHT, BASE);
    expect(placed.map((one) => one.dy)).toEqual([BASE, BASE]);
  });
});

describe('labels on top of each other', () => {
  it('moves the lighter one out of the way', () => {
    const boxes = [box(50, 30, 10), box(50, 34, 5)];
    const placed = layoutLabels(boxes, HEIGHT, BASE);

    expect(placed[0].dy).toBe(BASE);
    expect(placed[1].dy).not.toBe(BASE);
    expect(placed.every((one) => !one.hidden)).toBe(true);
  });

  /** The label a reader looks for should be where they look for it. */
  it('never moves the biggest spend', () => {
    const boxes = [box(50, 30, 1), box(50, 33, 99), box(50, 36, 50)];
    const placed = layoutLabels(boxes, HEIGHT, BASE);

    expect(placed[1].dy).toBe(BASE);
  });

  it('leaves no two drawn labels overlapping', () => {
    const boxes = [box(50, 30, 9), box(52, 33, 8), box(48, 36, 7), box(51, 40, 6)];
    const placed = layoutLabels(boxes, HEIGHT, BASE);

    const drawn = boxes
      .map((one, index) => ({ one, at: placed[index] }))
      .filter((entry) => !entry.at.hidden)
      .map((entry) => rectOf(entry.one, entry.at.dy));

    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        expect(collide(drawn[i], drawn[j])).toBe(false);
      }
    }
  });
});

describe('when there is nowhere to go', () => {
  /** An unreadable pile is worse than an amount that is one tap away. */
  it('drops a label rather than stacking it', () => {
    // Ten pins at the same point: only a few slots exist above and below.
    const boxes = Array.from({ length: 10 }, (_, index) => box(50, 100, 10 - index));
    const placed = layoutLabels(boxes, HEIGHT, BASE);

    expect(placed.some((one) => one.hidden)).toBe(true);
    // The heaviest still gets its place.
    expect(placed[0]).toEqual({ dy: BASE, hidden: false });
  });

  /**
   * Not hidden — moved. Both directions are searched, so a pin near an edge
   * takes a slot on the other side of itself rather than losing its label.
   */
  it('lifts a label that would fall off the bottom', () => {
    const placed = layoutLabels([box(50, HEIGHT - 4, 10)], HEIGHT, BASE);

    expect(placed[0].hidden).toBe(false);
    expect(placed[0].dy).toBeLessThan(BASE);
    expect(HEIGHT - 4 + placed[0].dy + 14).toBeLessThanOrEqual(HEIGHT);
  });

  it('pushes down a label that would sit above the top', () => {
    const placed = layoutLabels([box(50, 2, 10)], HEIGHT, -40);

    expect(placed[0].hidden).toBe(false);
    expect(2 + placed[0].dy).toBeGreaterThanOrEqual(0);
  });

  /** A map too short for a single label has no slot in either direction. */
  it('hides a label when the map has no room at all', () => {
    expect(layoutLabels([box(50, 5, 10)], 10, BASE)[0].hidden).toBe(true);
  });

  it('has nothing to arrange when there are no labels', () => {
    expect(layoutLabels([], HEIGHT, BASE)).toEqual([]);
  });
});
