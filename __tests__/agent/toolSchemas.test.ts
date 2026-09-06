/**
 * The tool declarations are the LLM contract (§14), so this suite pins them to
 * the spec text rather than to themselves.
 *
 * The expected objects below are §14.1–14.4 transcribed verbatim, with exactly
 * one addition — `time_range.required`, justified in `queryLedger.ts`. If a
 * future edit changes what the model is told, this file fails and the diff
 * shows precisely which sentence of §14 stopped being true. That is the point:
 * a schema that quietly drifts is a validator that quietly drifts with it.
 */

import { TOOLS, toolByName, toolDeclarations } from '@/agent/tools';
import { MAX_ITEM_NAME_LENGTH } from '@/agent/tools/updateBillItem';
import { MAX_FILTERS, MAX_LIMIT, MAX_TIME_LAST } from '@/agent/tools/queryLedger';
import { CATEGORIES, UNITS } from '@/types/vocabulary';

const queryLedger = {
  name: 'query_ledger',
  description: 'Read-only aggregate or list query over bills and items. Cannot modify data.',
  parameters: {
    type: 'object',
    properties: {
      metric: { enum: ['sum_amount', 'avg_amount', 'count', 'list_items', 'list_bills'] },
      dimension: { enum: ['category', 'merchant', 'month', 'week', 'day', 'none'] },
      filters: {
        type: 'array',
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            field: { enum: ['category', 'merchant', 'name'] },
            op: { enum: ['eq', 'in', 'contains'] },
            value: {},
          },
          required: ['field', 'op', 'value'],
        },
      },
      time_range: {
        type: 'object',
        properties: {
          unit: { enum: ['day', 'week', 'month', 'year'] },
          last: { type: 'integer', minimum: 1, maximum: 36 },
        },
        required: ['unit', 'last'], // the one documented addition to §14.1
      },
      sort: { enum: ['amount_desc', 'amount_asc', 'date_desc', 'date_asc'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: ['metric'],
  },
};

const getBillDetail = {
  name: 'get_bill_detail',
  description: 'Return one bill with all of its line items.',
  parameters: {
    type: 'object',
    properties: { bill_id: { type: 'integer' } },
    required: ['bill_id'],
  },
};

const updateBillItem = {
  name: 'update_bill_item',
  description: 'Correct a line item. Requires user confirmation before it takes effect.',
  parameters: {
    type: 'object',
    properties: {
      bill_item_id: { type: 'integer' },
      set: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 120 },
          category: {
            enum: [
              'produce',
              'dairy',
              'meat',
              'bakery',
              'snacks',
              'frozen',
              'pantry_staple',
              'beverage',
              'household',
              'other',
            ],
          },
          qty: { type: 'number', minimum: 0 },
          unit: { enum: ['pc', 'kg', 'g', 'l', 'ml', 'pack'] },
          price_cents: { type: 'integer', minimum: 0 },
        },
        minProperties: 1,
      },
    },
    required: ['bill_item_id', 'set'],
  },
};

const deleteBill = {
  name: 'delete_bill',
  description: 'Delete a bill and its items. Requires user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      bill_id: { type: 'integer' },
      reason: { type: 'string', maxLength: 200 },
    },
    required: ['bill_id'],
  },
};

describe('tool declarations match §14', () => {
  it.each([
    ['query_ledger', queryLedger],
    ['get_bill_detail', getBillDetail],
    ['update_bill_item', updateBillItem],
    ['delete_bill', deleteBill],
  ])('%s', (name, expected) => {
    expect(toolByName(name)?.declaration).toEqual(expected);
  });

  it('sends all four and nothing else', () => {
    expect(toolDeclarations().map((d) => d.name)).toEqual([
      'query_ledger',
      'get_bill_detail',
      'update_bill_item',
      'delete_bill',
    ]);
  });
});

describe('the whitelist is one artefact, not two', () => {
  /**
   * §4.7's vocabularies are also the SQLite CHECK constraints. If these drift,
   * the model offers a category the database will refuse *after* the user has
   * confirmed the write — the failure lands on the person, not the developer.
   */
  it('offers exactly the categories the database accepts', () => {
    const set = toolByName('update_bill_item')?.declaration.parameters.properties?.set;
    expect(set?.properties?.category?.enum).toEqual(CATEGORIES);
  });

  it('offers exactly the units the database accepts', () => {
    const set = toolByName('update_bill_item')?.declaration.parameters.properties?.set;
    expect(set?.properties?.unit?.enum).toEqual(UNITS);
  });

  it('exports the bounds validate.ts clamps against', () => {
    expect([MAX_FILTERS, MAX_LIMIT, MAX_TIME_LAST, MAX_ITEM_NAME_LENGTH]).toEqual([4, 50, 36, 120]);
  });
});

describe('the registry', () => {
  it('marks only the two confirmation-required tools as writes', () => {
    const writes = TOOLS.filter((t) => t.kind === 'write').map((t) => t.declaration.name);
    expect(writes).toEqual(['update_bill_item', 'delete_bill']);
  });

  it('does not know a tool the model invented', () => {
    expect(toolByName('drop_everything')).toBeUndefined();
    expect(toolByName('__proto__')).toBeUndefined();
  });

  /** Whatever is in a declaration crosses the wire verbatim (§13.7). */
  it('leaks nothing app-side onto the wire', () => {
    for (const { declaration } of TOOLS) {
      expect(Object.keys(declaration).sort()).toEqual(['description', 'name', 'parameters']);
      expect(JSON.parse(JSON.stringify(declaration))).toEqual(declaration);
    }
  });
});
