/**
 * How far apart two colours look, so the question can be computed.
 *
 * Needed because two palettes now meet in one chart. A chain draws in its own
 * brand colour — PAK'nSAVE yellow, New World red, Woolworths green — and
 * every other shop takes the next hue from the validated categorical palette.
 * Those two sets were chosen independently, and they collide: the palette's
 * amber `#EDA100` beside PAK'nSAVE's `#F2C200` is two slices nobody can tell
 * apart, which is exactly the failure a legend cannot rescue, because the
 * swatch is the only thing linking a wedge to its row.
 *
 * Judging that by eye is how it goes wrong quietly, so it is measured: sRGB
 * to OKLab, then the Euclidean distance between the two, scaled by 100 to
 * match how the figure is usually quoted. OKLab rather than raw RGB because
 * RGB distance says green and blue are far apart while two yellows are not —
 * the opposite of what an eye reports.
 */

/** Undoes the sRGB transfer function, so the channels are linear light. */
function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

interface Oklab {
  l: number;
  a: number;
  b: number;
}

/** `#RRGGBB` only: every colour in this app is written that way. */
function toOklab(hex: string): Oklab {
  const value = hex.replace('#', '');
  const r = toLinear(parseInt(value.slice(0, 2), 16) / 255);
  const g = toLinear(parseInt(value.slice(2, 4), 16) / 255);
  const b = toLinear(parseInt(value.slice(4, 6), 16) / 255);

  // The LMS cone responses, then their cube roots — Björn Ottosson's OKLab.
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  return {
    l: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  };
}

/**
 * The perceptual distance between two colours, OKLab ×100.
 *
 * Around 15 is the floor below which a reader with ordinary colour vision
 * stops being able to separate two swatches reliably; below about 8 they are
 * the same colour for anyone.
 */
export function colourDistance(one: string, other: string): number {
  const a = toOklab(one);
  const b = toOklab(other);
  return Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) * 100;
}
