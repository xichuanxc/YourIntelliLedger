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

    await expect(parseReceipt(transport, 'raw text', { prompt: PROMPT })).rejects.toThrow(
      ParseFailedError
    );
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
