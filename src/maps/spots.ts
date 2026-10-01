/**
 * One place, one pin (§4.14).
 *
 * `getMerchantLocations` groups bills by merchant, which is the right grouping
 * for a *list*: two branches of one chain are two shops and belong on separate
 * rows. On a **map** the grouping that matters is where you were standing, and
 * two things break the correspondence between the two.
 *
 * The first is OCR. A shop that prints its name slightly differently across
 * receipts — a comma, a branch suffix, a dropped letter — normalises to two
 * merchants (§4.8) and therefore two rows, even though it is one shop at one
 * address. On a list that is a visible duplicate the user can reconcile; on a
 * map it is two pins on the same spot, one hiding the other, each showing part
 * of the total.
 *
 * The second is genuine: two different shops really can share an address, in a
 * mall or a shopping centre. Merging those is not a compromise — a map answers
 * "what did I spend *here*", and the honest answer at one point is the sum of
 * everything spent at it.
 *
 * So spots merge on the resolved coordinate rather than on the name, which
 * handles both without having to tell them apart.
 */

import type { GeoPoint } from '@/maps/geocode';
import type { MerchantLocation } from '@/types/insights';
import { headlineCase } from '@/ui/headlineCase';

/**
 * How close two addresses must land to share a pin.
 *
 * Four decimal places of latitude is roughly eleven metres. Anything nearer
 * than that draws as overlapping circles whatever we do, so merging them loses
 * no information the map could have shown — and the same shop geocoded from
 * two spellings of its address usually lands within a few metres.
 */
const COINCIDENT_DP = 4;

export interface MappedSpot {
  /** Stable across renders: the rounded coordinate the spot merged on. */
  key: string;
  point: GeoPoint;
  /** Everything spent at this place in the period. */
  totalCents: number;
  billCount: number;
  /** The biggest spender here — what the pin is named and coloured by. */
  label: string;
  /** The dominant shop's grouping key, for the drill-down. */
  merchantNorm: string | null;
  /** Every distinct shop name recorded here, biggest first. */
  merchants: string[];
}

export interface LocatedMerchant {
  location: MerchantLocation;
  point: GeoPoint;
}

interface Building extends MappedSpot {
  parts: { name: string; cents: number; norm: string | null }[];
}

const UNNAMED = 'Unnamed shop';

/**
 * Merges located merchants into one entry per place, biggest spend first.
 *
 * The dominant shop — the one that took the most money here — supplies the
 * name, the colour and the drill-down, because that is the shop a person
 * means when they point at the pin.
 */
export function mergeSpots(entries: readonly LocatedMerchant[]): MappedSpot[] {
  const places = new Map<string, Building>();

  for (const { location, point } of entries) {
    const key = `${point.lat.toFixed(COINCIDENT_DP)},${point.lon.toFixed(COINCIDENT_DP)}`;
    // Cased here, where the places are named, rather than in the three
    // things that read a spot's name — the chip, the accessibility label and
    // the drill-down heading. Chain detection is case-insensitive, so
    // `shortMerchantName` is unaffected by being handed the cased form.
    const name = location.merchant ? headlineCase(location.merchant) : UNNAMED;
    const part = { name, cents: location.totalCents, norm: location.merchantNorm };

    const existing = places.get(key);
    if (existing) {
      existing.totalCents += location.totalCents;
      existing.billCount += location.billCount;
      existing.parts.push(part);
      continue;
    }

    places.set(key, {
      key,
      // The first point wins. They agree to within the rounding that merged
      // them, so any of them is as true as the others.
      point,
      totalCents: location.totalCents,
      billCount: location.billCount,
      label: name,
      merchantNorm: location.merchantNorm,
      merchants: [name],
      parts: [part],
    });
  }

  return [...places.values()]
    .map((place) => {
      const ranked = [...place.parts].sort((a, b) => b.cents - a.cents);
      const dominant = ranked[0];

      return {
        key: place.key,
        point: place.point,
        totalCents: place.totalCents,
        billCount: place.billCount,
        label: dominant.name,
        merchantNorm: dominant.norm,
        // Distinct, because one shop can contribute several name variants and
        // listing "New World" three times says nothing.
        merchants: [...new Set(ranked.map((part) => part.name))],
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}
