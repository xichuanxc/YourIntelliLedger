/**
 * The `parse_receipt` JSON contract and its validator — spec §5.5 check 1.
 *
 * This is the shape `src/capture/prompts/receipt-parse-text.md` asks the model
 * for. The prompt and this file have to agree, so a test asserts the prompt's
 * embedded §4.7 vocabularies match `src/types/vocabulary.ts` — otherwise a
 * migration could change a category list and leave the prompt asking for values
 * the database would reject.
 *
 * §5.5 gives a rejected parse **one retry, with the error message**, then falls
 * back to manual entry. So the messages here are written for the model to act
 * on: which field, what was wrong, what was expected.
 *
 * Field names stay snake_case, matching the prompt and the prototype's output.
 * They are converted to the domain's camelCase at the boundary, in `toNewBill`.
 */

import {
  CATEGORIES,
  CONFIDENCE_LEVELS,
  UNITS,
  isCategory,
  isConfidence,
  isUnit,
  type Category,
  type Confidence,
  type Unit,
} from '@/types/vocabulary';
import { isValidLocalDate, isValidLocalTime } from '@/data/dates';

export interface ParsedItem {
  name: string;
  name_local: string | null;
  category: Category;
  is_food: boolean;
  qty: number;
  unit: Unit;
  scan_units: number;
  price_cents: number | null;
  unit_price_cents: number | null;
  barcode: string | null;
  confidence: Confidence;
}

export interface ParsedReceipt {
  merchant: string | null;
  merchant_address: string | null;
  purchased_at: string;
  purchased_time: string | null;
  currency: string;
  total_cents: number | null;
  discount_cents: number;
  units_sold: number | null;
  /** True only for a genuine non-goods receipt worth recording (§5.1). */
  itemless: boolean;
  items: ParsedItem[];
}

export type ValidationResult =
  | { ok: true; value: ParsedReceipt }
  | { ok: false; errors: string[] };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === 'string';
}

function integerOrNull(value: unknown): value is number | null | undefined {
  return value === null || value === undefined || Number.isInteger(value);
}

/**
 * Parses the model's reply into a `ParsedReceipt`, or returns every problem at
 * once.
 *
 * All errors, not just the first: the model gets one retry, so telling it about
 * a single bad field only to reject the next attempt for a different one wastes
 * the retry.
 */
export function validateParsedReceipt(raw: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isObject(raw)) {
    return { ok: false, errors: ['Response must be a JSON object.'] };
  }

  if (!optionalString(raw.merchant)) errors.push('`merchant` must be a string or null.');
  if (!optionalString(raw.merchant_address)) {
    errors.push('`merchant_address` must be a string or null.');
  }

  if (typeof raw.purchased_at !== 'string' || !isValidLocalDate(raw.purchased_at)) {
    errors.push('`purchased_at` must be a real calendar date in the form YYYY-MM-DD.');
  }
  if (
    raw.purchased_time !== null &&
    raw.purchased_time !== undefined &&
    (typeof raw.purchased_time !== 'string' || !isValidLocalTime(raw.purchased_time))
  ) {
    errors.push('`purchased_time` must be 24-hour HH:MM, or null.');
  }

  if (raw.currency !== undefined && typeof raw.currency !== 'string') {
    errors.push('`currency` must be a 3-letter ISO 4217 string.');
  }

  if (!integerOrNull(raw.total_cents)) {
    errors.push('`total_cents` must be an integer number of cents, or null. $6.39 is 639.');
  }
  if (raw.discount_cents !== undefined && !Number.isInteger(raw.discount_cents)) {
    errors.push('`discount_cents` must be an integer number of cents.');
  }
  if ((raw.discount_cents as number) < 0) {
    errors.push('`discount_cents` must not be negative; it is subtracted from the total.');
  }
  if (!integerOrNull(raw.units_sold)) {
    errors.push('`units_sold` must be an integer, or null when the receipt prints none.');
  }

  if (raw.itemless !== undefined && typeof raw.itemless !== 'boolean') {
    errors.push('`itemless` must be true or false.');
  }

  if (!Array.isArray(raw.items)) {
    errors.push('`items` must be an array; use [] for a receipt with nothing to itemise.');
    return { ok: false, errors };
  }

  const items = raw.items.map((item, index) => validateItem(item, index, errors));

  // §5.1: `itemless` is a claim about the receipt, so it has to match reality.
  const itemless = raw.itemless === true;
  if (itemless && items.length > 0) {
    errors.push('`itemless` is true but `items` is not empty. Set one or the other.');
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      merchant: (raw.merchant as string | null) ?? null,
      merchant_address: (raw.merchant_address as string | null) ?? null,
      purchased_at: raw.purchased_at as string,
      purchased_time: (raw.purchased_time as string | null) ?? null,
      currency: (raw.currency as string) ?? 'NZD',
      total_cents: (raw.total_cents as number | null) ?? null,
      discount_cents: (raw.discount_cents as number) ?? 0,
      units_sold: (raw.units_sold as number | null) ?? null,
      itemless,
      items: items as ParsedItem[],
    },
  };
}

function validateItem(raw: unknown, index: number, errors: string[]): Partial<ParsedItem> {
  const where = `items[${index}]`;

  if (!isObject(raw)) {
    errors.push(`${where} must be an object.`);
    return {};
  }

  if (typeof raw.name !== 'string' || raw.name.trim() === '') {
    errors.push(`${where}.name must be a non-empty string.`);
  }
  if (!optionalString(raw.name_local)) {
    errors.push(`${where}.name_local must be a string or null.`);
  }

  if (!isCategory(raw.category)) {
    errors.push(
      `${where}.category must be one of: ${CATEGORIES.join(', ')}. Use "other" if nothing fits.`
    );
  }
  if (!isUnit(raw.unit ?? 'pc')) {
    errors.push(`${where}.unit must be one of: ${UNITS.join(', ')}. Use "pc" if nothing fits.`);
  }
  if (raw.confidence !== undefined && !isConfidence(raw.confidence)) {
    errors.push(`${where}.confidence must be one of: ${CONFIDENCE_LEVELS.join(', ')}.`);
  }

  if (raw.is_food !== undefined && typeof raw.is_food !== 'boolean') {
    errors.push(`${where}.is_food must be true or false.`);
  }
  if (raw.qty !== undefined && (typeof raw.qty !== 'number' || !Number.isFinite(raw.qty) || raw.qty < 0)) {
    errors.push(`${where}.qty must be a number of zero or more.`);
  }
  if (raw.scan_units !== undefined && !Number.isInteger(raw.scan_units)) {
    errors.push(`${where}.scan_units must be an integer count of till-scanned units.`);
  }

  if (!integerOrNull(raw.price_cents)) {
    errors.push(`${where}.price_cents must be an integer number of cents, or null if illegible.`);
  }
  if (typeof raw.price_cents === 'number' && raw.price_cents < 0) {
    errors.push(
      `${where}.price_cents must not be negative; subtract any per-item discount before emitting.`
    );
  }
  if (!integerOrNull(raw.unit_price_cents)) {
    errors.push(`${where}.unit_price_cents must be an integer number of cents, or null.`);
  }

  if (raw.barcode !== undefined && raw.barcode !== null && typeof raw.barcode !== 'string') {
    errors.push(`${where}.barcode must be a string of digits, or null.`);
  }

  return {
    name: typeof raw.name === 'string' ? raw.name.trim() : '',
    name_local: (raw.name_local as string | null) ?? null,
    category: raw.category as Category,
    is_food: raw.is_food !== false,
    qty: (raw.qty as number) ?? 1,
    unit: ((raw.unit as Unit) ?? 'pc') as Unit,
    scan_units: (raw.scan_units as number) ?? 1,
    price_cents: (raw.price_cents as number | null) ?? null,
    unit_price_cents: (raw.unit_price_cents as number | null) ?? null,
    barcode: (raw.barcode as string | null) ?? null,
    confidence: (raw.confidence as Confidence) ?? 'high',
  };
}

/**
 * Extracts the JSON object from a model reply.
 *
 * Models wrap JSON in prose or fenced code blocks often enough that failing on
 * it would burn the single retry on a formatting quirk rather than a real
 * disagreement about the receipt.
 */
export function extractJson(reply: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(reply);
  const candidate = fenced ? fenced[1] : reply;

  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new SyntaxError('No JSON object found in the response.');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}
