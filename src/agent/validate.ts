/**
 * `validate.ts` — everything the model asks for passes through here first
 * (§14.5). Nothing reaches `compile.ts`, and therefore nothing reaches SQL,
 * that has not come out of this file.
 *
 * It validates by *walking the declarations in `tools/`* rather than by
 * re-stating their rules in code. That is the whole design: §14 calls those
 * schemas "the LLM contract **and** the validator whitelist", and a second
 * hand-written copy of the rules would be free to disagree with the first.
 * Anything a schema does not declare is unknown, and unknown is rejected.
 *
 * Two behaviours are worth reading twice.
 *
 * **Reject versus clamp is not a style choice.** §14.5 clamps exactly two
 * things — `limit` and `time_range.last` — because both are the model making a
 * reasonable judgement about scope, and answering a slightly smaller question
 * beats refusing. Everything else is rejected, because a malformed spec is not
 * a smaller spec.
 *
 * **A clamp must report itself.** Clamping quietly would let the model claim it
 * answered a question it did not — three years of a four-month ledger reading
 * as three years of near-zero spending. Clamps come back as `notes`, which the
 * loop puts in the tool result so the answer can be honest about its own range.
 *
 * Rejections also go back to the model as the tool result, not to the user:
 * §14.5 gives it one retry to correct itself, which is why every message here
 * says what was wrong in terms the model can act on — an `invalid_enum` lists
 * the values that would have worked.
 */

import { toolByName } from '@/agent/tools';
import type { DeleteBillArgs } from '@/agent/tools/deleteBill';
import type { GetBillDetailArgs } from '@/agent/tools/getBillDetail';
import {
  type FilterField,
  type FilterOp,
  type QueryDimension,
  type QueryMetric,
  type QuerySort,
  type TimeUnit,
} from '@/agent/tools/queryLedger';
import type { JsonSchema } from '@/agent/tools/schema';
import type { UpdateBillItemArgs } from '@/agent/tools/updateBillItem';
import { resolveTimeRange, type TimeRangeContext } from '@/agent/timeRange';
import type { Period } from '@/data/dates';
import { CATEGORIES } from '@/types/vocabulary';

// --------------------------------------------------------------- results ---

/**
 * §14.5's table names an *action* for every row but a *code* for only three —
 * `unknown_field`, `invalid_enum` and `not_found`. The rest are ours, kept
 * deliberately few: the code routes the loop's behaviour, while the message is
 * what the model actually reads and corrects against.
 */
export const VALIDATION_CODES = [
  'unknown_tool',
  'unknown_field',
  'missing_field',
  'invalid_type',
  'invalid_enum',
  'invalid_value',
  'out_of_range',
  'too_many_items',
  'too_long',
  'not_found',
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export interface ToolRejection {
  ok: false;
  code: ValidationCode;
  /** Where it went wrong, e.g. `filters[0].op`. Empty for whole-call faults. */
  path: string;
  /** Returned to the model verbatim as the tool result (§14.5). */
  message: string;
}

/** A `query_ledger` call with every bound applied and the window resolved. */
export interface ValidatedQuery {
  metric: QueryMetric;
  dimension: QueryDimension;
  filters: ValidatedFilter[];
  sort?: QuerySort;
  limit?: number;
  /**
   * The concrete window, or null for "all time". §14.6 requires this be
   * computed app-side, so `compile.ts` receives dates and never a duration.
   */
  period: Period | null;
}

export interface ValidatedFilter {
  field: FilterField;
  op: FilterOp;
  /** A single term for `eq`/`contains`; one or more for `in`. */
  values: string[];
}

export type ValidatedCall =
  | { name: 'query_ledger'; args: ValidatedQuery }
  | { name: 'get_bill_detail'; args: GetBillDetailArgs }
  | { name: 'update_bill_item'; args: UpdateBillItemArgs }
  | { name: 'delete_bill'; args: DeleteBillArgs };

export interface ValidationSuccess {
  ok: true;
  call: ValidatedCall;
  /** Clamps and caveats, for the tool result. Empty in the ordinary case. */
  notes: string[];
}

export type ValidationResult = ValidationSuccess | ToolRejection;

/**
 * Everything the rules need from outside: today's date and where the ledger
 * starts. Both are passed in rather than read here, which is what keeps this
 * module pure — the adversarial suite runs with no clock and no database.
 */
export type ValidationContext = TimeRangeContext;

// ------------------------------------------------------------- constants ---

/** `IN (?,…)` with a thousand terms is a denial of service, not a filter. */
export const MAX_FILTER_VALUES = 20;
/** No merchant or product name is longer than this; §14.3 caps names at 120. */
export const MAX_FILTER_VALUE_LENGTH = 200;

/**
 * The only two bounds §14.5 clamps instead of rejecting, by their path in the
 * declaration. Written as paths so the schema walk stays generic and the list
 * of exceptions stays where someone comparing it against §14.5 can find it.
 */
const CLAMPED_PATHS: ReadonlySet<string> = new Set(['limit', 'time_range.last']);

// ------------------------------------------------------- internal control ---

/**
 * Rejection is thrown internally and converted at the boundary, so the walk
 * below reads as the rules rather than as error plumbing. It never escapes
 * this module — `validateToolCall` is the only caller and it catches.
 */
class Rejected extends Error {
  constructor(readonly rejection: ToolRejection) {
    super(rejection.message);
    this.name = 'Rejected';
  }
}

function reject(code: ValidationCode, path: string, message: string): never {
  throw new Rejected({ ok: false, code, path, message });
}

function hasOwn(target: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function label(path: string): string {
  return path === '' ? 'the arguments' : `\`${path}\``;
}

function join(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}

// ------------------------------------------------------------ schema walk ---

/**
 * Checks `value` against `schema`, returning the value to use.
 *
 * The return matters: a clamped `limit` comes back as 50, so callers work with
 * the bounded value and cannot accidentally use the original.
 */
function walk(schema: JsonSchema, value: unknown, path: string, notes: string[]): unknown {
  if (schema.enum) {
    if (typeof value !== 'string' || !schema.enum.includes(value)) {
      reject(
        'invalid_enum',
        path,
        `${label(path)} must be one of: ${schema.enum.join(', ')}. Received ${describe(value)}.`
      );
    }
    return value;
  }

  switch (schema.type) {
    // An empty schema is "any value" — §14.1's `filters[].value`, whose real
    // constraint depends on the sibling `op` and is applied in `checkFilter`.
    case undefined:
      return value;
    case 'object':
      return walkObject(schema, value, path, notes);
    case 'array':
      return walkArray(schema, value, path, notes);
    case 'integer':
    case 'number':
      return walkNumber(schema, value, path, notes);
    case 'string':
      return walkString(schema, value, path);
    case 'boolean':
      if (typeof value !== 'boolean') {
        reject('invalid_type', path, `${label(path)} must be true or false.`);
      }
      return value;
  }
}

function walkObject(
  schema: JsonSchema,
  value: unknown,
  path: string,
  notes: string[]
): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    reject('invalid_type', path, `${label(path)} must be an object.`);
  }

  const source = value as Record<string, unknown>;
  const declared = schema.properties ?? {};
  const keys = Object.keys(source);

  // Unknown keys are rejected *before* anything is copied out, which is also
  // what makes the copy below safe: `__proto__` and `constructor` are not
  // declared properties, so they never reach an assignment. `hasOwn` rather
  // than `in`, or every object on earth would appear to declare `toString`.
  for (const key of keys) {
    if (!hasOwn(declared, key)) {
      reject(
        'unknown_field',
        join(path, key),
        `${label(join(path, key))} is not a recognised argument. Allowed here: ` +
          `${Object.keys(declared).join(', ')}.`
      );
    }
  }

  for (const key of schema.required ?? []) {
    if (!hasOwn(source, key) || source[key] === undefined) {
      reject('missing_field', join(path, key), `${label(join(path, key))} is required.`);
    }
  }

  if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
    reject(
      'invalid_value',
      path,
      `${label(path)} must set at least ${schema.minProperties} field; it was empty.`
    );
  }

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = walk(declared[key], source[key], join(path, key), notes);
  }
  return result;
}

function walkArray(schema: JsonSchema, value: unknown, path: string, notes: string[]): unknown[] {
  if (!Array.isArray(value)) {
    reject('invalid_type', path, `${label(path)} must be an array.`);
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    // Not clamped: dropping the fifth filter would answer a broader question
    // than the one asked, and do it invisibly. §14.5 clamps scope, not intent.
    reject(
      'too_many_items',
      path,
      `${label(path)} accepts at most ${schema.maxItems} entries; ${value.length} were given.`
    );
  }
  const items = schema.items ?? {};
  return value.map((entry, index) => walk(items, entry, `${path}[${index}]`, notes));
}

function walkNumber(schema: JsonSchema, value: unknown, path: string, notes: string[]): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    reject('invalid_type', path, `${label(path)} must be a number.`);
  }
  if (schema.type === 'integer' && !Number.isInteger(value)) {
    // Never clamped, even on a clamped path: 2.5 months is not an over-large
    // range to trim, it is a request that was not meant literally.
    reject('invalid_type', path, `${label(path)} must be a whole number.`);
  }

  const clampable = CLAMPED_PATHS.has(path);
  if (schema.maximum !== undefined && value > schema.maximum) {
    if (!clampable) {
      reject('out_of_range', path, `${label(path)} must be at most ${schema.maximum}.`);
    }
    notes.push(
      `Asked for ${label(path)} of ${value}; the maximum is ${schema.maximum}, ` +
        `so the answer uses ${schema.maximum}.`
    );
    return schema.maximum;
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    if (!clampable) {
      reject('out_of_range', path, `${label(path)} must be at least ${schema.minimum}.`);
    }
    notes.push(
      `Asked for ${label(path)} of ${value}, which is below the minimum of ` +
        `${schema.minimum}; the answer uses ${schema.minimum}.`
    );
    return schema.minimum;
  }
  return value;
}

function walkString(schema: JsonSchema, value: unknown, path: string): string {
  if (typeof value !== 'string') {
    reject('invalid_type', path, `${label(path)} must be a string.`);
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    reject(
      'too_long',
      path,
      `${label(path)} must be at most ${schema.maxLength} characters; it was ${value.length}.`
    );
  }
  return value;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  if (typeof value === 'string') return JSON.stringify(value);
  return String(value);
}

// ------------------------------------------------------ tool semantics ---

/**
 * The rules a JSON Schema keyword cannot express, all of them cross-field.
 *
 * `value` is `{}` in §14.1 because what it must be depends on `op`. And
 * `category` is checked against §4.7's closed vocabulary even though §14.5
 * says a non-existent filter *value* is allowed — that row is about open
 * fields like merchant, where an empty result genuinely is the answer. For a
 * closed vocabulary it is an enum mismatch (§14.5's second row), and treating
 * it as "no matches" would have the model report "$0 on groceries" when the
 * real answer is that `groceries` was never a category.
 */
function checkFilter(raw: Record<string, unknown>, path: string): ValidatedFilter {
  const field = raw.field as FilterField;
  const op = raw.op as FilterOp;
  const value = raw.value;

  if (op === 'contains' && field === 'category') {
    reject(
      'invalid_value',
      `${path}.op`,
      'Categories are a fixed list, so `contains` cannot be used on them. ' +
        `Use \`eq\` or \`in\` with one of: ${CATEGORIES.join(', ')}.`
    );
  }

  const values = op === 'in' ? asTermList(value, `${path}.value`) : [asTerm(value, `${path}.value`)];

  if (field === 'category') {
    for (const term of values) {
      if (!(CATEGORIES as readonly string[]).includes(term)) {
        reject(
          'invalid_enum',
          `${path}.value`,
          `${JSON.stringify(term)} is not a category. Valid categories: ${CATEGORIES.join(', ')}.`
        );
      }
    }
  }

  return { field, op, values };
}

function asTerm(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    reject('invalid_type', path, `${label(path)} must be a single text value.`);
  }
  if (value.trim() === '') {
    // A blank `contains` is `LIKE '%%'`, which matches everything — an
    // accidental "no filter" dressed as a filter.
    reject('invalid_value', path, `${label(path)} must not be empty.`);
  }
  if (value.length > MAX_FILTER_VALUE_LENGTH) {
    reject(
      'too_long',
      path,
      `${label(path)} must be at most ${MAX_FILTER_VALUE_LENGTH} characters.`
    );
  }
  return value;
}

function asTermList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    reject('invalid_type', path, `${label(path)} must be an array when \`op\` is \`in\`.`);
  }
  if (value.length === 0) {
    reject('invalid_value', path, `${label(path)} must list at least one value.`);
  }
  if (value.length > MAX_FILTER_VALUES) {
    reject(
      'too_many_items',
      path,
      `${label(path)} accepts at most ${MAX_FILTER_VALUES} values; ${value.length} were given.`
    );
  }
  return value.map((entry, index) => asTerm(entry, `${path}[${index}]`));
}

function buildQuery(
  walked: Record<string, unknown>,
  notes: string[],
  context: ValidationContext
): ValidatedQuery {
  const rawFilters = (walked.filters as Record<string, unknown>[] | undefined) ?? [];
  const filters = rawFilters.map((filter, index) => checkFilter(filter, `filters[${index}]`));

  let period: Period | null = null;
  const range = walked.time_range as { unit: TimeUnit; last: number } | undefined;
  if (range) {
    const resolved = resolveTimeRange(range.unit, range.last, context);
    period = resolved.period;
    notes.push(...resolved.notes);
  }

  return {
    metric: walked.metric as QueryMetric,
    // §14.1 makes `dimension` optional; "none" is the ungrouped case, so
    // defaulting here means `compile.ts` never sees an absent dimension.
    dimension: (walked.dimension as QueryDimension | undefined) ?? 'none',
    filters,
    sort: walked.sort as QuerySort | undefined,
    limit: walked.limit as number | undefined,
    period,
  };
}

function checkUpdate(walked: Record<string, unknown>): UpdateBillItemArgs {
  const set = walked.set as Record<string, unknown>;
  if (typeof set.name === 'string' && set.name.trim() === '') {
    reject('invalid_value', 'set.name', 'A line item cannot be renamed to nothing.');
  }
  return walked as unknown as UpdateBillItemArgs;
}

// ------------------------------------------------------------------ entry ---

function call(validated: ValidatedCall, notes: string[]): ValidationSuccess {
  return { ok: true, call: validated, notes };
}

/**
 * The single door into execution (§14.5, "applied before any execution").
 *
 * `name` and `rawArgs` are whatever the model produced — a `string` and an
 * `unknown`, never a narrowed type, because narrowing them in the signature
 * would move the unchecked assumption somewhere less visible.
 *
 * One row of §14.5 is not here: `bill_id` / `bill_item_id` not found. That
 * needs the database, and this module is deliberately pure so the adversarial
 * suite can run in Node with no fixture. The executor raises it with the same
 * `not_found` code, so the model sees one error vocabulary either way.
 */
export function validateToolCall(
  name: string,
  rawArgs: unknown,
  context: ValidationContext
): ValidationResult {
  const tool = toolByName(name);
  if (!tool) {
    return {
      ok: false,
      code: 'unknown_tool',
      path: '',
      message: `There is no tool called ${JSON.stringify(name)}.`,
    };
  }

  const notes: string[] = [];
  try {
    const walked = walkObject(tool.declaration.parameters, rawArgs ?? {}, '', notes);

    switch (tool.declaration.name) {
      case 'query_ledger':
        return call({ name: 'query_ledger', args: buildQuery(walked, notes, context) }, notes);
      case 'get_bill_detail':
        return call({ name: 'get_bill_detail', args: walked as unknown as GetBillDetailArgs }, notes);
      case 'update_bill_item':
        return call({ name: 'update_bill_item', args: checkUpdate(walked) }, notes);
      case 'delete_bill':
        return call({ name: 'delete_bill', args: walked as unknown as DeleteBillArgs }, notes);
    }
  } catch (error) {
    if (error instanceof Rejected) return error.rejection;
    throw error;
  }
}
