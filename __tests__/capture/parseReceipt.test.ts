import { expectRejection } from '../support/expectRejection';
import fs from 'node:fs';
import path from 'node:path';

import { buildPromptText } from '@/agent/byokTransport';
import type { ParseRequest, ParseTransport } from '@/agent/parseTransport';
import { ParseFailedError, parseReceipt } from '@/capture/parseReceipt';
import { RECEIPT_PARSE_PROMPT } from '@/capture/prompts/receiptParseText';

const PROMPT = 'SYSTEM PROMPT';

const goodReceipt = {
  merchant: 'New World',
  purchased_at: '2026-07-05',
  total_cents: 1202,
  itemless: false,
  items: [{ name: 'Milk', category: 'dairy', price_cents: 1202 }],
};

/** A transport that replays scripted replies and records what it was asked. */
function fakeTransport(replies: string[]): ParseTransport & { requests: ParseRequest[] } {
  const requests: ParseRequest[] = [];
  let index = 0;
  return {
    name: 'fake',
    requests,
    async parseReceipt(request) {
      requests.push(request);
      const text = replies[Math.min(index, replies.length - 1)];
      index += 1;
      return { text, modelAlias: 'fake-model' };
    },
  };
}

describe('parseReceipt (§5.1, §5.5)', () => {
  it('returns a validated receipt on the first attempt', async () => {
    const transport = fakeTransport([JSON.stringify(goodReceipt)]);
    const outcome = await parseReceipt(transport, 'raw text', { prompt: PROMPT });

    expect(outcome.receipt.merchant).toBe('New World');
    expect(outcome.retried).toBe(false);
    expect(outcome.modelAlias).toBe('fake-model');
    expect(transport.requests).toHaveLength(1);
  });

  it('retries once, telling the model what was wrong (§5.5 #1)', async () => {
    const bad = JSON.stringify({ ...goodReceipt, total_cents: 12.02 });
    const transport = fakeTransport([bad, JSON.stringify(goodReceipt)]);

    const outcome = await parseReceipt(transport, 'raw text', { prompt: PROMPT });

    expect(outcome.retried).toBe(true);
    expect(transport.requests).toHaveLength(2);
    // The second call must carry the reason, or the retry is a coin flip.
    expect(transport.requests[1].priorErrors?.join(' ')).toMatch(/total_cents/);
    expect(transport.requests[0].priorErrors).toBeUndefined();
  });

  it('retries exactly once, then gives up (§5.5: fall back to manual entry)', async () => {
    const bad = JSON.stringify({ ...goodReceipt, purchased_at: 'yesterday' });
    const transport = fakeTransport([bad, bad, bad]);

    await expectRejection(() => parseReceipt(transport, 'raw text', { prompt: PROMPT }), { type: ParseFailedError });
    // Not a loop: two attempts, no more. The user is waiting.
    expect(transport.requests).toHaveLength(2);
  });

  it('carries both attempts’ errors on the failure, for diagnosis', async () => {
    const transport = fakeTransport([JSON.stringify({ ...goodReceipt, items: 'nope' })]);

    await expect(parseReceipt(transport, 'raw', { prompt: PROMPT })).rejects.toMatchObject({
      name: 'ParseFailedError',
      attempts: expect.arrayContaining([expect.arrayContaining([expect.stringMatching(/items/)])]),
    });
  });

  it('treats malformed JSON as a validation failure, not a separate path', async () => {
    const transport = fakeTransport(['I could not read it', JSON.stringify(goodReceipt)]);
    const outcome = await parseReceipt(transport, 'raw', { prompt: PROMPT });

    expect(outcome.retried).toBe(true);
    expect(transport.requests[1].priorErrors?.join(' ')).toMatch(/JSON/i);
  });

  it('accepts JSON wrapped in a fenced block', async () => {
    const transport = fakeTransport(['```json\n' + JSON.stringify(goodReceipt) + '\n```']);
    const outcome = await parseReceipt(transport, 'raw', { prompt: PROMPT });
    expect(outcome.retried).toBe(false);
  });

  it('runs the post-checks, so a bad barcode never reaches the review screen', async () => {
    const withBadBarcode = {
      ...goodReceipt,
      items: [{ ...goodReceipt.items[0], barcode: '9421905301535' }],
    };
    const outcome = await parseReceipt(fakeTransport([JSON.stringify(withBadBarcode)]), 'raw', {
      prompt: PROMPT,
    });

    expect(outcome.receipt.items[0].barcode).toBeNull();
    expect(outcome.issues[0].kind).toBe('invalid_barcode');
    expect(outcome.flags).toContain('low_confidence');
  });

  it('parses an itemless restaurant bill (§5.1)', async () => {
    const restaurant = {
      merchant: 'TAIER CBD',
      purchased_at: '2026-06-14',
      total_cents: 15140,
      itemless: true,
      items: [],
    };
    const outcome = await parseReceipt(fakeTransport([JSON.stringify(restaurant)]), 'raw', {
      prompt: PROMPT,
    });

    expect(outcome.receipt.items).toEqual([]);
    expect(outcome.flags).toEqual([]);
  });
});

describe('buildPromptText', () => {
  it('sends the prompt and the receipt text', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'MILK 6.39' });
    expect(text).toContain(PROMPT);
    expect(text).toContain('MILK 6.39');
    expect(text).not.toMatch(/previous answer was rejected/);
  });

  it('appends the rejection reasons on a retry', () => {
    const text = buildPromptText({
      prompt: PROMPT,
      ocrText: 'MILK 6.39',
      priorErrors: ['`total_cents` must be an integer.'],
    });
    expect(text).toMatch(/previous answer was rejected/);
    expect(text).toContain('`total_cents` must be an integer.');
  });
});

describe('the generated prompt module', () => {
  it('matches its markdown source — regenerate with npm run prompt:build', () => {
    const markdown = fs.readFileSync(
      path.resolve(__dirname, '../../src/capture/prompts/receipt-parse-text.md'),
      'utf8'
    );
    expect(RECEIPT_PARSE_PROMPT).toBe(markdown);
  });
});

/**
 * Vision parsing (Settings → "Send the photo too").
 *
 * The switch is off by default because §0 puts only "per-question minimal
 * payloads" on the wire and §5.1's pipeline stops at text on purpose. What
 * matters here is that the default really is text-only — a privacy setting
 * that leaks when nobody asked is worse than not having one.
 */
describe('vision parsing', () => {
  const image = { base64: 'AAAA', mimeType: 'image/jpeg' };

  /** The word appears in the text-only guidance ("there is no photograph"), so
   *  these assert the section and its instruction, not the bare word. */
  it('attaches no photographs section when none are sent', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'MILK 6.39' });
    expect(text).not.toMatch(/## Photographs/);
    expect(text).not.toMatch(/trust the photographs/i);
  });

  it('attaches no photographs section for an empty list', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'MILK 6.39', images: [] });
    expect(text).not.toMatch(/## Photographs/);
    expect(text).not.toMatch(/trust the photographs/i);
  });

  /**
   * The OCR text still goes. It resolves small print a compressed JPEG loses,
   * so the two disagree in both directions — but the photograph is the reason
   * the user turned this on, so the prompt has to name it as the authority or
   * a confidently garbled line can anchor the model against what it can see.
   */
  it('tells the model the photographs win where the two disagree', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'M1LK 6.89', images: [image] });

    expect(text).toContain('M1LK 6.89');
    expect(text).toMatch(/authoritative/i);
    expect(text).toMatch(/trust the photographs/i);
  });

  it('counts the pages so the model knows how many to expect', () => {
    expect(buildPromptText({ prompt: PROMPT, ocrText: '', images: [image] })).toContain(
      '1 photograph'
    );
    expect(
      buildPromptText({ prompt: PROMPT, ocrText: '', images: [image, image, image] })
    ).toContain('3 photographs');
  });

  it('never puts the base64 in the prompt text — it travels as its own part', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'MILK', images: [image] });
    expect(text).not.toContain('AAAA');
  });

  it('passes the images through parseReceipt to the transport untouched', async () => {
    const seen: ParseRequest[] = [];
    const transport: ParseTransport = {
      name: 'stub',
      parseReceipt: async (request) => {
        seen.push(request);
        return { text: JSON.stringify(goodReceipt), modelAlias: 'stub' };
      },
    };

    await parseReceipt(transport, 'MILK 6.39', { prompt: PROMPT, images: [image] });

    expect(seen).toHaveLength(1);
    expect(seen[0].images).toEqual([image]);
  });

  /** The default path must stay exactly as it was. */
  it('sends no images when the caller supplies none', async () => {
    const seen: ParseRequest[] = [];
    const transport: ParseTransport = {
      name: 'stub',
      parseReceipt: async (request) => {
        seen.push(request);
        return { text: JSON.stringify(goodReceipt), modelAlias: 'stub' };
      },
    };

    await parseReceipt(transport, 'MILK 6.39', { prompt: PROMPT });

    expect(seen[0].images).toBeUndefined();
  });

  /** §5.5 allows one retry; the photographs have to survive it. */
  it('keeps the images on the retry', async () => {
    const seen: ParseRequest[] = [];
    let call = 0;
    const transport: ParseTransport = {
      name: 'stub',
      parseReceipt: async (request) => {
        seen.push(request);
        call += 1;
        return {
          text: call === 1 ? '{"merchant": 42}' : JSON.stringify(goodReceipt),
          modelAlias: 'stub',
        };
      },
    };

    await parseReceipt(transport, 'MILK 6.39', { prompt: PROMPT, images: [image] });

    expect(seen).toHaveLength(2);
    expect(seen[1].images).toEqual([image]);
    expect(seen[1].priorErrors?.length).toBeGreaterThan(0);
  });
});

/**
 * OCR correction guidance, text-only path.
 *
 * The base prompt warns that OCR is noisy and says "do your best to recover
 * the true content", but never says the model may *change* what it was given —
 * so an obviously mangled name tends to come back verbatim. This grants that
 * permission, and bounds it: with no photograph to check against, an
 * unbounded licence to correct is a licence to invent.
 */
describe('OCR correction guidance', () => {
  const image = { base64: 'AAAA', mimeType: 'image/jpeg' };

  it('authorises correction when no photograph is sent', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'M1LK 6.39' });

    expect(text).toMatch(/Correcting the OCR text/);
    expect(text).toMatch(/confident/i);
  });

  /** The bounds are the point — each is a separate failure mode. */
  it('bounds it: names freely, digits only on evidence, never invent', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'M1LK 6.39' });

    expect(text).toMatch(/character confusions/i);
    expect(text).toMatch(/only when something \*proves\* it/i);
    expect(text).toMatch(/[Nn]ever supply a value that is not in the text/);
  });

  /** A corrected line the model is unsure of has to reach the review screen. */
  it('asks for low confidence on a corrected but doubtful line', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'M1LK 6.39' });
    expect(text).toMatch(/confidence.*low/is);
  });

  /**
   * With a photograph the correction instruction would compete with "trust the
   * photographs" — two different authorities for the same disagreement.
   */
  it('is replaced by the photograph guidance when images are sent', () => {
    const text = buildPromptText({ prompt: PROMPT, ocrText: 'M1LK 6.39', images: [image] });

    expect(text).not.toMatch(/Correcting the OCR text/);
    expect(text).toMatch(/trust the photographs/i);
  });

  it('still carries the rejection reasons on a text-only retry', () => {
    const text = buildPromptText({
      prompt: PROMPT,
      ocrText: 'M1LK 6.39',
      priorErrors: ['`total_cents` must be an integer.'],
    });

    expect(text).toMatch(/Correcting the OCR text/);
    expect(text).toMatch(/previous answer was rejected/);
  });
});
