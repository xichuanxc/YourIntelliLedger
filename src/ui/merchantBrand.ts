/**
 * Which shop a pin belongs to, as a colour (§4.14).
 *
 * A map of six supermarkets is much easier to read when the colours are the
 * ones on the signs: a New Zealand shopper knows the yellow one is PAK'nSAVE
 * without consulting a legend. So brand beats palette here, and this is the
 * one place in the app where a colour is chosen by what a company looks like
 * rather than by a design token.
 *
 * ## Only brands worth being sure about
 *
 * A wrong brand colour is worse than no brand colour — it asserts something
 * false about a shop the user knows by sight. So the table holds chains whose
 * colours are unambiguous, and everything else takes one neutral slate. That
 * neutral is not a failure state: most ledgers have a dairy, a butcher and a
 * petrol station in them, and they are simply "not one of the big chains".
 *
 * ## The accessibility limit, stated rather than hidden
 *
 * Red and green are the classic colour-vision confusion, and New World and
 * Woolworths are red and green. Colour therefore never carries identity on its
 * own here: every pin names its shop and its total in an accessibility label,
 * and a tap opens that merchant's bills.
 *
 * Matching is on `merchant_norm` (§4.8) — lowercased with punctuation removed
 * — so "PAK'nSAVE Mill Street" and "Pak N Save Hamilton" land together.
 */

export type MerchantBrand = 'paknsave' | 'new-world' | 'woolworths' | 'other';

/**
 * Brand hexes, chosen to stay legible on a light street map. They are the
 * shop's colour, not a theme token, so they do not change between light and
 * dark — the map tiles underneath are the same picture either way.
 */
export const BRAND_COLOURS: Record<MerchantBrand, string> = {
  paknsave: '#F2C200',
  'new-world': '#D6001C',
  woolworths: '#0E8C42',
  /** Everything that is not one of the big chains. */
  other: '#5B6B7A',
};

/**
 * Ordered, because a normalised name can contain more than one of these —
 * "new world metro countdown road" is not a real shop, but a receipt that
 * printed a street name into the merchant field could be.
 */
const PATTERNS: readonly (readonly [MerchantBrand, RegExp])[] = [
  ['paknsave', /pak\s*n?\s*save/],
  ['new-world', /new\s*world/],
  // Countdown is Woolworths mid-rebrand, and old receipts still say Countdown.
  // Both are the same shop, and colouring them differently would split one
  // chain across two colours on the same map.
  ['woolworths', /woolworths|countdown/],
];

/**
 * The brand behind a merchant name, or `other`.
 *
 * Takes the normalised name where there is one and normalises the printed
 * name otherwise, so a bill recorded before normalisation still matches.
 */
export function brandOf(merchantNorm: string | null, printed?: string | null): MerchantBrand {
  const name = (merchantNorm ?? printed ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  if (name.trim() === '') return 'other';

  for (const [brand, pattern] of PATTERNS) {
    if (pattern.test(name)) return brand;
  }

  return 'other';
}

/** The colour to draw a shop's pin in. */
export function brandColour(merchantNorm: string | null, printed?: string | null): string {
  return BRAND_COLOURS[brandOf(merchantNorm, printed)];
}
