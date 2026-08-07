#!/usr/bin/env node
/**
 * Converts the Python prototype's parse output into `assets/receipts/corpus.json`.
 *
 * The prototype (`../PyPrototype/out`) emits, per receipt:
 *   <name>.gemini-image.parse.json   complete parsed record
 *   <name>.gemini-text.parse.json    same receipt via the OCR-then-LLM path
 *   <name>.gemini-*.compare.json     grading output, with curated `want` values
 *   <name>.raw.txt                   the OCR text
 *
 * We take the **image** parse as the record: §5.7 measured it at ~97.5% mean
 * field accuracy against ~96.3% for the text path, so it is the closer of the
 * two to ground truth. The `compare.json` files hold the curated `want` values
 * but only for a few header fields plus per-item field diffs, which is a
 * grading artefact rather than a reconstructable record.
 *
 * `raw.txt` becomes the bill's cached OCR text (§4.6), which is what lets a
 * receipt be re-parsed with a better prompt in Week 6 without re-scanning
 * paper that no longer exists.
 *
 * Run: node scripts/build-receipt-corpus.js
 */

const fs = require('node:fs');
const path = require('node:path');

const PROTOTYPE_OUT = path.resolve(__dirname, '../../PyPrototype/out');
const OUTPUT = path.resolve(__dirname, '../assets/receipts/corpus.json');

// Mirrors src/types/vocabulary.ts. Duplicated because this is plain Node with
// no TypeScript runner available — the fixture test re-checks these against the
// real vocabularies, so a drift cannot pass silently.
const CATEGORIES = new Set([
  'produce', 'dairy', 'meat', 'bakery', 'snacks', 'frozen',
  'pantry_staple', 'beverage', 'household', 'other',
]);
const UNITS = new Set(['pc', 'kg', 'g', 'l', 'ml', 'pack']);
const CONFIDENCE = new Set(['high', 'low']);

const problems = [];

function check(condition, message) {
  if (!condition) problems.push(message);
}

function readReceipt(slug) {
  const parsePath = path.join(PROTOTYPE_OUT, `${slug}.gemini-image.parse.json`);
  const rawPath = path.join(PROTOTYPE_OUT, `${slug}.raw.txt`);

  const parsed = JSON.parse(fs.readFileSync(parsePath, 'utf8'));
  const ocrText = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8').trim() : null;

  check(/^\d{4}-\d{2}-\d{2}$/.test(parsed.purchased_at), `${slug}: bad purchased_at`);
  check(parsed.total_cents == null || Number.isInteger(parsed.total_cents),
    `${slug}: total_cents is not an integer`);

  const items = (parsed.items ?? []).map((item, index) => {
    const where = `${slug} item ${index + 1}`;
    check(CATEGORIES.has(item.category), `${where}: unknown category "${item.category}"`);
    check(UNITS.has(item.unit ?? 'pc'), `${where}: unknown unit "${item.unit}"`);
    check(item.confidence == null || CONFIDENCE.has(item.confidence),
      `${where}: unknown confidence "${item.confidence}"`);
    check(item.price_cents == null || Number.isInteger(item.price_cents),
      `${where}: price_cents is not an integer`);

    return {
      name: item.name,
      nameLocal: item.name_local ?? null,
      category: item.category,
      isFood: item.is_food !== false,
      qty: item.qty ?? 1,
      unit: item.unit ?? 'pc',
      scanUnits: item.scan_units ?? 1,
      priceCents: item.price_cents ?? null,
      unitPriceCents: item.unit_price_cents ?? null,
      barcode: item.barcode ?? null,
      confidence: item.confidence ?? null,
    };
  });

  // `itemless` is the prototype's own flag for a receipt with nothing to
  // itemize honestly (§5.1) — a restaurant bill or service invoice.
  check(
    parsed.itemless === (items.length === 0),
    `${slug}: itemless=${parsed.itemless} but has ${items.length} items`
  );

  return {
    slug,
    merchant: parsed.merchant ?? null,
    merchantAddress: parsed.merchant_address ?? null,
    purchasedAt: parsed.purchased_at,
    purchasedTime: parsed.purchased_time ?? null,
    totalCents: parsed.total_cents ?? null,
    discountCents: parsed.discount_cents ?? 0,
    currency: parsed.currency ?? 'NZD',
    unitsSold: parsed.units_sold ?? null,
    source: 'receipt',
    // These were photographed and processed offline rather than scanned live,
    // so 'gallery' is the honest capture path (§4.7).
    capturePath: 'gallery',
    modelAlias: parsed._meta?.model ?? null,
    items,
    pages: ocrText ? [{ pageNo: 1, ocrText }] : [],
  };
}

const slugs = fs
  .readdirSync(PROTOTYPE_OUT)
  .filter((file) => file.endsWith('.gemini-image.parse.json'))
  .map((file) => file.replace('.gemini-image.parse.json', ''))
  .sort();

if (slugs.length === 0) {
  console.error(`No parse output found in ${PROTOTYPE_OUT}`);
  process.exit(1);
}

const bills = slugs.map(readReceipt).sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt));

if (problems.length > 0) {
  console.error('Corpus conversion found problems:\n  ' + problems.join('\n  '));
  process.exit(1);
}

const corpus = {
  // §15.1's envelope keys. The per-bill shape follows this project's domain
  // types rather than a finalised export contract — the real import/export
  // format is pinned in Week 9, and this fixture is a development seed.
  schema_version: 1,
  exported_at: new Date().toISOString(),
  source: 'PyPrototype gemini-image parses',
  bills,
};

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(corpus, null, 2) + '\n');

const itemCount = bills.reduce((sum, b) => sum + b.items.length, 0);
const withOcr = bills.filter((b) => b.pages.length > 0).length;
console.log(
  `Wrote ${path.relative(process.cwd(), OUTPUT)}: ` +
    `${bills.length} bills, ${itemCount} items, ${withOcr} with OCR text ` +
    `(${bills[0].purchasedAt} to ${bills[bills.length - 1].purchasedAt})`
);
