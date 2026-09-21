/**
 * Arranging map labels so they can be read (§4.14).
 *
 * The case this exists for: shops cluster, so labels at a fixed offset land
 * on top of each other. What matters is that every label sits beside its pin
 * rather than under it, that no two drawn labels overlap, that the biggest
 * spend keeps the position a reader expects, and that a label with nowhere to
 * go is dropped rather than piled on another.
 */

import { layoutLabels, type LabelBox } from '@/maps/labels';

const VIEW = { width: 340, height: 200 };
/** Clear air between a pin's edge and its chip. */
const CLEAR = 4;
const HEIGHT = 14;
const RADIUS = 10;

const box = (x: number, y: number, weight: number, width = 80): LabelBox => ({
  x,
  y,
  radius: RADIUS,
  width,
  height: HEIGHT,
  weight,
});

/** Where a chip sits when nothing is in its way: level with the pin, to its right. */
const naturalDx = (one: LabelBox) => one.radius + CLEAR + one.width / 2;
const naturalDy = (one: LabelBox) => -one.height / 2;

/** The rectangle a placement actually occupies. */
const rectOf = (one: LabelBox, dx: number, dy: number) => ({
  left: one.x + dx - one.width / 2,
  right: one.x + dx + one.width / 2,
  top: one.y + dy,
  bottom: one.y + dy + one.height,
});

const collide = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

describe('a label beside its pin', () => {
  /** Never underneath: below a pin is the next shop along the street. */
  it('sits level with the pin and clear of its circle', () => {
    const one = box(120, 100, 10);
    const [placed] = layoutLabels([one], VIEW, CLEAR);

    expect(placed.hidden).toBe(false);
    expect(placed.dx).toBe(naturalDx(one));
    expect(placed.dy).toBe(naturalDy(one));
    // The chip's near edge starts outside the circle, not inside it.
    expect(rectOf(one, placed.dx, placed.dy).left).toBe(one.x + RADIUS + CLEAR);
  });

  /** A bigger pin pushes its own chip further out, or the circle covers it. */
  it('clears a bigger pin by more', () => {
    const small = { ...box(120, 100, 10), radius: 8 };
    const large = { ...box(120, 100, 10), radius: 20 };

    expect(layoutLabels([large], VIEW, CLEAR)[0].dx).toBeGreaterThan(
      layoutLabels([small], VIEW, CLEAR)[0].dx
    );
  });

  it('leaves well-separated labels where they belong', () => {
    const boxes = [box(120, 40, 10), box(120, 140, 5)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    placed.forEach((one, index) => {
      expect(one.hidden).toBe(false);
      expect(one.dx).toBe(naturalDx(boxes[index]));
      expect(one.dy).toBe(naturalDy(boxes[index]));
    });
  });

  /** Two pins on the same row do not compete unless their chips would touch. */
  it('ignores labels that share a row but sit far apart', () => {
    const boxes = [box(40, 30, 10, 60), box(220, 30, 5, 60)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    expect(placed.map((one) => one.dy)).toEqual([naturalDy(boxes[0]), naturalDy(boxes[1])]);
  });
});

describe('labels on top of each other', () => {
  /** The other side first — it is nearer than a row up or down. */
  it('sends the lighter one to the far side of its pin', () => {
    const boxes = [box(160, 100, 10), box(160, 104, 5)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    expect(placed[0].dx).toBeGreaterThan(0);
    expect(placed[1].dx).toBeLessThan(0);
    expect(placed.every((one) => !one.hidden)).toBe(true);
  });

  /** Both sides gone, so the third steps a row rather than going underneath. */
  it('steps a row once both sides are taken', () => {
    const boxes = [box(160, 100, 9), box(160, 103, 8), box(160, 106, 7)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    expect(placed[2].hidden).toBe(false);
    // Still beside the pin, not under it.
    expect(Math.abs(placed[2].dx)).toBeGreaterThanOrEqual(RADIUS + CLEAR);
    expect(placed[2].dy).not.toBe(naturalDy(boxes[2]));
  });

  /** The label a reader looks for should be where they look for it. */
  it('never moves the biggest spend', () => {
    const boxes = [box(160, 100, 1), box(160, 103, 99), box(160, 106, 50)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    expect(placed[1].dx).toBe(naturalDx(boxes[1]));
    expect(placed[1].dy).toBe(naturalDy(boxes[1]));
  });

  it('leaves no two drawn labels overlapping', () => {
    const boxes = [box(160, 100, 9), box(162, 103, 8), box(158, 106, 7), box(161, 110, 6)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    const drawn = boxes
      .map((one, index) => ({ one, at: placed[index] }))
      .filter((entry) => !entry.at.hidden)
      .map((entry) => rectOf(entry.one, entry.at.dx, entry.at.dy));

    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        expect(collide(drawn[i], drawn[j])).toBe(false);
      }
    }
  });

  /** Every drawn chip is beside its own pin, whatever the crowd did. */
  it('never places a label directly above or below its pin', () => {
    const boxes = Array.from({ length: 8 }, (_, index) => box(160, 100 + index * 3, 8 - index));
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    placed
      .filter((one) => !one.hidden)
      .forEach((one) => expect(Math.abs(one.dx)).toBeGreaterThanOrEqual(RADIUS + CLEAR));
  });
});

describe('when there is nowhere to go', () => {
  /** An unreadable pile is worse than an amount that is one tap away. */
  it('drops a label rather than stacking it', () => {
    const boxes = Array.from({ length: 40 }, (_, index) => box(160, 100, 40 - index));
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    expect(placed.some((one) => one.hidden)).toBe(true);
    // The heaviest still gets its place.
    expect(placed[0]).toEqual({
      dx: naturalDx(boxes[0]),
      dy: naturalDy(boxes[0]),
      hidden: false,
      form: 0,
    });
  });

  /**
   * Not hidden — moved to the other side. A pin near the right edge has no
   * room to its right and takes the left slot rather than losing its label.
   */
  it('puts a label on the near side when the far side runs off the map', () => {
    const one = box(VIEW.width - 20, 100, 10);
    const [placed] = layoutLabels([one], VIEW, CLEAR);

    expect(placed.hidden).toBe(false);
    expect(placed.dx).toBeLessThan(0);
    expect(rectOf(one, placed.dx, placed.dy).left).toBeGreaterThanOrEqual(0);
  });

  it('keeps every drawn label inside the viewport', () => {
    const boxes = [box(50, 40, 9, 70), box(54, 44, 8, 70), box(300, 40, 7, 70), box(296, 44, 6, 70)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    boxes.forEach((one, index) => {
      if (placed[index].hidden) return;
      const rect = rectOf(one, placed[index].dx, placed[index].dy);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(VIEW.width);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(VIEW.height);
    });
  });

  /** Rows are searched both ways, so a pin near an edge still finds one. */
  it('lifts a label that would fall off the bottom', () => {
    const boxes = [box(160, VIEW.height - 8, 10), box(160, VIEW.height - 6, 9)];
    const placed = layoutLabels(boxes, VIEW, CLEAR);

    placed.forEach((one, index) => {
      if (one.hidden) return;
      expect(rectOf(boxes[index], one.dx, one.dy).bottom).toBeLessThanOrEqual(VIEW.height);
    });
  });

  /** A chip wider than the map has nowhere to go on either side. */
  it('hides a label that cannot fit beside its pin at all', () => {
    expect(layoutLabels([box(170, 100, 10, 400)], VIEW, CLEAR)[0].hidden).toBe(true);
  });

  /** A map too short for a single row has no slot in either direction. */
  it('hides a label when the map has no room at all', () => {
    expect(layoutLabels([box(160, 5, 10)], { width: 340, height: 10 }, CLEAR)[0].hidden).toBe(true);
  });

  it('has nothing to arrange when there are no labels', () => {
    expect(layoutLabels([], VIEW, CLEAR)).toEqual([]);
  });
});

/**
 * The map used to run out of room for the same shops every time — the ones
 * with long names, which turned out to be the two biggest. A label that
 * cannot fit is offered narrower forms of itself, in order, before it is
 * given up on.
 *
 * The widths here stand for a shop's three forms: the full name and amount,
 * the name without its branch, and the amount alone.
 */
describe('shortening a label instead of dropping it', () => {
  /** One row of slots only, so a rejected label has nowhere else to go. */
  const TIGHT = { width: 340, height: 30 };
  const ROW_Y = 15;
  const FULL = 200;
  const SHORTER = 110;
  const AMOUNT = 40;

  /** Wide enough to be refused, with narrower forms behind it. */
  const crowded = (x: number, weight: number, alternatives?: number[]): LabelBox => ({
    x,
    y: ROW_Y,
    radius: RADIUS,
    width: FULL,
    alternatives,
    height: HEIGHT,
    weight,
  });

  /** A chip on the left, taking the room the wide label would have wanted. */
  const blocker = (): LabelBox => ({ ...box(100, ROW_Y, 10), width: 80 });

  /**
   * The middle form is tried before the last one, so a shop keeps its name
   * whenever a shorter name would have fitted.
   */
  it('drops the branch before it drops the name', () => {
    // Far enough right that the full form runs off the edge, near enough that
    // the shorter name still fits between the blocker and that edge.
    const boxes = [blocker(), crowded(216, 5, [SHORTER, AMOUNT])];
    const [first, second] = layoutLabels(boxes, TIGHT, CLEAR);

    expect(second.hidden).toBe(false);
    expect(second.form).toBe(1);
    // And the shop that had room kept its full label.
    expect(first.hidden).toBe(false);
    expect(first.form).toBe(0);
  });

  /** Only when the shorter name will not fit either does the name go. */
  it('falls back to the amount alone when no name fits', () => {
    // Further right again: now even the shorter name is squeezed out between
    // the blocker on one side and the map's edge on the other.
    const [, second] = layoutLabels([blocker(), crowded(300, 5, [SHORTER, AMOUNT])], TIGHT, CLEAR);

    expect(second.hidden).toBe(false);
    expect(second.form).toBe(2);
  });

  /** The same crowd, minus the fallbacks: this is what used to happen. */
  it('drops the label when there is no narrower form to fall back to', () => {
    const [, second] = layoutLabels([blocker(), crowded(250, 5)], TIGHT, CLEAR);

    expect(second.hidden).toBe(true);
  });

  /** Shortened or not, a chip belongs beside its own pin. */
  it('keeps a shortened label beside its pin', () => {
    const [, second] = layoutLabels([blocker(), crowded(216, 5, [SHORTER, AMOUNT])], TIGHT, CLEAR);

    expect(Math.abs(second.dx)).toBeGreaterThanOrEqual(RADIUS + CLEAR);
    // Closer in than the full form would have sat, because it is narrower.
    expect(Math.abs(second.dx)).toBe(RADIUS + CLEAR + SHORTER / 2);
  });

  /** A short form is a last resort, not a default. */
  it('never shortens a label that has room for its full self', () => {
    const roomy: LabelBox = { ...box(120, 100, 10), alternatives: [40, 30] };
    const [placed] = layoutLabels([roomy], VIEW, CLEAR);

    expect(placed.form).toBe(0);
    expect(placed.dx).toBe(naturalDx(roomy));
  });

  /** Narrower chips must not be allowed to creep under their neighbours. */
  it('leaves no two drawn labels overlapping, shortened or not', () => {
    const forms = [SHORTER, AMOUNT];
    const boxes = [
      blocker(),
      crowded(250, 9, forms),
      crowded(255, 8, forms),
      crowded(180, 7, forms),
      crowded(300, 6, forms),
    ];
    const placed = layoutLabels(boxes, TIGHT, CLEAR);

    const drawn = boxes
      .map((one, index) => ({ one, at: placed[index] }))
      .filter((entry) => !entry.at.hidden)
      .map((entry) =>
        rectOf(
          { ...entry.one, width: [entry.one.width, ...(entry.one.alternatives ?? [])][entry.at.form] },
          entry.at.dx,
          entry.at.dy
        )
      );

    for (let i = 0; i < drawn.length; i += 1) {
      for (let j = i + 1; j < drawn.length; j += 1) {
        expect(collide(drawn[i], drawn[j])).toBe(false);
      }
    }
  });
});
