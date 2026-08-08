#!/usr/bin/env node
/**
 * Generates a TypeScript module from the parsing prompt.
 *
 * The prompt stays markdown because it is a document people edit and review —
 * a 240-line template literal would be worse in every way. But Metro cannot
 * import `.md` as a module, so the bundled form is generated here with
 * `JSON.stringify`, which escapes the backticks and `${}` the prompt is full of.
 *
 * `receipt-parse-text.md` is the source of truth. A test asserts the generated
 * file still matches it, so editing the markdown without regenerating fails
 * loudly instead of shipping a stale prompt.
 *
 * Run: npm run prompt:build
 */

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.resolve(__dirname, '../src/capture/prompts/receipt-parse-text.md');
const OUTPUT = path.resolve(__dirname, '../src/capture/prompts/receiptParseText.ts');

const markdown = fs.readFileSync(SOURCE, 'utf8');

const contents = `/**
 * GENERATED — do not edit.
 *
 * Source: src/capture/prompts/receipt-parse-text.md
 * Regenerate: npm run prompt:build
 */

export const RECEIPT_PARSE_PROMPT = ${JSON.stringify(markdown)};
`;

fs.writeFileSync(OUTPUT, contents);
console.log(
  `Wrote ${path.relative(process.cwd(), OUTPUT)} (${markdown.length} chars, ` +
    `${markdown.split('\n').length} lines)`
);
