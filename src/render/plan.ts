/**
 * Answer envelope → what to draw (§6.7, §14.7).
 *
 * The model proposes a rendering; this decides whether it is honest enough to
 * show. §6.7 is a list of sanity rules rather than a layout spec, and the
 * reason is that the `render` block is model output: it can name eleven slices
 * for a donut, label one axis with three values and the other with four, or
 * ask for a `stat` from a series of twelve numbers. Drawing any of those
 * either crashes or, worse, shows a chart that is quietly wrong.
 *
 * So every rule here degrades rather than refuses: a bad donut becomes a bar,
 * a bad bar becomes text. §6.7's last clause is the one that matters — "a
 * malformed envelope renders `text` alone and logs `outcome='fallback'` —
 * never a crash." The sentence is always shown; only the picture is at risk.
 *
 * Pure, so the rules can be tested without a renderer, a device or a model.
 */

import type { RenderSpec } from '@/agent/envelope';
import type { SliceInput } from '@/ui/chartSlices';

/**
 * §6.7's donut limit, which is **not** `MAX_SLICES`.
 *
 * They answer different questions. This one decides whether a donut is the
 * right shape at all: past eight categories a ring is unreadable and a bar
 * chart is simply better. `chartSlices`' own `MAX_SLICES` (6) then decides how
 * many slices get their own colour before the tail is folded into "Everything
 * else" — the Insights screen's convention, applied by the component so the
 * same data drawn in two places does not fold differently.
 */
export const MAX_DONUT_SLICES = 8;

/** §6.7: "tables paginated beyond 50 rows". */
export const TABLE_PAGE_SIZE = 50;

export type RenderPlan =
  /** Show the sentence and nothing else. */
  | { kind: 'none' }
  | { kind: 'stat'; title?: string; label: string; valueCents: number | null; raw: number }
  | { kind: 'bars'; title?: string; axisLabel?: string; bars: PlottedValue[]; money: boolean }
  | { kind: 'line'; title?: string; axisLabel?: string; points: PlottedValue[]; money: boolean }
  | { kind: 'donut'; title?: string; entries: SliceInput[]; totalCents: number }
  | { kind: 'table'; title?: string; columns: string[]; rows: string[][]; totalRows: number };

export interface PlottedValue {
  label: string;
  /** The value as the model gave it — major units, per §14.7's example. */
  value: number;
  /** The same value in cents, for the app's money helpers. */
  cents: number;
}

export interface PlanContext {
  /** The ledger's currency (§6.3's catalog), for deciding what is money. */
  currency: string;
}

const NOTHING: RenderPlan = { kind: 'none' };

/**
 * §14.7's example is `{"label":"NZD","values":[64.2,43.1,71.5]}` — decimal
 * major units, and a series labelled with a currency code. So the label is
 * how the model says "these are amounts", and anything else is a count.
 *
 * Guessing instead would be worse in both directions: formatting bill counts
 * as dollars, or printing $64.20 as "64.2".
 */
function isMoneySeries(label: string | undefined, currency: string): boolean {
  if (!label) return false;
  const trimmed = label.trim().toUpperCase();
  return trimmed === currency.toUpperCase() || /^[A-Z]{3}$/.test(trimmed);
}

function toCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Labels for a series of `count` values.
 *
 * A chart with more values than labels is the common malformation, and it has
 * an honest repair: the axis is only a reading aid, so a missing label becomes
 * a position. A missing *value* has no such repair, which is why a short
 * series is rejected below rather than padded.
 */
function labelsFor(spec: RenderSpec, count: number): string[] {
  const given = spec.x?.values ?? [];
  return Array.from({ length: count }, (_, index) => given[index] ?? String(index + 1));
}

export function planRender(
  spec: RenderSpec | undefined,
  context: PlanContext
): RenderPlan {
  if (!spec || spec.type === 'none') return NOTHING;

  // A table reads its numbers from every series at once; the others plot one.
  if (spec.type === 'table') return planTable(spec);

  const series = spec.series?.[0];
  if (!series || series.values.length === 0) return NOTHING;

  const money = isMoneySeries(series.label, context.currency);
  const labels = labelsFor(spec, series.values.length);
  const points: PlottedValue[] = series.values.map((value, index) => ({
    label: labels[index],
    value,
    cents: toCents(value),
  }));

  /**
   * One value is a headline, whatever the model asked for.
   *
   * A one-bar bar chart and a one-slice donut are both charts of nothing: the
   * axis, the baseline and the legend all exist to support a comparison that
   * is not being made. So any form that comes down to a single number is a
   * stat tile, and §14.7's `stat` is simply the case where the model already
   * knew that.
   */
  if (points.length === 1) {
    return {
      kind: 'stat',
      title: spec.title,
      label: series.label ?? spec.x?.label ?? points[0].label,
      valueCents: money ? points[0].cents : null,
      raw: points[0].value,
    };
  }

  if (spec.type === 'stat') {
    // §14.7: "`stat` requires a single numeric value". More than one is not a
    // headline, and picking the first would assert a number the model never
    // meant to single out — so it is drawn as the series it actually is.
    return { kind: 'bars', title: spec.title, axisLabel: spec.x?.label, bars: points, money };
  }

  if (spec.type === 'donut') {
    // §6.7: "donut only with ≤ 8 slices, else bar". A ring of eleven wedges
    // is unreadable rather than wrong, and a bar chart shows the same data.
    if (points.length > MAX_DONUT_SLICES) {
      return { kind: 'bars', title: spec.title, axisLabel: spec.x?.label, bars: points, money };
    }
    // A share is a share *of* something; a donut of negatives has no whole.
    if (points.some((point) => point.value < 0)) {
      return { kind: 'bars', title: spec.title, axisLabel: spec.x?.label, bars: points, money };
    }
    return {
      kind: 'donut',
      title: spec.title,
      entries: points.map((point) => ({
        key: `${point.label}-${point.cents}`,
        label: point.label,
        valueCents: point.cents,
      })),
      totalCents: points.reduce((sum, point) => sum + point.cents, 0),
    };
  }

  // A single point was already turned into a stat above, so anything reaching
  // here has at least two and is a real trend.
  if (spec.type === 'line') {
    return { kind: 'line', title: spec.title, axisLabel: spec.x?.label, points, money };
  }

  return { kind: 'bars', title: spec.title, axisLabel: spec.x?.label, bars: points, money };
}

/**
 * A table needs its columns to agree on how many rows there are.
 *
 * Unlike a chart axis, there is no honest repair for a ragged table: a blank
 * cell claims an absence the data never stated, and dropping the short column
 * silently discards an answer. Text only.
 */
function planTable(spec: RenderSpec): RenderPlan {
  const rowLabels = spec.x?.values ?? [];
  const series = spec.series ?? [];
  if (rowLabels.length === 0 || series.length === 0) return NOTHING;
  if (series.some((column) => column.values.length !== rowLabels.length)) return NOTHING;

  const columns = [spec.x?.label ?? '', ...series.map((column, index) => column.label ?? `#${index + 1}`)];

  const rows = rowLabels.slice(0, TABLE_PAGE_SIZE).map((label, rowIndex) => [
    label,
    ...series.map((column) => formatCell(column.values[rowIndex])),
  ]);

  return { kind: 'table', title: spec.title, columns, rows, totalRows: rowLabels.length };
}

/**
 * Cells are formatted here rather than in the component, because a table can
 * mix money and counts across columns and the component would have to guess.
 * The device locale does the separators (§7).
 */
function formatCell(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
