/**
 * Keeping map labels off each other (§4.14).
 *
 * Shops cluster — a supermarket, a chemist and a petrol station within a
 * block of each other is an ordinary week — so labels pinned at a fixed
 * offset land on top of one another and the map becomes a pile of text.
 *
 * This places each one in the first free slot above or below its pin, and
 * says so when there is no free slot at all. A dropped label is deliberate:
 * an unreadable overlap is worse than a pin whose amount is one tap away,
 * and the pin itself never moves, so nothing is ever drawn in the wrong
 * place.
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
  dy: number;
  /** True when every slot was taken and the label is not drawn. */
  hidden: boolean;
}

/** Clear air between two labels, so they read as separate. */
const GAP = 2;

/** How far from its pin a label may be pushed before it stops being its own. */
const MAX_STEPS = 4;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Places every label, heaviest first.
 *
 * `baseOffset` is where a label sits when nothing is in the way — below its
 * pin, clear of it. Each further step moves a whole label height, alternating
 * down then up, so a displaced label stays as near its pin as it can.
 */
export function layoutLabels(
  boxes: readonly LabelBox[],
  viewportHeight: number,
  baseOffset: number
): LabelPlacement[] {
  const placements: LabelPlacement[] = boxes.map(() => ({ dy: baseOffset, hidden: true }));
  const taken: Rect[] = [];

  const heaviestFirst = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => b.box.weight - a.box.weight);

  for (const { box, index } of heaviestFirst) {
    for (let step = 0; step <= MAX_STEPS; step += 1) {
      // Step 0 is the natural position; after that, below before above.
      const directions = step === 0 ? [0] : [1, -1];
      let placed = false;

      for (const direction of directions) {
        const dy = baseOffset + direction * step * (box.height + GAP);
        const rect: Rect = {
          left: box.x - box.width / 2,
          right: box.x + box.width / 2,
          top: box.y + dy,
          bottom: box.y + dy + box.height,
        };

        // Off the top or bottom of the map is not a slot.
        if (rect.top < 0 || rect.bottom > viewportHeight) continue;
        if (taken.some((other) => overlaps(rect, other))) continue;

        taken.push(rect);
        placements[index] = { dy, hidden: false };
        placed = true;
        break;
      }

      if (placed) break;
    }
  }

  return placements;
}
