/**
 * `compile.ts` — the only module that knows column names (§14.6).
 *
 * It takes a spec that has already been through `validate.ts` and returns SQL
 * plus bound parameters. Everything variable is a `?`; the only strings
 * concatenated into the statement are the fixed fragments below, chosen by an
 * enum the validator has already restricted to a closed set. §14.6's
 * prohibition is absolute — "string interpolation into SQL is prohibited
 * anywhere in the codebase" — and this file is where it would be tempting.
 *
 * ## The itemless-bill rule, which is the reason this file is careful
 *
 * §5.1 makes a bill with no line items a normal outcome: a receipt whose total
 * was legible but whose items were not still belongs in the ledger. Such a
 * bill has **zero rows** in `bill_items`, so any query that reaches its total
 * by joining through `bill_items` drops it silently — no error, no empty
 * result, just a monthly total that is quietly low by exactly the itemless
 * bills, which is the kind of wrong a user cannot catch.
 *
 * So every query has a **grain**, and the grain picks the source:
 *
 *   bill grain   FROM bills, SUM(bills.total_cents). "How much did I spend
 *                in June" — every bill counts, itemised or not.
 *   item grain   FROM bill_items JOIN bills, SUM(bill_items.price_cents).
 *                "How much on meat" — only items have a category, so only
 *                items can answer it, and an itemless bill genuinely has no
 *                meat spend to contribute.
 *
 * A filter on an item column does *not* force a join when the question is
 * about bills: it becomes an `EXISTS` subquery instead. A join would multiply
 * a three-item bill into three rows and treble its total — the same
 * undercount problem wearing the opposite sign.
 */

import { MAX_LIMIT, type QueryDimension, type QueryMetric } from '@/agent/tools/queryLedger';
import type { ValidatedFilter, ValidatedQuery } from '@/agent/validate';
import type { SqlValue } from '@/data/driver';
import { normaliseMerchant } from '@/data/merchant';

/** How the executor should read the rows back. */
export type ResultShape = 'scalar' | 'groups' | 'bills' | 'items';

export interface CompiledQuery {
  sql: string;
  params: SqlValue[];
  shape: ResultShape;
  /** Whether the numbers came from item prices or from printed bill totals. */
  grain: Grain;
}

type Grain = 'bill' | 'item';

// ------------------------------------------------------------- fragments ---

const FROM_BILLS = 'FROM bills';
const FROM_ITEMS = 'FROM bill_items JOIN bills ON bills.id = bill_items.bill_id';

/**
 * `day` reads the column directly rather than through `strftime`. §14.6 groups
 * all three time dimensions by `strftime(...)`, but `purchased_at` is already
 * stored as `YYYY-MM-DD` (§4.3), so the function would only hide the index on
 * `bills(purchased_at)` behind an expression.
 *
 * `%W` counts Monday-based weeks, which is why `startOfWeek` in `dates.ts` is
 * Monday too: a window that disagreed with the grouping would put a bill
 * inside the range but in no bucket.
 */
const DIMENSION_SQL: Record<Exclude<QueryDimension, 'none'>, string> = {
  category: 'bill_items.category',
  merchant: 'bills.merchant_norm',
  month: "strftime('%Y-%m', bills.purchased_at)",
  week: "strftime('%Y-W%W', bills.purchased_at)",
  day: 'bills.purchased_at',
};

/**
 * LIKE treats `%` and `_` as wildcards, so a search for "50%" would otherwise
 * match anything beginning "50". The term is escaped as a *parameter value*,
 * never as SQL — the pattern itself stays `'%' || ? || '%'`.
 */
const LIKE_ESCAPE = '\\';
const LIKE_PATTERN = " LIKE '%' || ? || '%' ESCAPE '" + LIKE_ESCAPE + "'";

function likeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (character) => LIKE_ESCAPE + character);
}

function placeholders(count: number): string {
  return new Array(count).fill('?').join(', ');
}

// ----------------------------------------------------------------- grain ---

function isItemField(filter: ValidatedFilter): boolean {
  return filter.field === 'category' || filter.field === 'name';
}

/**
 * §14.6: item columns are needed when the *dimension* is `category`, or when a
 * filter names an item column. `list_bills` is the exception in both
 * directions — the question is about bills however it was narrowed, so the
 * item filters become `EXISTS` and the totals stay `bills.total_cents`.
 */
function grainOf(query: ValidatedQuery): Grain {
  if (query.metric === 'list_bills') return 'bill';
  if (query.metric === 'list_items') return 'item';
  if (query.dimension === 'category') return 'item';
  return query.filters.some(isItemField) ? 'item' : 'bill';
}

// ------------------------------------------------------------ predicates ---

interface Clause {
  sql: string;
  params: SqlValue[];
}

/**
 * A predicate that is false without referring to any column or value. Needed
 * because a merchant term can normalise away to nothing (§4.8 strips
 * punctuation), and an empty term is not a harmless one: `LIKE '%' || '' ||
 * '%'` matches *every* row, turning a filter the user asked for into no filter
 * at all. Structural SQL, so the "no user-supplied literals" property holds.
 */
const NEVER_MATCHES = '1 = 0';

function merchantClause(filter: ValidatedFilter): Clause {
  // Compared against `merchant_norm`, so the model's spelling is normalised
  // the same way the stored value was (§4.8) — "PAK'nSAVE" finds "paknsave",
  // and a search for "50%" finds the shop stored as "50 off store".
  const terms = filter.values
    .map((value) => normaliseMerchant(value))
    .filter((term): term is string => term !== null);

  if (terms.length === 0) return { sql: NEVER_MATCHES, params: [] };

  if (filter.op === 'contains') {
    return { sql: 'bills.merchant_norm' + LIKE_PATTERN, params: [likeTerm(terms[0])] };
  }
  if (filter.op === 'in') {
    return { sql: 'bills.merchant_norm IN (' + placeholders(terms.length) + ')', params: terms };
  }
  return { sql: 'bills.merchant_norm = ?', params: [terms[0]] };
}

function categoryClause(filter: ValidatedFilter, prefix: string): Clause {
  // `contains` was rejected in `validate.ts`: a closed vocabulary is matched,
  // not searched.
  if (filter.op === 'in') {
    return {
      sql: prefix + '.category IN (' + placeholders(filter.values.length) + ')',
      params: [...filter.values],
    };
  }
  return { sql: prefix + '.category = ?', params: [filter.values[0]] };
}

/**
 * §14.6, §4.7: `name` is matched against **both** `name` and `name_local`, so
 * a query for `豆腐干` finds the row whose English `name` is "dried tofu".
 * Half-implementing this is easy and silent — the English half keeps working.
 */
function nameClause(filter: ValidatedFilter, prefix: string): Clause {
  if (filter.op === 'contains') {
    const term = likeTerm(filter.values[0]);
    return {
      sql: '(' + prefix + '.name' + LIKE_PATTERN + ' OR ' + prefix + '.name_local' + LIKE_PATTERN + ')',
      params: [term, term],
    };
  }
  if (filter.op === 'in') {
    const slots = placeholders(filter.values.length);
    return {
      sql:
        '(' + prefix + '.name IN (' + slots + ') OR ' + prefix + '.name_local IN (' + slots + '))',
      params: [...filter.values, ...filter.values],
    };
  }
  return {
    sql: '(' + prefix + '.name = ? OR ' + prefix + '.name_local = ?)',
    params: [filter.values[0], filter.values[0]],
  };
}

function itemClause(filter: ValidatedFilter, prefix: string): Clause {
  return filter.field === 'category'
    ? categoryClause(filter, prefix)
    : nameClause(filter, prefix);
}

const EXISTS_ALIAS = 'fi';

/**
 * An item filter on a bill-grain query.
 *
 * `EXISTS` rather than a join, because a join would return one row per
 * matching item and `SUM(bills.total_cents)` would then add the same bill's
 * total once per item it contains.
 */
function existsClause(filter: ValidatedFilter): Clause {
  const inner = itemClause(filter, EXISTS_ALIAS);
  return {
    sql:
      'EXISTS (SELECT 1 FROM bill_items ' +
      EXISTS_ALIAS +
      ' WHERE ' +
      EXISTS_ALIAS +
      '.bill_id = bills.id AND ' +
      inner.sql +
      ')',
    params: inner.params,
  };
}

function whereClauses(query: ValidatedQuery, grain: Grain): Clause[] {
  const clauses: Clause[] = [];

  if (query.period) {
    clauses.push({
      sql: 'bills.purchased_at BETWEEN ? AND ?',
      params: [query.period.from, query.period.to],
    });
  }

  for (const filter of query.filters) {
    if (filter.field === 'merchant') {
      clauses.push(merchantClause(filter));
    } else if (grain === 'item') {
      clauses.push(itemClause(filter, 'bill_items'));
    } else {
      clauses.push(existsClause(filter));
    }
  }

  return clauses;
}

// ------------------------------------------------------------- projection ---

/**
 * `COALESCE` on the sum but not on the average, following `insightsRepo`:
 * spending nothing is genuinely zero, whereas the average of no bills is
 * unknown and rendering it as $0.00 would be a small lie.
 */
function aggregate(metric: QueryMetric, grain: Grain): string {
  const column = grain === 'item' ? 'bill_items.price_cents' : 'bills.total_cents';
  switch (metric) {
    case 'sum_amount':
      return 'COALESCE(SUM(' + column + '), 0)';
    case 'avg_amount':
      return 'AVG(' + column + ')';
    default:
      return 'COUNT(*)';
  }
}

const BILL_COLUMNS =
  'bills.id AS id, bills.merchant AS merchant, bills.purchased_at AS purchased_at, ' +
  'bills.total_cents AS total_cents, bills.currency AS currency';

const ITEM_COLUMNS =
  'bill_items.id AS id, bill_items.bill_id AS bill_id, bill_items.name AS name, ' +
  'bill_items.name_local AS name_local, bill_items.category AS category, ' +
  'bill_items.qty AS qty, bill_items.unit AS unit, bill_items.price_cents AS price_cents, ' +
  'bills.purchased_at AS purchased_at, bills.merchant AS merchant';

function shapeOf(query: ValidatedQuery): ResultShape {
  if (query.metric === 'list_bills') return 'bills';
  if (query.metric === 'list_items') return 'items';
  return query.dimension === 'none' ? 'scalar' : 'groups';
}

/**
 * Ordering always ends in a unique column, so two runs of the same query
 * return the same rows in the same order — otherwise a `limit` would silently
 * pick a different arbitrary slice each time it was asked.
 */
function orderBy(query: ValidatedQuery, shape: ResultShape): string | null {
  const sort = query.sort;
  const ascending = sort === 'amount_asc' || sort === 'date_asc';
  const direction = ascending ? 'ASC' : 'DESC';
  const byDate = sort === 'date_desc' || sort === 'date_asc';

  switch (shape) {
    case 'scalar':
      return null;
    case 'groups':
      // A date sort over month/week/day buckets is chronological; over
      // category or merchant buckets it is alphabetical, which is the only
      // reading "by date" can have when the axis is not time.
      return byDate
        ? 'ORDER BY bucket ' + direction
        : 'ORDER BY value ' + direction + ', bucket ASC';
    case 'bills':
      return byDate || sort === undefined
        ? 'ORDER BY bills.purchased_at ' + direction + ', bills.id DESC'
        : 'ORDER BY bills.total_cents ' + direction + ', bills.id DESC';
    case 'items':
      return byDate || sort === undefined
        ? 'ORDER BY bills.purchased_at ' + direction + ', bill_items.id DESC'
        : 'ORDER BY bill_items.price_cents ' + direction + ', bill_items.id DESC';
  }
}

// ------------------------------------------------------------------ entry ---

/**
 * Compiles a validated spec into a parameterised statement.
 *
 * The argument is a `ValidatedQuery`, not the model's arguments — the type is
 * the boundary §14.5 describes, and nothing that has not been through
 * `validate.ts` can be constructed to fit it.
 */
export function compileQuery(query: ValidatedQuery): CompiledQuery {
  const grain = grainOf(query);
  const shape = shapeOf(query);
  const params: SqlValue[] = [];
  const parts: string[] = [];

  if (shape === 'bills') {
    parts.push('SELECT ' + BILL_COLUMNS);
  } else if (shape === 'items') {
    parts.push('SELECT ' + ITEM_COLUMNS);
  } else if (shape === 'groups') {
    const dimension = DIMENSION_SQL[query.dimension as Exclude<QueryDimension, 'none'>];
    parts.push('SELECT ' + dimension + ' AS bucket, ' + aggregate(query.metric, grain) + ' AS value');
  } else {
    parts.push('SELECT ' + aggregate(query.metric, grain) + ' AS value');
  }

  parts.push(grain === 'item' ? FROM_ITEMS : FROM_BILLS);

  const clauses = whereClauses(query, grain);
  if (clauses.length > 0) {
    parts.push('WHERE ' + clauses.map((clause) => clause.sql).join(' AND '));
    for (const clause of clauses) params.push(...clause.params);
  }

  if (shape === 'groups') parts.push('GROUP BY bucket');

  const ordering = orderBy(query, shape);
  if (ordering) parts.push(ordering);

  // A missing `limit` is not "no limit": an unbounded `list_items` would put
  // thousands of rows into the next prompt. §14.1 caps the model's own limit
  // at 50, so 50 is also the right ceiling when it did not ask for one.
  if (shape !== 'scalar') {
    parts.push('LIMIT ?');
    params.push(Math.min(query.limit ?? MAX_LIMIT, MAX_LIMIT));
  }

  return { sql: parts.join(' '), params, shape, grain };
}
