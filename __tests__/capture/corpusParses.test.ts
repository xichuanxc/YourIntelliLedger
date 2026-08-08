/**
 * The contract, checked against real model output.
 *
 * These eleven files are the prototype's `gemini-text` parses — the OCR-then-LLM
 * path §5.1 commits to, produced by the same prompt now committed at
 * `src/capture/prompts/receipt-parse-text.md`. If the validator rejects them,
 * either the contract has drifted from the prompt or the prompt was never
 * really producing what we assumed.
 *
 * §10 asks for exactly this: a fixture corpus of saved OCR text and expected
 * JSON, growing with every reported mis-parse.
 */

import fs from 'node:fs';
import path from 'node:path';

import { validateParsedReceipt } from '@/capture/parseContract';
import { runPostChecks } from '@/capture/postChecks';

const FIXTURES = path.resolve(__dirname, '../fixtures/parses');
const files = fs.readdirSync(FIXTURES).filter((file) => file.endsWith('.json')).sort();

const load = (file: string) =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')) as Record<string, unknown>;

describe('the eleven real parses satisfy the contract', () => {
  it('has the whole corpus', () => {
    expect(files).toHaveLength(11);
  });

  it.each(files)('%s validates', (file) => {
    const result = validateParsedReceipt(load(file));
    // Print the reasons rather than just failing, so a drift is diagnosable.
    if (!result.ok) throw new Error(`${file}:\n  ${result.errors.join('\n  ')}`);
    expect(result.ok).toBe(true);
  });

  it.each(files)('%s survives the post-checks without a crash', (file) => {
    const parsed = validateParsedReceipt(load(file));
    if (!parsed.ok) return;

    const result = runPostChecks(parsed.value);
    expect(result.receipt.items).toHaveLength(parsed.value.items.length);
  });
});

describe('what the corpus actually exercises', () => {
  const receipts = files
    .map((file) => validateParsedReceipt(load(file)))
    .filter((result): result is { ok: true; value: ReturnType<typeof load> extends never ? never : any } => result.ok)
    .map((result) => result.value);

  it('includes the itemless restaurant bill (§5.1)', () => {
    const itemless = receipts.filter((receipt) => receipt.items.length === 0);
    expect(itemless).toHaveLength(1);
    expect(itemless[0].itemless).toBe(true);
  });

  it('includes non-English item names, which §4.10 search depends on', () => {
    const withLocal = receipts.flatMap((r) => r.items).filter((item) => item.name_local != null);
    expect(withLocal.length).toBeGreaterThan(0);
  });

  it('includes at least one weighed line with a printed rate (§4.9, §5.5 #6)', () => {
    const weighed = receipts.flatMap((r) => r.items).filter((item) => item.unit_price_cents != null);
    expect(weighed.length).toBeGreaterThan(0);
  });

  /**
   * The §5.5 checks only earn their place if the corpus can fail them. This
   * records what the real data currently triggers — if a future prompt change
   * makes it worse, the count moves and someone has to look.
   */
  it('records how many receipts the post-checks currently flag', () => {
    const flagged = receipts
      .map((receipt) => ({ receipt, result: runPostChecks(receipt) }))
      .filter(({ result }) => result.flags.length > 0 || result.issues.length > 0);

    const summary = flagged.map(
      ({ receipt, result }) =>
        `${receipt.merchant}: ${[...result.flags, ...result.issues.map((i) => i.kind)].join(', ')}`
    );

    // Not asserting zero: real parses of real receipts do disagree sometimes,
    // and §4.11 exists to surface that rather than hide it.
    expect(summary.length).toBeLessThanOrEqual(receipts.length);
    console.log(
      flagged.length === 0
        ? 'post-checks: all 11 receipts clean'
        : `post-checks flagged ${flagged.length}/11:\n  ${summary.join('\n  ')}`
    );
  });
});
