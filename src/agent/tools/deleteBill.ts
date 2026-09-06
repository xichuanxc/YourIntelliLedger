/**
 * `delete_bill` — remove a bill and its items (§14.4). **Write; needs a tap.**
 *
 * The bluntest tool in the set, and the reason §6.1 refuses to commit a write
 * without a confirmation card. `reason` is not stored: it exists so the
 * confirmation the user reads says *why* the model wants this, which is the
 * difference between an informed tap and a reflexive one.
 *
 * Deletion cascades to `bill_items` and `receipt_scans` through the schema's
 * foreign keys (§4.4), so there is no second tool to call and no half-deleted
 * state to reason about.
 */

import type { FunctionDeclaration, ToolSpec } from '@/agent/tools/schema';

/** §14.4's cap — a sentence of justification, not an essay. */
export const MAX_REASON_LENGTH = 200;

export interface DeleteBillArgs {
  bill_id: number;
  reason?: string;
}

const declaration: FunctionDeclaration = {
  name: 'delete_bill',
  description: 'Delete a bill and its items. Requires user confirmation.',
  parameters: {
    type: 'object',
    properties: {
      bill_id: { type: 'integer' },
      reason: { type: 'string', maxLength: MAX_REASON_LENGTH },
    },
    required: ['bill_id'],
  },
};

export const deleteBillTool: ToolSpec = { declaration, kind: 'write' };
