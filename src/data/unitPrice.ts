/**
 * Comparable prices — what a thing costs per litre, per kilogram, or per one.
 *
 * A shelf price answers "what did I pay"; it does not answer "was that good
 * value", which is the question anyone comparing two milks is actually asking.
 * That needs a common denominator, and §4.4 stores three different kinds of
 * quantity, only one of which is directly usable.
 *
 * ## Where the size comes from, in order of trust
 *
 * 1. **The printed rate.** `unit_price_cents` exists only when the till itself
 *    weighed or measured the line (§4.9) — `BANANAS 0.670 Kg @ $3.65/Kg`. The
 *    shop computed it; nothing here can improve on that.
 * 2. **The stored quantity.** `qty` with a measured unit (kg, g, l, ml), or a
 *    count above one: `WL8号走地鸡蛋10个装` is `qty: 10, unit: 'pc'`, so eggs
 *    divide out with no guessing at all.
 * 3. **The name.** `Anchor Milk Blue Top Plastic Bottle 2L` is `qty: 1, unit:
 *    'pack'` — §4.9 is explicit that a size printed on packaging is *not* a
 *    measured quantity, and conflating the two was a real accuracy bug in the
 *    prototype, wrong on roughly 30% of packaged items. So the size is read
 *    from the name **only here**, for a derived figure that is labelled as
 *    such, and never written back into `qty` or `unit`.
 *
 * That last distinction is the whole reason `source` is part of the result. A
 * per-litre price derived from a product name is a reading of packaging text,
 * and anything showing it — a screen, or the agent quoting it — should be able
 * to say so rather than presenting it with the same confidence as a rate the
 * till printed.
 */

import type { Unit } from '@/types/vocabulary';

export type UnitBasis = 'litre' | 'kilogram' | 'item';

export interface UnitPrice {
  /** Cents per one of `basis`, to two decimals. */
  cents: number;
  basis: UnitBasis;
  /** How the size was established. See the file header. */
  source: 'printed' | 'quantity' | 'name';
}

export interface UnitPriceInput {
  name: string;
  nameLocal?: string | null;
  qty: number;
  unit: Unit;
  /** NULL means illegible (§4.3), and an illegible price has no rate. */
  priceCents: number | null;
  /** The rate the till printed, per `unit`. Only for weighed lines (§4.9). */
  unitPriceCents?: number | null;
}

/** A size read out of a product name, in its own units. */
export interface ParsedSize {
  magnitude: number;
  basis: UnitBasis;
}

const MEASURES: Record<string, { basis: UnitBasis; perCanonical: number }> = {
  // `perCanonical` converts the written unit into the basis unit.
  kg: { basis: 'kilogram', perCanonical: 1 },
  g: { basis: 'kilogram', perCanonical: 0.001 },
  l: { basis: 'litre', perCanonical: 1 },
  ml: { basis: 'litre', perCanonical: 0.001 },
  pc: { basis: 'item', perCanonical: 1 },
  // A pack is a count of one thing, not a measure of it. Left out on purpose:
  // "1 pack" says nothing about how much is in the pack, which is exactly what
  // the name has to supply.
};

const SIZE_PATTERN = new RegExp(
  [
    // 2L · 750ml · 250g · 1.5 kg · 500 grams · 208克 · 80克
    String.raw`(\d+(?:[.,]\d+)?)\s*(kg|kilograms?|kilos?|g|gm|grams?|克|公斤|l|lt|ltr|litres?|liters?|升|ml|mls|millilitres?|毫升)(?![a-z一-鿿])`,
    // 12 Pack · 3pk · 80PK · 10个装 · 6 pcs
    String.raw`(\d+)\s*(pk|pks|packs?|pce|pcs|ct|个装|个|片装|枚)(?![a-z一-鿿])`,
  ].join('|'),
  'gi'
);

const COUNT_WORDS = new Set([
  'pk',
  'pks',
  'pack',
  'packs',
  'pce',
  'pcs',
  'ct',
  '个装',
  '个',
  '片装',
  '枚',
]);

/**
 * The size a product name advertises, if it advertises one.
 *
 * The **last** match wins. Sizes conventionally close a product name — "Anchor
 * Milk Blue Top Plastic Bottle 2L" — while an earlier number is more often
 * part of the brand or variant ("No.1", "Top 10"). Taking the first would read
 * "12" out of "Whittaker's Mini Slab 12 Pack" correctly and "5" out of
 * "Trident 5 Spice Sauce 250ml" wrongly.
 */
export function parseSizeFromName(...names: (string | null | undefined)[]): ParsedSize | null {
  let found: ParsedSize | null = null;

  for (const name of names) {
    if (!name) continue;
    for (const match of name.matchAll(SIZE_PATTERN)) {
      const raw = match[1] ?? match[3];
      const unit = (match[2] ?? match[4]).toLowerCase();
      const magnitude = Number(raw.replace(',', '.'));
      if (!Number.isFinite(magnitude) || magnitude <= 0) continue;

      if (COUNT_WORDS.has(unit)) {
        found = { magnitude, basis: 'item' };
        continue;
      }

      const measure = MEASURES[normaliseMeasure(unit)];
      if (measure) {
        // Rounded because 208 × 0.001 is 0.20800000000000002 in binary
        // floating point, and that noise would otherwise ride all the way into
        // a displayed price per kilogram.
        found = {
          magnitude: Math.round(magnitude * measure.perCanonical * 1e6) / 1e6,
          basis: measure.basis,
        };
      }
    }
  }

  return found;
}

function normaliseMeasure(unit: string): string {
  if (/^(kg|kilogram|kilograms|kilo|kilos|公斤)$/.test(unit)) return 'kg';
  if (/^(g|gm|gram|grams|克)$/.test(unit)) return 'g';
  if (/^(l|lt|ltr|litre|litres|liter|liters|升)$/.test(unit)) return 'l';
  if (/^(ml|mls|millilitre|millilitres|毫升)$/.test(unit)) return 'ml';
  return unit;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function unitPriceOf(item: UnitPriceInput): UnitPrice | null {
  const measure = MEASURES[item.unit];

  // 1. The till's own rate, for the lines that have one.
  if (item.unitPriceCents != null && measure && measure.basis !== 'item') {
    // The rate is per the *stored* unit, so a price per gram becomes a price
    // per kilogram rather than a number a thousand times too small.
    return {
      cents: round(item.unitPriceCents / measure.perCanonical),
      basis: measure.basis,
      source: 'printed',
    };
  }

  if (item.priceCents == null || item.priceCents < 0) return null;

  // 2. The stored quantity, where it is a real measure or a real count.
  if (measure && item.qty > 0) {
    const wanted = measure.basis !== 'item' || item.qty > 1;
    if (wanted) {
      return {
        cents: round(item.priceCents / (item.qty * measure.perCanonical)),
        basis: measure.basis,
        source: 'quantity',
      };
    }
  }

  // 3. The name — packaging text, and labelled as such.
  const size = parseSizeFromName(item.name, item.nameLocal);
  if (size) {
    // `qty` multiplies the pack: two 200g packs are 400g of ham sausage.
    const total = size.magnitude * (item.qty > 0 ? item.qty : 1);
    if (total > 0) {
      return { cents: round(item.priceCents / total), basis: size.basis, source: 'name' };
    }
  }

  // 4. One of something, of unknown size. "Per item" is true, if uninformative.
  if (item.qty > 0) {
    return { cents: round(item.priceCents / item.qty), basis: 'item', source: 'quantity' };
  }

  return null;
}

const BASIS_LABELS: Record<UnitBasis, string> = {
  litre: 'per litre',
  kilogram: 'per kg',
  item: 'each',
};

export function unitBasisLabel(basis: UnitBasis): string {
  return BASIS_LABELS[basis];
}
