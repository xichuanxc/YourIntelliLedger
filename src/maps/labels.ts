/**
 * Keeping map labels off each other (§4.14).
 *
 * Shops cluster — a supermarket, a chemist and a petrol station within a
 * block of each other is an ordinary week — so labels pinned at a fixed
 * offset land on top of one another and the map becomes a pile of text.
 *
 * This places each one in the nearest free slot — below or above its pin
 * first, then beside it, then diagonally — and says so when every slot is
 * taken. A dropped label is deliberate: an unreadable overlap is worse than
 * a pin whose amount is one tap away, and the pin itself never moves, so
 * nothing is ever drawn in the wrong place.
 *
 * Pure, so the arrangement is tested rather than eyeballed on a phone.
 */

export interface LabelBox {
  /** The pin's centre in viewport pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Bigger wins. The largest spend keeps its natural position and the others
   * arrange themselves around it, because that is the label a reader looks
   * for where they expect it.
   */
  weight: number;
}

export interface LabelPlacement {
  /** Offset from the pin's centre, in pixels. */
  dx: number;
  dy: number;
  /** True when every slot was taken and the label is not drawn. */
  hidden: boolean;
}

export interface LabelViewport {
  width: number;
  height: number;
}

/** Clear air between two labels, so they read as separate. */
const GAP = 2;

/** How far from its pin a label may be pushed before it stops being its own. */
const MAX_STEPS = 3;

/**
 * Sideways steps are a fraction of the label's width rather than all of it:
 * two labels only need to clear each other, and a whole width throws a label
 * so far from its pin that it looks like somebody else's.
 */
const SIDEWAYS_SHARE = 0.55;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Where a label may go, nearest first.
 *
 * Directly under the pin, then straight up or down, then beside, then
 * diagonally — each ring further away than the last, so a displaced label
 * stays as close to the pin it belongs to as the crowd allows.
 */
function candidates(box: LabelBox, baseOffset: number): { dx: number; dy: number }[] {
  const stepY = box.height + GAP;
  const stepX = box.width * SIDEWAYS_SHARE + GAP;
  const slots: { dx: number; dy: number }[] = [{ dx: 0, dy: baseOffset }];

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const down = baseOffset + step * stepY;
    const up = baseOffset - step * stepY;
    const right = step * stepX;
    const left = -step * stepX;

    slots.push({ dx: 0, dy: down }, { dx: 0, dy: up });
    slots.push({ dx: right, dy: baseOffset }, { dx: left, dy: baseOffset });
    slots.push(
      { dx: right, dy: down },
      { dx: left, dy: down },
      { dx: right, dy: up },
      { dx: left, dy: up }
    );
  }

  return slots;
}

/**
 * Places every label, heaviest first.
 *
 * `baseOffset` is where a label sits when nothing is in the way — below its
 * pin, clear of it.
 */
export function layoutLabels(
  boxes: readonly LabelBox[],
  viewport: LabelViewport,
  baseOffset: number
): LabelPlacement[] {
  const placements: LabelPlacement[] = boxes.map(() => ({ dx: 0, dy: baseOffset, hidden: true }));
  const taken: Rect[] = [];

  const heaviestFirst = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => b.box.weight - a.box.weight);

  for (const { box, index } of heaviestFirst) {
    for (const slot of candidates(box, baseOffset)) {
      const rect: Rect = {
        left: box.x + slot.dx - box.width / 2,
        right: box.x + slot.dx + box.width / 2,
        top: box.y + slot.dy,
        bottom: box.y + slot.dy + box.height,
      };

      // Off any edge of the map is not a slot.
      if (rect.top < 0 || rect.bottom > viewport.height) continue;
      if (rect.left < 0 || rect.right > viewport.width) continue;
      if (taken.some((other) => overlaps(rect, other))) continue;

      taken.push(rect);
      placements[index] = { dx: slot.dx, dy: slot.dy, hidden: false };
      break;
    }
  }

  return placements;
}
