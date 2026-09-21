/**
 * Keeping map labels off each other (§4.14).
 *
 * Shops cluster — a supermarket, a chemist and a petrol station within a
 * block of each other is an ordinary week — so labels pinned at a fixed
 * offset land on top of one another and the map becomes a pile of text.
 *
 * Labels sit **beside** their pin — right of it if there is room, otherwise
 * left — never under it. A chip below a pin covers the map immediately south
 * of a shop, which on a street map is usually the next shop along; beside it,
 * the chip runs into the margin the map already has, and a reader's eye moves
 * from a pin to its name the way it moves along a line of text.
 *
 * When the natural side is taken the chip steps up or down in whole rows,
 * still on one side or the other.
 *
 * ## A label shortens before it disappears
 *
 * Two shops on top of each other take opposite sides, which is what makes a
 * cluster readable at all. Past that the map runs out of room, and it ran out
 * for the shops with the longest names rather than the smallest amounts —
 * "PAK'nSAVE Mill Street" is mostly branch, wants nearly the full width of
 * the map, and so failed in every slot however early it was placed. Both of
 * the shops the map was dropping were in fact the two largest.
 *
 * So a chip that cannot fit is offered narrower forms of itself, in turn,
 * before it is given up on — the caller decides what they say, this only
 * needs their widths. On the map that is the shop without its branch, then
 * the amount alone.
 *
 * Only when no form fits anywhere is a label dropped, and that remains
 * deliberate: an unreadable overlap is worse than an amount one tap away, and
 * the pin itself never moves, so nothing is ever drawn in the wrong place.
 *
 * Pure, so the arrangement is tested rather than eyeballed on a phone.
 */

export interface LabelBox {
  /** The pin's centre in viewport pixels. */
  x: number;
  y: number;
  /**
   * The pin's radius. A chip clears the circle, not its centre, and pins are
   * sized by spend — so the shop with the most money needs the most room.
   */
  radius: number;
  width: number;
  height: number;
  /**
   * Bigger wins. The largest spend keeps its natural position and the others
   * arrange themselves around it, because that is the label a reader looks
   * for where they expect it.
   */
  weight: number;
  /**
   * Narrower forms of the same label, widest first, each tried only once the
   * form before it has failed in every slot. What they say is the caller's
   * business; all this needs is how much room each one wants.
   */
  alternatives?: readonly number[];
}

export interface LabelPlacement {
  /**
   * Offset of the chip's centre from the pin's centre, in pixels. Its sign is
   * the side the chip was given: positive is right of the pin, negative left.
   */
  dx: number;
  /** Offset of the chip's **top** from the pin's centre. */
  dy: number;
  /** True when no form fitted anywhere and the label is not drawn. */
  hidden: boolean;
  /**
   * Which form was placed: 0 is the full label, then each alternative in the
   * order it was offered. The caller draws the text that matches.
   */
  form: number;
}

export interface LabelViewport {
  width: number;
  height: number;
}

/** Clear air between two labels, so they read as separate. */
const GAP = 2;

/**
 * How many rows up or down a label may be pushed before it stops being its own.
 *
 * Raised once the labels grew: bigger chips need more room, and three rows
 * left shops undrawn with space still free further out. A label five rows away
 * is a stretch, but a shop with no label at all is worse.
 */
const MAX_STEPS = 5;

/** A rectangle of the map, in viewport pixels. */
export interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const overlaps = (a: LabelRect, b: LabelRect): boolean =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Where a label may go, nearest first.
 *
 * Level with the pin and to its right, then to its left, then a row down or
 * up on either side — each ring further from the pin than the last, so a
 * displaced label stays as close to the pin it belongs to as the crowd
 * allows. Every slot is beside the pin: none is directly above or below it.
 *
 * Right before left at every ring, because that is the direction a label
 * reads, and a name to the right of its dot is the convention every printed
 * map already uses.
 */
function candidates(box: LabelBox, clearance: number): { dx: number; dy: number }[] {
  /** Far enough out that the chip's near edge clears the circle. */
  const out = box.radius + clearance + box.width / 2;
  /** `dy` is the chip's top, so level with the pin is half a chip up. */
  const middle = -box.height / 2;
  const stepY = box.height + GAP;

  const slots: { dx: number; dy: number }[] = [
    { dx: out, dy: middle },
    { dx: -out, dy: middle },
  ];

  for (let step = 1; step <= MAX_STEPS; step += 1) {
    const down = middle + step * stepY;
    const up = middle - step * stepY;

    slots.push(
      { dx: out, dy: down },
      { dx: -out, dy: down },
      { dx: out, dy: up },
      { dx: -out, dy: up }
    );
  }

  return slots;
}

/**
 * Places every label, heaviest first.
 *
 * `clearance` is the clear air between the edge of a pin and the near edge of
 * its chip.
 *
 * Nothing is reserved for the map's own furniture. A chip may end up under
 * the zoom buttons, and that is accepted rather than designed around: routing
 * every label around the controls cost shops their names, and the map pans,
 * so a label behind a button is a scroll away rather than lost.
 */
export function layoutLabels(
  boxes: readonly LabelBox[],
  viewport: LabelViewport,
  clearance: number
): LabelPlacement[] {
  const placements: LabelPlacement[] = boxes.map((box) => ({
    dx: box.radius + clearance + box.width / 2,
    dy: -box.height / 2,
    hidden: true,
    form: 0,
  }));
  const taken: LabelRect[] = [];

  const heaviestFirst = boxes
    .map((box, index) => ({ box, index }))
    .sort((a, b) => b.box.weight - a.box.weight);

  for (const { box, index } of heaviestFirst) {
    /**
     * Every form of this shop's label before moving on to the next shop,
     * rather than placing all the full labels first. A shop shortens because
     * of its own crowding, not because a shop elsewhere was greedy.
     */
    const forms = [box.width, ...(box.alternatives ?? [])];
    let settled = false;

    for (let form = 0; form < forms.length && !settled; form += 1) {
      // A narrower form sits closer to its pin as well as taking less room,
      // so the candidates are recomputed rather than reused.
      const sized = { ...box, width: forms[form] };

      for (const slot of candidates(sized, clearance)) {
        const rect: LabelRect = {
          left: sized.x + slot.dx - sized.width / 2,
          right: sized.x + slot.dx + sized.width / 2,
          top: sized.y + slot.dy,
          bottom: sized.y + slot.dy + sized.height,
        };

        // Off any edge of the map is not a slot.
        if (rect.top < 0 || rect.bottom > viewport.height) continue;
        if (rect.left < 0 || rect.right > viewport.width) continue;
        if (taken.some((other) => overlaps(rect, other))) continue;

        taken.push(rect);
        placements[index] = { dx: slot.dx, dy: slot.dy, hidden: false, form };
        settled = true;
        break;
      }
    }
  }

  return placements;
}
