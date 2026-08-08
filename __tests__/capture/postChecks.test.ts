import fs from 'node:fs';
import path from 'node:path';

import { extractJson, validateParsedReceipt, type ParsedItem } from '@/capture/parseContract';
import { isValidGtin, runPostChecks, weighedItemMatches } from '@/capture/postChecks';
import { CATEGORIES, UNITS } from '@/types/vocabulary';

const item = (overrides: Partial<ParsedItem> = {}): ParsedItem => ({
  name: 'Milk',
  name_local: null,
  category: 'dairy',
  is_food: true,
  qty: 1,
  unit: 'pc',
  scan_units: 1,
  price_cents: 500,
  unit_price_cents: null,
  barcode: null,
  confidence: 'high',
  ...overrides,
});

const receipt = (items: ParsedItem[], overrides = {}) => ({
  merchant: 'New World',
  merchant_address: null,
  purchased_at: '2026-07-05',
  purchased_time: null,
  currency: 'NZD',
  total_cents: items.reduce((sum, i) => sum + (i.price_cents ?? 0), 0),
  discount_cents: 0,
  units_sold: null,
  itemless: items.length === 0,
  items,
  ...overrides,
});

describe('isValidGtin (§5.5 #4)', () => {
  it('accepts real barcodes', () => {
    expect(isValidGtin('9421905301534')).toBe(true); // EAN-13
    expect(isValidGtin('012345678905')).toBe(true); // UPC-A
    expect(isValidGtin('96385074')).toBe(true); // EAN-8
  });

  it('rejects a wrong check digit', () => {
    expect(isValidGtin('9421905301535')).toBe(false);
    expect(isValidGtin('012345678901')).toBe(false);
  });

  it('rejects lengths that are not a GTIN', () => {
    expect(isValidGtin('12345')).toBe(false);
    expect(isValidGtin('123456789012345')).toBe(false);
  });

  it('rejects non-digits, which OCR produces often', () => {
    expect(isValidGtin('94219O5301534')).toBe(false); // letter O for zero
    expect(isValidGtin('')).toBe(false);
    expect(isValidGtin('9421-9053-0153')).toBe(false);
  });
});

describe('weighedItemMatches (§5.5 #6)', () => {
  it('passes when the printed rate reproduces the line price', () => {
    // BANANAS 0.670 kg @ $3.65/kg = 244.55c, printed as 245c.
    expect(weighedItemMatches(item({ qty: 0.67, unit: 'kg', unit_price_cents: 365, price_cents: 245 }))).toBe(true);
  });

  it('fails when the arithmetic does not work', () => {
    expect(weighedItemMatches(item({ qty: 0.67, unit: 'kg', unit_price_cents: 365, price_cents: 900 }))).toBe(false);
  });

  it('has nothing to check when no rate was printed (§4.9)', () => {
    // A rate is never derived by dividing price by qty, so absence is not failure.
    expect(weighedItemMatches(item({ qty: 3, unit_price_cents: null, price_cents: 999 }))).toBe(true);
  });

  it('has nothing to check when the price was illegible', () => {
    expect(weighedItemMatches(item({ qty: 0.5, unit_price_cents: 365, price_cents: null }))).toBe(true);
  });
});

describe('runPostChecks', () => {
  it('discards a barcode that fails its check digit and drops confidence', () => {
    const result = runPostChecks(receipt([item({ barcode: '9421905301535' })]));

    expect(result.receipt.items[0].barcode).toBeNull();
    expect(result.receipt.items[0].confidence).toBe('low');
    expect(result.issues[0].kind).toBe('invalid_barcode');
    // Dropping confidence must show up on the bill.
    expect(result.flags).toContain('low_confidence');
  });

  it('keeps a valid barcode untouched', () => {
    const result = runPostChecks(receipt([item({ barcode: '9421905301534' })]));
    expect(result.receipt.items[0].barcode).toBe('9421905301534');
    expect(result.issues).toHaveLength(0);
  });

  it('flags a weighed line whose rate does not reconcile', () => {
    const result = runPostChecks(
      receipt([item({ qty: 0.67, unit: 'kg', unit_price_cents: 365, price_cents: 900 })], {
        total_cents: 900,
      })
    );
    expect(result.issues[0].kind).toBe('rate_mismatch');
    expect(result.receipt.items[0].confidence).toBe('low');
  });

  it('never rewrites the numbers — only flags them', () => {
    const original = receipt([item({ price_cents: 500 })], { total_cents: 9999 });
    const result = runPostChecks(original);

    expect(result.flags).toContain('sum_mismatch');
    // The total is left exactly as parsed; §5.6 shows the user, §4.11 records it.
    expect(result.receipt.total_cents).toBe(9999);
    expect(result.receipt.items[0].price_cents).toBe(500);
  });

  it('skips the sum check for an itemless bill (§5.1, §5.5)', () => {
    const result = runPostChecks(receipt([], { total_cents: 15140, itemless: true }));
    expect(result.flags).toEqual([]);
    expect(result.issues).toEqual([]);
  });
});

/**
 * The prompt embeds the §4.7 vocabularies as prose. If a migration changed a
 * category list and the prompt were not updated in the same commit — which §4.7
 * requires — the model would keep emitting values the database rejects.
 */
describe('the parsing prompt agrees with the code', () => {
  const prompt = fs.readFileSync(
    path.resolve(__dirname, '../../src/capture/prompts/receipt-parse-text.md'),
    'utf8'
  );

  it('lists exactly the categories in src/types/vocabulary.ts', () => {
    for (const category of CATEGORIES) {
      expect(prompt).toContain(category);
    }
  });

  it('lists exactly the units in src/types/vocabulary.ts', () => {
    const unitsSection = /`unit`:([^\n]*(?:\n[^\n#]*)*)/.exec(prompt)?.[1] ?? '';
    for (const unit of UNITS) {
      expect(unitsSection).toContain(`\`${unit}\``);
    }
  });

  it('states the integer-cents rule the schema depends on (§4.3)', () => {
    expect(prompt).toMatch(/integer cents/i);
  });
});

describe('extractJson', () => {
  it('reads a bare JSON object', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('reads JSON out of a fenced block, which models emit often', () => {
    expect(extractJson('Here you go:\n```json\n{"a":1}\n```\n')).toEqual({ a: 1 });
  });

  it('reads JSON surrounded by prose', () => {
    expect(extractJson('Sure! {"a":1} Hope that helps.')).toEqual({ a: 1 });
  });

  it('throws when there is no object at all', () => {
    expect(() => extractJson('I could not read that receipt.')).toThrow(SyntaxError);
  });
});

describe('validateParsedReceipt (§5.5 #1)', () => {
  const valid = receipt([item()]);

  it('accepts a well-formed receipt', () => {
    const result = validateParsedReceipt(valid);
    expect(result.ok).toBe(true);
  });

  it('reports every problem at once, so the single retry is not wasted', () => {
    const result = validateParsedReceipt({
      ...valid,
      purchased_at: 'yesterday',
      total_cents: 12.5,
      items: [{ ...item(), category: 'vegetables', price_cents: -100 }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.join(' ')).toMatch(/purchased_at/);
    expect(result.errors.join(' ')).toMatch(/total_cents/);
    expect(result.errors.join(' ')).toMatch(/category/);
  });

  it('names the valid values when an enum is wrong', () => {
    const result = validateParsedReceipt({ ...valid, items: [{ ...item(), category: 'veg' }] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toContain('pantry_staple');
  });

  it('rejects a decimal amount, the mistake the prompt warns about most', () => {
    const result = validateParsedReceipt({ ...valid, total_cents: 6.39 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/639/);
  });

  it('accepts an itemless receipt with an empty array', () => {
    const result = validateParsedReceipt(receipt([], { total_cents: 15140, itemless: true }));
    expect(result.ok).toBe(true);
  });

  it('rejects itemless:true alongside items', () => {
    const result = validateParsedReceipt({ ...receipt([item()]), itemless: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(' ')).toMatch(/itemless/);
  });

  it('defaults the optional fields the prompt allows to omit', () => {
    const result = validateParsedReceipt({
      purchased_at: '2026-07-05',
      items: [{ name: 'Milk', category: 'dairy' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.currency).toBe('NZD');
    expect(result.value.discount_cents).toBe(0);
    expect(result.value.items[0].qty).toBe(1);
    expect(result.value.items[0].unit).toBe('pc');
    expect(result.value.items[0].scan_units).toBe(1);
    expect(result.value.items[0].confidence).toBe('high');
  });

  it('rejects a non-object reply', () => {
    expect(validateParsedReceipt('sorry').ok).toBe(false);
    expect(validateParsedReceipt(null).ok).toBe(false);
  });
});
