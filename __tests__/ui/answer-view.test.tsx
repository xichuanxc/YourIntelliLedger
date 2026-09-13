/**
 * Drawing a planned answer (§6.7).
 *
 * `plan.ts` decides what may be shown and has its own suite; this checks the
 * drawing honours those decisions — that a paginated table says so, that a
 * headline is formatted as money only when it is money, and that nothing is
 * drawn when the plan says there is nothing to draw.
 */

import { render, screen } from '@testing-library/react-native';

import { AnswerView } from '@/render/answer-view';
import type { RenderPlan } from '@/render/plan';

const draw = (plan: RenderPlan) => render(<AnswerView plan={plan} currency="NZD" />);

const point = (label: string, value: number) => ({ label, value, cents: value * 100 });

describe('nothing to draw', () => {
  it('renders nothing at all, leaving the sentence alone', async () => {
    await draw({ kind: 'none' });
    expect(screen.toJSON()).toBeNull();
  });
});

describe('a headline', () => {
  it('formats an amount as money', async () => {
    await draw({ kind: 'stat', label: 'June', valueCents: 21430, raw: 214.3 });
    expect(screen.getByText('$214.30')).toBeTruthy();
  });

  /** A bill count is not an amount and must not grow a currency symbol. */
  it('leaves a count as a number', async () => {
    await draw({ kind: 'stat', label: 'Bills', valueCents: null, raw: 7 });
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.queryByText('$7.00')).toBeNull();
  });
});

describe('a table', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, index) => [`row ${index + 1}`, String(index)]);

  it('shows its header and rows', async () => {
    await draw({
      kind: 'table',
      columns: ['Category', 'NZD'],
      rows: [['Produce', '64.20']],
      totalRows: 1,
    });

    expect(screen.getByText('Category')).toBeTruthy();
    expect(screen.getByText('Produce')).toBeTruthy();
    expect(screen.getByText('64.20')).toBeTruthy();
  });

  /**
   * A table that simply stops reads as the whole answer. §6.7 paginates past
   * 50 rows, so the cut has to be visible.
   */
  it('says when it is showing only the first page', async () => {
    await draw({ kind: 'table', columns: ['Item', 'n'], rows: rows(50), totalRows: 63 });
    expect(screen.getByText('Showing the first 50 of 63 rows.')).toBeTruthy();
  });

  it('stays quiet when every row fits', async () => {
    await draw({ kind: 'table', columns: ['Item', 'n'], rows: rows(3), totalRows: 3 });
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });
});

/**
 * The chart libraries are stubbed, so these assert the choice of form and the
 * surrounding labelling — which is this file's job — not the drawing.
 */
describe('choosing the mark', () => {
  it('draws bars for a comparison', async () => {
    await draw({
      kind: 'bars',
      title: 'Spend by category',
      bars: [point('Produce', 64.2), point('Dairy', 43.1)],
      money: true,
    });
    expect(screen.getByText('bar-chart')).toBeTruthy();
    expect(screen.getByText('Spend by category')).toBeTruthy();
  });

  it('draws a line for a trend', async () => {
    await draw({
      kind: 'line',
      points: [point('Jun', 1), point('Jul', 2)],
      money: true,
    });
    expect(screen.getByText('line-chart')).toBeTruthy();
  });

  /** The donut is real, not stubbed: its legend is the accessibility story. */
  it('names every slice in the donut’s legend, never colour alone', async () => {
    await draw({
      kind: 'donut',
      entries: [
        { key: 'produce', label: 'Produce', valueCents: 6420 },
        { key: 'dairy', label: 'Dairy', valueCents: 4310 },
      ],
      totalCents: 10730,
    });

    expect(screen.getByText('Produce')).toBeTruthy();
    expect(screen.getByText('Dairy')).toBeTruthy();
  });
});
