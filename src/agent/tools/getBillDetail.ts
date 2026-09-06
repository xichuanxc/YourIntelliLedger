/**
 * `get_bill_detail` — one bill with all of its line items (§14.2).
 *
 * The smallest tool, and the one the model reaches for after `query_ledger`
 * has narrowed things to a single row. §14.5 gives it the only `not_found`
 * rejection in the table: an unknown `bill_id` is an error, unlike an unknown
 * filter *value*, where an empty result is a legitimate answer.
 */

import type { FunctionDeclaration, ToolSpec } from '@/agent/tools/schema';

export interface GetBillDetailArgs {
  bill_id: number;
}

const declaration: FunctionDeclaration = {
  name: 'get_bill_detail',
  description: 'Return one bill with all of its line items.',
  parameters: {
    type: 'object',
    properties: {
      bill_id: { type: 'integer' },
    },
    required: ['bill_id'],
  },
};

export const getBillDetailTool: ToolSpec = { declaration, kind: 'read' };
