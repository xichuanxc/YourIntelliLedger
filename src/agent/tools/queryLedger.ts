/**
 * `query_ledger` — read-only aggregate or list query over the ledger (§14.1).
 *
 * The workhorse: nearly every Ask question that is not "show me that receipt"
 * arrives as one of these. It is also the whole attack surface, because it is
 * the only tool whose arguments become SQL shape rather than SQL values — so
 * the enums below are not documentation, they are the whitelist `validate.ts`
 * enforces before `compile.ts` is allowed to see anything (§14.5, §14.6).
 *
 * The const arrays are the primary artefact and the types derive from them,
 * the same arrangement as `@/types/vocabulary`: a value can never exist in the
 * type but not in the schema the model was handed.
 *
 * Argument keys are snake_case because they are the model's words, not ours.
 * They cross the wire exactly as written here and are converted, if at all, at
 * the point where they stop being a model's request and become a query.
 */

import type { FunctionDeclaration, JsonSchema, ToolSpec } from '@/agent/tools/schema';

export const QUERY_METRICS = [
  'sum_amount',
  'avg_amount',
  'count',
  'list_items',
  'list_bills',
] as const;
export type QueryMetric = (typeof QUERY_METRICS)[number];

export const QUERY_DIMENSIONS = ['category', 'merchant', 'month', 'week', 'day', 'none'] as const;
export type QueryDimension = (typeof QUERY_DIMENSIONS)[number];

export const FILTER_FIELDS = ['category', 'merchant', 'name'] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];

export const FILTER_OPS = ['eq', 'in', 'contains'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const TIME_UNITS = ['day', 'week', 'month', 'year'] as const;
export type TimeUnit = (typeof TIME_UNITS)[number];

export const QUERY_SORTS = ['amount_desc', 'amount_asc', 'date_desc', 'date_asc'] as const;
export type QuerySort = (typeof QUERY_SORTS)[number];

/** §14.1 caps the array at four; more than that is a question, not a filter. */
export const MAX_FILTERS = 4;
/** §14.5 clamps rather than rejects above this — a big number is not an attack. */
export const MAX_LIMIT = 50;
/** §14.1's `time_range.last` bounds. Three years is the ledger's whole life. */
export const MIN_TIME_LAST = 1;
export const MAX_TIME_LAST = 36;

/**
 * `value` is `{}` in §14.1 — any JSON — because `eq` wants a scalar, `in`
 * wants an array and `contains` wants a string. That correspondence is a
 * cross-field rule no JSON Schema keyword expresses, so it is `validate.ts`'s
 * to enforce, not this file's. Typed `unknown` here so nothing downstream can
 * forget that it has not been checked yet.
 */
export interface QueryLedgerFilter {
  field: FilterField;
  op: FilterOp;
  value: unknown;
}

export interface QueryLedgerArgs {
  metric: QueryMetric;
  dimension?: QueryDimension;
  filters?: QueryLedgerFilter[];
  time_range?: { unit: TimeUnit; last: number };
  sort?: QuerySort;
  limit?: number;
}

const filterSchema: JsonSchema = {
  type: 'object',
  properties: {
    field: { enum: FILTER_FIELDS },
    op: { enum: FILTER_OPS },
    // Deliberately unconstrained, per §14.1. See `QueryLedgerFilter`.
    value: {},
  },
  required: ['field', 'op', 'value'],
};

const declaration: FunctionDeclaration = {
  name: 'query_ledger',
  description: 'Read-only aggregate or list query over bills and items. Cannot modify data.',
  parameters: {
    type: 'object',
    properties: {
      metric: { enum: QUERY_METRICS },
      dimension: { enum: QUERY_DIMENSIONS },
      filters: { type: 'array', maxItems: MAX_FILTERS, items: filterSchema },
      time_range: {
        type: 'object',
        properties: {
          unit: { enum: TIME_UNITS },
          last: { type: 'integer', minimum: MIN_TIME_LAST, maximum: MAX_TIME_LAST },
        },
        // Not in §14.1's listing, and added deliberately. Half a time range is
        // not a smaller time range, it is an unanswerable one — `{unit:"month"}`
        // with no `last` would force the compiler to invent a window and answer
        // a question nobody asked. §14.5 makes a clamped range report itself so
        // the answer can be honest about its own span; silently inventing one
        // is the same dishonesty with none of the reporting.
        required: ['unit', 'last'],
      },
      sort: { enum: QUERY_SORTS },
      limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
    },
    required: ['metric'],
  },
};

export const queryLedgerTool: ToolSpec = { declaration, kind: 'read' };
