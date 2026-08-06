/**
 * Closed vocabularies — spec §4.7.
 *
 * This file is the single source of truth shared by the SQLite `CHECK`
 * constraints (§4.4), the receipt-parsing prompt (§5), the query validator
 * (§14.5), the data catalog (§6.3) and the UI filters. Changing a vocabulary
 * requires a migration *and* a prompt update in the same commit.
 *
 * The arrays are the primary artefact; the types are derived from them, so a
 * value can never exist in the type but not at runtime.
 */

export const CATEGORIES = [
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
] as const;
export type Category = (typeof CATEGORIES)[number];

export const UNITS = ['pc', 'kg', 'g', 'l', 'ml', 'pack'] as const;
export type Unit = (typeof UNITS)[number];

export const SOURCES = ['manual', 'receipt', 'barcode'] as const;
export type Source = (typeof SOURCES)[number];

/** NULL for manually entered bills — there was no capture. */
export const CAPTURE_PATHS = ['scanner', 'camera', 'gallery'] as const;
export type CapturePath = (typeof CAPTURE_PATHS)[number];

export const CONFIDENCE_LEVELS = ['high', 'low'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/** Integrity-check outcomes recorded in `bills.parse_flags` (§4.11). */
export const PARSE_FLAGS = [
  'sum_mismatch',
  'unit_mismatch',
  'low_confidence',
  'missing_price',
] as const;
export type ParseFlag = (typeof PARSE_FLAGS)[number];

export const QUERY_ROUTES = ['fastpath', 'agent'] as const;
export type QueryRoute = (typeof QUERY_ROUTES)[number];

export const QUERY_OUTCOMES = ['ok', 'retry', 'fallback', 'error'] as const;
export type QueryOutcome = (typeof QUERY_OUTCOMES)[number];

/** Human-readable labels for the UI. Keys are exhaustive by construction. */
export const CATEGORY_LABELS: Record<Category, string> = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Meat',
  bakery: 'Bakery',
  snacks: 'Snacks',
  frozen: 'Frozen',
  pantry_staple: 'Pantry staple',
  beverage: 'Beverage',
  household: 'Household',
  other: 'Other',
};

export const UNIT_LABELS: Record<Unit, string> = {
  pc: 'pc',
  kg: 'kg',
  g: 'g',
  l: 'L',
  ml: 'mL',
  pack: 'pack',
};

export const PARSE_FLAG_LABELS: Record<ParseFlag, string> = {
  sum_mismatch: "Items don't add up to the printed total",
  unit_mismatch: "Unit count doesn't match the printed total",
  low_confidence: 'Some lines were read with low confidence',
  missing_price: 'Some prices were illegible',
};

/** Narrowing helper — `includes` on a readonly tuple is otherwise too strict. */
function memberOf<T extends readonly string[]>(values: T) {
  return (value: unknown): value is T[number] =>
    typeof value === 'string' && (values as readonly string[]).includes(value);
}

export const isCategory = memberOf(CATEGORIES);
export const isUnit = memberOf(UNITS);
export const isSource = memberOf(SOURCES);
export const isCapturePath = memberOf(CAPTURE_PATHS);
export const isConfidence = memberOf(CONFIDENCE_LEVELS);
export const isParseFlag = memberOf(PARSE_FLAGS);
