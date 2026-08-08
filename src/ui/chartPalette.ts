/**
 * Categorical chart palette.
 *
 * Not chosen by eye. These are the first six slots of a validated categorical
 * theme, checked against this app's own card surfaces with the palette
 * validator rather than reasoned about:
 *
 *   light, surface #F3F4F6 → all checks pass
 *     worst adjacent CVD ΔE 9.1 (protan), normal-vision ΔE 19.6
 *     WARN: four slots sit below 3:1 contrast on the light surface
 *   dark, surface #1A1B1E → all checks pass, contrast ≥ 3:1
 *
 * That light-mode contrast warning is **not dismissable**: it obliges visible
 * labels, which is why every donut here ships a legend carrying the category
 * name, the amount and the share. Identity is never colour alone.
 *
 * Hues are assigned in fixed order and never cycled. A seventh category folds
 * into a single "everything else" slice rather than inventing a colour — see
 * `chartSlices.ts`.
 */

export const CHART_PALETTE = {
  light: ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300'],
  dark: ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300'],
} as const;

/**
 * Neutral for slices that are not a category: the "not itemised" remainder and
 * the folded "everything else". Deliberately outside the categorical order —
 * they are absences of identity, and colouring them like a category would
 * claim they are one.
 */
export const CHART_NEUTRAL = {
  light: '#8A8F98',
  dark: '#6B7280',
} as const;

export type ChartScheme = keyof typeof CHART_PALETTE;

export function paletteFor(scheme: ChartScheme): readonly string[] {
  return CHART_PALETTE[scheme];
}

export function neutralFor(scheme: ChartScheme): string {
  return CHART_NEUTRAL[scheme];
}
