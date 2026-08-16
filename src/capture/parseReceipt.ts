/**
 * `parse_receipt` — spec §5.1, §5.5.
 *
 *     raw text → model → JSON → validate → (one retry) → post-checks → review
 *
 * §5.5 is precise about the retry: **one**, carrying the validation errors, and
 * then fall back to manual entry. Not a loop. A model that cannot produce the
 * schema twice will not produce it on the fifth attempt either, and the user is
 * waiting.
 *
 * Nothing here writes to the database. §5.6 is explicit that nothing is stored
 * before the user confirms, so this returns a candidate and stops.
 */

import { RECEIPT_PARSE_PROMPT } from '@/capture/prompts/receiptParseText';
import { extractJson, validateParsedReceipt, type ParsedReceipt } from '@/capture/parseContract';
import { enrichWithProductData, type EnrichmentResult } from '@/capture/enrichBarcodes';
import { runPostChecks, type ItemIssue } from '@/capture/postChecks';
import type { ParseImage, ParseTransport } from '@/agent/parseTransport';
import type { ParseFlag } from '@/types/vocabulary';

export interface ParseOutcome {
  receipt: ParsedReceipt;
  flags: ParseFlag[];
  issues: ItemIssue[];
  /** Items whose name or category Open Food Facts changed (§5.5 check 5). */
  enrichedIndices: number[];
  modelAlias: string;
  /** True when the first attempt was rejected and the retry succeeded. */
  retried: boolean;
  durationMs: number;
  /**
   * Token counts from the provider, when it reports them. Kept because output
   * length is what dominates parse latency — a receipt's JSON is far longer
   * than its text, so a slow parse is usually generation, not upload.
   */
  usage?: { promptTokens?: number; completionTokens?: number; thoughtTokens?: number };
}

/** Raised when both attempts fail; §5.5 then falls back to manual entry. */
export class ParseFailedError extends Error {
  constructor(
    message: string,
    readonly attempts: string[][]
  ) {
    super(message);
    this.name = 'ParseFailedError';
  }
}

export interface ParseOptions {
  /** Overridable so tests can supply the prompt without the Metro asset loader. */
  prompt?: string;
  /**
   * Page photographs, when the user has opted into vision parsing. Passed
   * straight through: this module orchestrates retries and validation and has
   * no opinion about what the transport puts on the wire.
   */
  images?: readonly ParseImage[];
  /**
   * §5.5 check 5. Injected in tests, so no test reaches Open Food Facts.
   */
  enrich?: (receipt: ParsedReceipt) => Promise<EnrichmentResult>;
}

export async function parseReceipt(
  transport: ParseTransport,
  ocrText: string,
  options: ParseOptions = {}
): Promise<ParseOutcome> {
  const prompt = options.prompt ?? RECEIPT_PARSE_PROMPT;
  const startedAt = Date.now();
  const attempts: string[][] = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await transport.parseReceipt({
      prompt,
      ocrText,
      images: options.images,
      priorErrors: attempt === 0 ? undefined : attempts[0],
    });

    let raw: unknown;
    try {
      raw = extractJson(response.text);
    } catch (error) {
      // Malformed JSON is a validation failure like any other — it gets the
      // same single retry rather than a separate path.
      attempts.push([
        error instanceof Error ? error.message : 'The response was not valid JSON.',
      ]);
      continue;
    }

    const validated = validateParsedReceipt(raw);
    if (!validated.ok) {
      attempts.push(validated.errors);
      continue;
    }

    const checked = runPostChecks(validated.value);

    // §5.5 check 5, run after 1–4 rather than among them: check 4 has just
    // nulled any barcode that failed its check digit, so no lookup is spent on
    // OCR noise. Never throws — a failed enrichment leaves the receipt exactly
    // as the model produced it.
    const enrich = options.enrich ?? enrichWithProductData;
    const enriched = await enrich(checked.receipt);

    const durationMs = Date.now() - startedAt;

    if (__DEV__) {
      console.log(
        `[parse] ${durationMs}ms attempts=${attempt + 1} ` +
          `in=${response.usage?.promptTokens ?? '?'} out=${response.usage?.completionTokens ?? "?"} think=${response.usage?.thoughtTokens ?? "?"} ` +
          `items=${enriched.receipt.items.length} enriched=${enriched.enrichedIndices.length}`
      );
    }

    return {
      receipt: enriched.receipt,
      flags: checked.flags,
      issues: checked.issues,
      enrichedIndices: enriched.enrichedIndices,
      modelAlias: response.modelAlias,
      retried: attempt > 0,
      durationMs,
      usage: response.usage,
    };
  }

  throw new ParseFailedError(
    'The receipt could not be read automatically. You can still enter it by hand.',
    attempts
  );
}
