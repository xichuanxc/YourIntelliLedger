/**
 * The tool registry — the four declarations of §14, in one place.
 *
 * §2.2 rule 2 says agent tools never import one another, and none of them do.
 * This file is not a tool; it is the list, and it exists so that `prompt.ts`
 * sends every tool and `validate.ts` recognises every tool from the same
 * array. Adding a fifth tool in one place and forgetting the other is exactly
 * the drift §14's "contract and whitelist" line is written against.
 */

import { deleteBillTool } from '@/agent/tools/deleteBill';
import { getBillDetailTool } from '@/agent/tools/getBillDetail';
import { queryLedgerTool } from '@/agent/tools/queryLedger';
import type { FunctionDeclaration, ToolName, ToolSpec } from '@/agent/tools/schema';
import { updateBillItemTool } from '@/agent/tools/updateBillItem';

import type { DeleteBillArgs } from '@/agent/tools/deleteBill';
import type { GetBillDetailArgs } from '@/agent/tools/getBillDetail';
import type { QueryLedgerArgs } from '@/agent/tools/queryLedger';
import type { UpdateBillItemArgs } from '@/agent/tools/updateBillItem';

export const TOOLS: readonly ToolSpec[] = [
  queryLedgerTool,
  getBillDetailTool,
  updateBillItemTool,
  deleteBillTool,
];

const BY_NAME: ReadonlyMap<string, ToolSpec> = new Map(
  TOOLS.map((tool) => [tool.declaration.name, tool])
);

/**
 * Look a tool up by the name the model used.
 *
 * Takes a plain `string`, not `ToolName`, because the argument is whatever the
 * model said — narrowing it in the signature would only move the unchecked
 * cast somewhere less obvious. `undefined` means the model invented a tool,
 * which the loop reports back to it as a rejection (§14.5).
 */
export function toolByName(name: string): ToolSpec | undefined {
  return BY_NAME.get(name);
}

/** Just the declarations, for the `tools` array of a §13.2 request. */
export function toolDeclarations(): readonly FunctionDeclaration[] {
  return TOOLS.map((tool) => tool.declaration);
}

/**
 * The argument shape of each tool, keyed by name — the map `validate.ts`
 * returns into and `compile.ts` consumes. It is `unknown` until validated;
 * this type describes what a *successful* validation produces, never what
 * arrived.
 */
export interface ToolArgs {
  query_ledger: QueryLedgerArgs;
  get_bill_detail: GetBillDetailArgs;
  update_bill_item: UpdateBillItemArgs;
  delete_bill: DeleteBillArgs;
}

export type { FunctionDeclaration, ToolName, ToolSpec };
export type { DeleteBillArgs, GetBillDetailArgs, QueryLedgerArgs, UpdateBillItemArgs };
