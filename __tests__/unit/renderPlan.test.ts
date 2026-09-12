/**
 * §6.7's renderer rules.
 *
 * The `render` block is model output, so every case here is the model
 * proposing something that cannot honestly be drawn: eleven slices in a ring,
 * one axis shorter than the other, a headline asked of twelve numbers. The
 * rule throughout is that the picture degrades and the sentence survives —
 * §6.7's "never a crash" is about the answer, not just the process.
 */

import { MAX_DONUT_SLICES, TABLE_PAGE_SIZE, planRender } from '@/render/plan';

const context = { currency: 'NZD' };

const money = (values: number[]) => [{ label: 'NZD', values }];

describe('nothing to draw', () => {
  it.each([
    ['no render block', undefined],
    ['an explicit none', { type: 'none' as const }],
    ['a chart with no series', { type: 'bar' as const }],
    ['a series with no values', { type: 'bar' as const, series: [{ values: [] }] }],
  ])('shows the sentence alone for %s', (_label, spec) => {
    expect(planRender(spec, context)).toEqual({ kind: 'none' });
  });
});

describe('a headline number', () => {
  it('formats one value as money when the series says so', () => {
    expect(
      planRender({ type: 'stat', title: 'June', series: money([214.3]) }, context)
    ).toMatchObject({ kind: 'stat', valueCents: 21430, raw: 214.3 });
  });

  /** §14.7's values are decimal major units, so 214.3 is $214.30 — not 214 cents. */
  it('reads the value as dollars, not cents', () => {
    const plan = planRender({ type: 'stat', series: money([12]) }, context);
    expect(plan).toMatchObject({ valueCents: 1200 });
  });

  it('leaves a count unformatted, because it is not an amount', () => {
    expect(
      planRender({ type: 'stat', series: [{ label: 'Bills', values: [7] }] }, context)
    ).toMatchObject({ kind: 'stat', valueCents: null, raw: 7 });
  });

  /**
   * §14.7: "`stat` requires a single numeric value". Picking the first of
   * twelve would assert a number the model never meant to single out.
   */
  it('draws a series asked of as a stat as the series it actually is', () => {
    expect(
      planRender({ type: 'stat', series: money([1, 2, 3]) }, context)
    ).toMatchObject({ kind: 'bars' });
  });
});

describe('a donut', () => {
  it('is drawn when the slices are few enough', () => {
    const plan = planRender(
      {
        type: 'donut',
        x: { values: ['Produce', 'Dairy', 'Meat'] },
        series: money([64.2, 43.1, 71.5]),
      },
      context
    );
    expect(plan).toMatchObject({ kind: 'donut', totalCents: 17880 });
  });

  /** §6.7: "donut only with ≤ 8 slices, else bar". */
  it('becomes a bar chart past the slice limit', () => {
    const many = Array.from({ length: MAX_DONUT_SLICES + 1 }, (_, i) => i + 1);
    expect(planRender({ type: 'donut', series: money(many) }, context)).toMatchObject({
      kind: 'bars',
    });
  });

  it('is still a donut exactly at the limit', () => {
    const exact = Array.from({ length: MAX_DONUT_SLICES }, (_, i) => i + 1);
    expect(planRender({ type: 'donut', series: money(exact) }, context)).toMatchObject({
      kind: 'donut',
    });
  });

  /** A share is a share *of* something, and a negative has no place in a whole. */
  it('becomes a bar chart when a value is negative', () => {
    expect(planRender({ type: 'donut', series: money([10, -4]) }, context)).toMatchObject({
      kind: 'bars',
    });
  });
});

describe('a line', () => {
  it('is drawn for a trend', () => {
    expect(
      planRender({ type: 'line', series: money([1, 2, 3]) }, context)
    ).toMatchObject({ kind: 'line' });
  });

  /**
   * Not a bar either. A one-bar chart is a chart of nothing — the axis, the
   * baseline and the legend all support a comparison nobody is making — so a
   * lone value is a headline whatever form was asked for.
   */
  it('becomes a headline for a single point', () => {
    expect(planRender({ type: 'line', series: money([5]) }, context)).toMatchObject({
      kind: 'stat',
    });
  });
});

describe('axis labels the model got wrong', () => {
  /**
   * More values than labels is the common malformation and it has an honest
   * repair: an axis is a reading aid, so a missing label becomes a position.
   */
  it('fills in a position when a label is missing', () => {
    const plan = planRender(
      { type: 'bar', x: { values: ['Jun'] }, series: money([1, 2]) },
      context
    );
    expect(plan).toMatchObject({ kind: 'bars' });
    if (plan.kind !== 'bars') throw new Error('expected bars');
    expect(plan.bars.map((bar) => bar.label)).toEqual(['Jun', '2']);
  });

  it('ignores labels beyond the values, rather than inventing bars', () => {
    const plan = planRender(
      { type: 'bar', x: { values: ['Jun', 'Jul', 'Aug'] }, series: money([1, 2]) },
      context
    );
    if (plan.kind !== 'bars') throw new Error('expected bars');
    expect(plan.bars).toHaveLength(2);
    expect(plan.bars.map((bar) => bar.label)).toEqual(['Jun', 'Jul']);
  });
});

describe('a table', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => `row ${i + 1}`);

  it('lays out labelled columns', () => {
    const plan = planRender(
      {
        type: 'table',
        x: { label: 'Category', values: ['Produce', 'Dairy'] },
        series: [
          { label: 'NZD', values: [64.2, 43.1] },
          { label: 'Items', values: [3, 5] },
        ],
      },
      context
    );
    expect(plan).toMatchObject({
      kind: 'table',
      columns: ['Category', 'NZD', 'Items'],
      totalRows: 2,
    });
    if (plan.kind !== 'table') throw new Error('expected table');
    expect(plan.rows[0]).toEqual(['Produce', '64.20', '3']);
  });

  /** §6.7: "tables paginated beyond 50 rows". */
  it('shows one page and reports the true size', () => {
    const plan = planRender(
      {
        type: 'table',
        x: { values: rows(TABLE_PAGE_SIZE + 10) },
        series: [{ label: 'Items', values: rows(TABLE_PAGE_SIZE + 10).map((_, i) => i) }],
      },
      context
    );
    if (plan.kind !== 'table') throw new Error('expected table');
    expect(plan.rows).toHaveLength(TABLE_PAGE_SIZE);
    expect(plan.totalRows).toBe(TABLE_PAGE_SIZE + 10);
  });

  /**
   * No honest repair exists for a ragged table: a blank cell claims an absence
   * the data never stated, and dropping the short column discards an answer.
   */
  it('falls back to text when a column is the wrong length', () => {
    expect(
      planRender(
        {
          type: 'table',
          x: { values: ['a', 'b'] },
          series: [{ label: 'NZD', values: [1] }],
        },
        context
      )
    ).toEqual({ kind: 'none' });
  });

  it('falls back to text with no rows or no columns', () => {
    expect(planRender({ type: 'table', series: money([1]) }, context)).toEqual({ kind: 'none' });
    expect(planRender({ type: 'table', x: { values: ['a'] } }, context)).toEqual({ kind: 'none' });
  });
});

/** Two values throughout: a single one is a headline, which has no chart to flag. */
describe('deciding what is an amount', () => {
  it.each(['NZD', 'nzd', 'AUD', 'USD'])('treats %s as money', (label) => {
    expect(
      planRender({ type: 'bar', series: [{ label, values: [1, 2] }] }, context)
    ).toMatchObject({ money: true });
  });

  it.each(['Bills', 'Items', 'Count', undefined])('treats %s as a count', (label) => {
    expect(
      planRender({ type: 'bar', series: [{ label, values: [1, 2] }] }, context)
    ).toMatchObject({ money: false });
  });

  /** A headline says it in its own way: cents when money, raw when a count. */
  it('formats a lone amount without needing the flag', () => {
    expect(planRender({ type: 'bar', series: money([12.5]) }, context)).toMatchObject({
      kind: 'stat',
      valueCents: 1250,
    });
    expect(
      planRender({ type: 'bar', series: [{ label: 'Bills', values: [7] }] }, context)
    ).toMatchObject({ kind: 'stat', valueCents: null, raw: 7 });
  });
});

/**
 * A single value is a stat tile, never a one-bar chart or a one-slice ring —
 * whichever form the model proposed.
 */
describe('one value is a headline, whatever was asked for', () => {
  it.each(['bar', 'line', 'donut', 'stat'] as const)('turns a lone %s into a stat', (type) => {
    expect(planRender({ type, series: [{ label: 'NZD', values: [12.5] }] }, context)).toMatchObject(
      { kind: 'stat', valueCents: 1250 }
    );
  });

  it('names the headline from the axis when the series is unlabelled', () => {
    expect(
      planRender(
        { type: 'bar', x: { values: ['Countdown'] }, series: [{ values: [3] }] },
        context
      )
    ).toMatchObject({ kind: 'stat', label: 'Countdown', valueCents: null, raw: 3 });
  });

  it('still charts two values', () => {
    expect(planRender({ type: 'bar', series: money([1, 2]) }, context)).toMatchObject({
      kind: 'bars',
    });
  });
});
