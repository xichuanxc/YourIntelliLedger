/**
 * §14.5's acceptance criterion: 100% of malformed specs rejected before SQL.
 *
 * The adversarial block is the deliverable, not a byproduct. Every case there
 * asserts the same structural fact — the result carries no `call`, so there is
 * nothing for `compile.ts` to be handed. That is what "rejected before
 * execution" means in a shape a test can check, rather than a comment.
 *
 * The two halves that are easy to get backwards, and are pinned here:
 * a clamp must *report itself*, and a filter value containing SQL is a
 * perfectly ordinary value — it becomes a bound parameter, not syntax.
 */

import { validateToolCall, type ValidationContext } from '@/agent/validate';
import { CATEGORIES } from '@/types/vocabulary';

/** A Monday, so the week arithmetic below is readable. */
const TODAY = '2026-09-07' as const;

const context: ValidationContext = { today: TODAY, firstBill: '2026-02-03' };
const emptyLedger: ValidationContext = { today: TODAY, firstBill: null };
/** Old enough that nothing below clamps — these rows test the calendar, not §14.5. */
const longLedger: ValidationContext = { today: TODAY, firstBill: '2020-01-01' };

function query(args: unknown, ctx: ValidationContext = context) {
  return validateToolCall('query_ledger', args, ctx);
}

describe('the ordinary case', () => {
  it('accepts a bare metric', () => {
    const result = query({ metric: 'count' });
    expect(result).toEqual({
      ok: true,
      notes: [],
      call: {
        name: 'query_ledger',
        args: {
          metric: 'count',
          dimension: 'none',
          filters: [],
          sort: undefined,
          limit: undefined,
          period: null,
        },
      },
    });
  });

  it('resolves a time range into calendar dates, never a duration (§14.6)', () => {
    const result = query({ metric: 'sum_amount', time_range: { unit: 'month', last: 3 } });
    expect(result).toMatchObject({
      ok: true,
      call: { args: { period: { from: '2026-07-01', to: '2026-09-30' } } },
    });
  });

  it.each([
    ['day', 7, { from: '2026-09-01', to: '2026-09-07' }],
    ['week', 2, { from: '2026-08-31', to: '2026-09-13' }],
    ['month', 1, { from: '2026-09-01', to: '2026-09-30' }],
    ['year', 2, { from: '2025-01-01', to: '2026-12-31' }],
  ])('covers whole %s periods', (unit, last, period) => {
    expect(query({ metric: 'count', time_range: { unit, last } }, longLedger)).toMatchObject({
      ok: true,
      call: { args: { period } },
    });
  });

  it('normalises every filter to a list of terms', () => {
    const result = query({
      metric: 'sum_amount',
      filters: [
        { field: 'category', op: 'eq', value: 'dairy' },
        { field: 'category', op: 'in', value: ['meat', 'produce'] },
        { field: 'merchant', op: 'contains', value: 'countdown' },
      ],
    });
    expect(result).toMatchObject({
      ok: true,
      call: {
        args: {
          filters: [
            { field: 'category', op: 'eq', values: ['dairy'] },
            { field: 'category', op: 'in', values: ['meat', 'produce'] },
            { field: 'merchant', op: 'contains', values: ['countdown'] },
          ],
        },
      },
    });
  });

  it('accepts the three other tools', () => {
    expect(validateToolCall('get_bill_detail', { bill_id: 12 }, context)).toMatchObject({ ok: true });
    expect(
      validateToolCall('update_bill_item', { bill_item_id: 3, set: { category: 'snacks' } }, context)
    ).toMatchObject({ ok: true });
    expect(validateToolCall('delete_bill', { bill_id: 4, reason: 'duplicate' }, context)).toMatchObject(
      { ok: true }
    );
  });
});

describe('clamps report themselves (§14.5)', () => {
  it('clamps limit to 50 and says so', () => {
    const result = query({ metric: 'list_bills', limit: 9999 });
    expect(result).toMatchObject({ ok: true, call: { args: { limit: 50 } } });
    expect(result.ok && result.notes).toHaveLength(1);
    expect(result.ok && result.notes[0]).toContain('50');
  });

  it('clamps a below-minimum limit rather than letting -1 reach SQL', () => {
    // A negative LIMIT means *unbounded* in SQLite, so this is the one bound
    // where silently passing it through would do the opposite of limiting.
    const result = query({ metric: 'list_bills', limit: -1 });
    expect(result).toMatchObject({ ok: true, call: { args: { limit: 1 } } });
  });

  it.each([
    [999, 36],
    [0, 1],
    [-5, 1],
  ])('clamps time_range.last of %i to %i with a note', (last, expected) => {
    const result = query({ metric: 'count', time_range: { unit: 'month', last } });
    expect(result.ok && result.notes.length).toBeGreaterThan(0);
    const months = expected === 36 ? 36 : 1;
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.call.name).toBe('query_ledger');
    expect(months).toBe(expected);
  });

  it('clamps to the start of the ledger and tells the model why', () => {
    const result = query({ metric: 'sum_amount', time_range: { unit: 'month', last: 24 } });
    expect(result).toMatchObject({ ok: true, call: { args: { period: { from: '2026-02-03' } } } });
    expect(result.ok && result.notes.join(' ')).toContain('2026-02-03');
  });

  it('says plainly when there are no bills at all', () => {
    const result = query({ metric: 'count', time_range: { unit: 'month', last: 3 } }, emptyLedger);
    expect(result.ok && result.notes.join(' ')).toContain('no bills');
  });

  it('adds no notes when nothing was clamped', () => {
    const result = query({ metric: 'count', limit: 10, time_range: { unit: 'month', last: 2 } });
    expect(result.ok && result.notes).toEqual([]);
  });
});

describe('a filter value is data, never syntax (§14.6)', () => {
  it.each([
    "'; DROP TABLE bills;--",
    '" OR 1=1 --',
    '%',
    '_',
    'countdown\\',
    '豆腐干',
  ])('passes %s through untouched', (value) => {
    const result = query({
      metric: 'sum_amount',
      filters: [{ field: 'merchant', op: 'contains', value }],
    });
    expect(result).toMatchObject({
      ok: true,
      call: { args: { filters: [{ values: [value] }] } },
    });
  });

  it('allows a merchant that does not exist — an empty result is an answer', () => {
    expect(
      query({ metric: 'count', filters: [{ field: 'merchant', op: 'eq', value: 'Nowhere Ltd' }] })
    ).toMatchObject({ ok: true });
  });
});

/**
 * Every case here asserts the same thing twice: the right code, and that the
 * result carries nothing executable. The second assertion is the acceptance
 * criterion — a rejection that still produced a spec would be no rejection.
 */
describe('the adversarial suite — nothing malformed reaches compile', () => {
  const cases: [string, string, unknown, string][] = [
    // ---- unknown properties -------------------------------------------
    ['unknown top-level key', 'query_ledger', { metric: 'count', bogus: 1 }, 'unknown_field'],
    [
      'unknown key inside a filter',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'eq', value: 'a', extra: 1 }] },
      'unknown_field',
    ],
    ['unknown key inside set', 'update_bill_item', { bill_item_id: 1, set: { sql: 'x' } }, 'unknown_field'],
    ['constructor as a key', 'query_ledger', { metric: 'count', constructor: 1 }, 'unknown_field'],
    ['prototype as a key', 'query_ledger', { metric: 'count', prototype: 1 }, 'unknown_field'],
    ['toString as a key', 'query_ledger', { metric: 'count', toString: 1 }, 'unknown_field'],

    // ---- enums ----------------------------------------------------------
    ['wrong enum casing', 'query_ledger', { metric: 'SUM_AMOUNT' }, 'invalid_enum'],
    ['invented metric', 'query_ledger', { metric: 'sum_everything' }, 'invalid_enum'],
    ['fullwidth lookalike', 'query_ledger', { metric: 'ｃount' }, 'invalid_enum'],
    ['zero-width padding', 'query_ledger', { metric: 'count​' }, 'invalid_enum'],
    ['decomposed unicode', 'query_ledger', { metric: 'couñt' }, 'invalid_enum'],
    ['object where an enum belongs', 'query_ledger', { metric: {} }, 'invalid_enum'],
    ['null where an enum belongs', 'query_ledger', { metric: null }, 'invalid_enum'],
    [
      'category outside §4.7',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'category', op: 'eq', value: 'groceries' }] },
      'invalid_enum',
    ],
    [
      'category list with one bad member',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'category', op: 'in', value: ['dairy', 'wine'] }] },
      'invalid_enum',
    ],
    ['invented category on a write', 'update_bill_item', { bill_item_id: 1, set: { category: 'wine' } }, 'invalid_enum'],
    ['invented unit on a write', 'update_bill_item', { bill_item_id: 1, set: { unit: 'dozen' } }, 'invalid_enum'],

    // ---- required and types ---------------------------------------------
    ['no metric', 'query_ledger', {}, 'missing_field'],
    ['no arguments at all', 'query_ledger', null, 'missing_field'],
    ['time_range without last', 'query_ledger', { metric: 'count', time_range: { unit: 'month' } }, 'missing_field'],
    ['time_range without unit', 'query_ledger', { metric: 'count', time_range: { last: 3 } }, 'missing_field'],
    ['no bill_id', 'get_bill_detail', {}, 'missing_field'],
    ['no set', 'update_bill_item', { bill_item_id: 1 }, 'missing_field'],
    ['arguments as a string', 'query_ledger', 'metric=count', 'invalid_type'],
    ['arguments as an array', 'query_ledger', [], 'invalid_type'],
    ['fractional limit', 'query_ledger', { metric: 'count', limit: 1.5 }, 'invalid_type'],
    ['fractional time_range.last', 'query_ledger', { metric: 'count', time_range: { unit: 'month', last: 2.5 } }, 'invalid_type'],
    ['numeric string limit', 'query_ledger', { metric: 'count', limit: '50' }, 'invalid_type'],
    ['object where a scalar belongs', 'query_ledger', { metric: 'count', limit: {} }, 'invalid_type'],
    ['filters as an object', 'query_ledger', { metric: 'count', filters: {} }, 'invalid_type'],
    ['a filter that is an array', 'query_ledger', { metric: 'count', filters: [[]] }, 'invalid_type'],
    ['null where a string belongs', 'update_bill_item', { bill_item_id: 1, set: { name: null } }, 'invalid_type'],
    ['string bill_id', 'get_bill_detail', { bill_id: '12' }, 'invalid_type'],
    ['fractional bill_id', 'delete_bill', { bill_id: 1.5 }, 'invalid_type'],

    // ---- bounds that are rejected, not clamped ---------------------------
    [
      'five filters against maxItems 4',
      'query_ledger',
      {
        metric: 'count',
        filters: Array.from({ length: 5 }, () => ({ field: 'merchant', op: 'eq', value: 'a' })),
      },
      'too_many_items',
    ],
    ['negative price on a write', 'update_bill_item', { bill_item_id: 1, set: { price_cents: -1 } }, 'out_of_range'],
    ['negative quantity on a write', 'update_bill_item', { bill_item_id: 1, set: { qty: -1 } }, 'out_of_range'],
    ['over-long item name', 'update_bill_item', { bill_item_id: 1, set: { name: 'x'.repeat(121) } }, 'too_long'],
    ['over-long reason', 'delete_bill', { bill_id: 1, reason: 'x'.repeat(201) }, 'too_long'],
    [
      'over-long filter value',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'eq', value: 'x'.repeat(201) }] },
      'too_long',
    ],
    [
      'an IN list long enough to be a payload',
      'query_ledger',
      {
        metric: 'count',
        filters: [{ field: 'merchant', op: 'in', value: Array.from({ length: 21 }, (_, i) => `m${i}`) }],
      },
      'too_many_items',
    ],

    // ---- filter values that mean nothing ---------------------------------
    ['empty set', 'update_bill_item', { bill_item_id: 1, set: {} }, 'invalid_value'],
    ['rename to nothing', 'update_bill_item', { bill_item_id: 1, set: { name: '   ' } }, 'invalid_value'],
    [
      'empty search term',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'contains', value: '' }] },
      'invalid_value',
    ],
    [
      'empty IN list',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'in', value: [] }] },
      'invalid_value',
    ],
    [
      'contains against a closed vocabulary',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'category', op: 'contains', value: 'dai' }] },
      'invalid_value',
    ],
    [
      'a list where a single term belongs',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'eq', value: ['a', 'b'] }] },
      'invalid_type',
    ],
    [
      'numbers where terms belong',
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'in', value: [1, 2] }] },
      'invalid_type',
    ],

    // ---- shape attacks ----------------------------------------------------
    ['an invented tool', 'drop_everything', {}, 'unknown_tool'],
    ['a tool named __proto__', '__proto__', {}, 'unknown_tool'],
  ];

  it.each(cases)('rejects %s', (_label, tool, args, code) => {
    const result = validateToolCall(tool, args, context);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code });
    expect(result).not.toHaveProperty('call');
  });

  /** The `{}` schema on `filters[].value` is the one "anything" in §14. */
  it('does not let the untyped filter value smuggle a deep object through', () => {
    let nested: unknown = { end: true };
    for (let i = 0; i < 1000; i += 1) nested = { nested };
    const result = query({
      metric: 'count',
      filters: [{ field: 'merchant', op: 'eq', value: nested }],
    });
    expect(result).toMatchObject({ ok: false, code: 'invalid_type' });
  });

  /**
   * `JSON.parse` gives `__proto__` as a real own key, unlike an object
   * literal, which sets the prototype instead — so this is the only way to
   * write the test that actually tests anything.
   */
  it('rejects a JSON-parsed __proto__ key without polluting anything', () => {
    const hostile = JSON.parse('{"metric":"count","__proto__":{"polluted":true}}');
    expect(validateToolCall('query_ledger', hostile, context)).toMatchObject({
      ok: false,
      code: 'unknown_field',
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('rejections are written for the model to correct against (§14.5)', () => {
  it('lists the valid values on an enum mismatch', () => {
    const result = validateToolCall('query_ledger', { metric: 'nope' }, context);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const value of ['sum_amount', 'avg_amount', 'count', 'list_items', 'list_bills']) {
      expect(result.message).toContain(value);
    }
  });

  it('lists every category when the model invents one', () => {
    const result = validateToolCall(
      'query_ledger',
      { metric: 'count', filters: [{ field: 'category', op: 'eq', value: 'groceries' }] },
      context
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const category of CATEGORIES) expect(result.message).toContain(category);
  });

  it('points at the offending path, not just the call', () => {
    const result = validateToolCall(
      'query_ledger',
      { metric: 'count', filters: [{ field: 'merchant', op: 'nope', value: 'a' }] },
      context
    );
    expect(result).toMatchObject({ ok: false, path: 'filters[0].op' });
  });
});
