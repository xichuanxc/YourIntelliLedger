/**
 * `update_bill_item` — correct one line item (§14.3). **Write; needs a tap.**
 *
 * The enums come from `@/types/vocabulary` rather than being retyped, because
 * §4.7's vocabularies are also the SQLite `CHECK` constraints. A copy here
 * would be a silent way for the model's options to drift from what the
 * database will actually accept — the model would offer `groceries`, the user
 * would confirm it, and the write would fail at the constraint with nothing
 * useful to say. §4.7 already requires a vocabulary change to touch the
 * migration and the prompt in one commit; importing keeps this file honest
 * without anyone having to remember it.
 *
 * `minProperties: 1` is what stops an empty `set` from being a "successful"
 * update that changes nothing.
 */

import type { FunctionDeclaration, ToolSpec } from '@/agent/tools/schema';
import type { Category, Unit } from '@/types/vocabulary';
import { CATEGORIES, UNITS } from '@/types/vocabulary';

/** §14.3's cap. Long enough for any real product name, short enough to bound. */
export const MAX_ITEM_NAME_LENGTH = 120;

export interface UpdateBillItemArgs {
  bill_item_id: number;
  set: {
    name?: string;
    category?: Category;
    qty?: number;
    unit?: Unit;
    price_cents?: number;
  };
}

const declaration: FunctionDeclaration = {
  name: 'update_bill_item',
  description: 'Correct a line item. Requires user confirmation before it takes effect.',
  parameters: {
    type: 'object',
    properties: {
      bill_item_id: { type: 'integer' },
      set: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: MAX_ITEM_NAME_LENGTH },
          category: { enum: CATEGORIES },
          qty: { type: 'number', minimum: 0 },
          unit: { enum: UNITS },
          price_cents: { type: 'integer', minimum: 0 },
        },
        minProperties: 1,
      },
    },
    required: ['bill_item_id', 'set'],
  },
};

export const updateBillItemTool: ToolSpec = { declaration, kind: 'write' };
