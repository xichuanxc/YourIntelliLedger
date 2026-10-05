/**
 * BYOK transport — the user's own Gemini key, called directly.
 *
 * Development only, and honest about it: this is the §8.2 BYOK mode, which the
 * spec treats as a real fallback rather than a workaround, but it means the
 * key travels from the device to the provider with no hub in between. Week 7
 * moves the traffic to `POST /v1/chat` (§13.2), where the gateway key lives,
 * usage is metered, and the app carries no key at all.
 *
 * `expo/fetch` is not used here. §6.2's streaming warning applies to the agent
 * loop, which streams tokens; a receipt parse wants one complete JSON object,
 * so a plain request is both simpler and less to go wrong.
 */

import { getByokKey, getByokModelOverride } from '@/agent/byokKey';
import { modelForAlias } from '@/agent/modelConfig';
import {
  TransportRequestError,
  TransportUnavailableError,
  type ParseRequest,
  type ParseResponse,
  type ParseTransport,
} from '@/agent/parseTransport';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * How hard the model may think before answering (§5.7's latency budget).
 *
 * `minimal` is the floor of the documented ladder (minimal < low < medium <
 * high) and what the measurement below argues for, but it is **not offered by
 * every model**: `gemini-3.7-flash` and `gemini-3.8-flash` answer a request
 * for it with *"Thinking level MINIMAL is not supported for this model"* and a
 * 400, while 3.6-flash and both flash-lites accept it. Measured against the
 * live API, model by model, rather than inferred from version numbers — which
 * would have got it backwards, since the newer models are the stricter ones.
 *
 * So the level is per model, and the knowledge is seeded rather than relied
 * on: a model that rejects the floor is remembered and the request is retried
 * one rung up. A name nobody has measured therefore costs one extra round
 * trip once per launch instead of failing a parse, which matters because the
 * reason to change model is usually that a free-tier allowance ran out and
 * every request is being counted.
 */
const THINKING_FLOOR = 'minimal';
const THINKING_NEXT_RUNG = 'low';

/** Models known to reject the floor. Seeded with what was measured. */
const REJECTS_FLOOR = new Set(['gemini-3.7-flash', 'gemini-3.8-flash']);

function thinkingLevelFor(model: string): string {
  return REJECTS_FLOOR.has(model) ? THINKING_NEXT_RUNG : THINKING_FLOOR;
}

/** Google's wording for it; matched loosely because only the subject matters. */
function isThinkingLevelRefusal(detail: string): boolean {
  return /thinking level/i.test(detail);
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    /**
     * Internal reasoning tokens. Recent flash models think before answering,
     * and those tokens are billed and *timed* but never appear in the output —
     * so a parse can take far longer than its JSON length suggests. Captured
     * because "why is this slow" is otherwise unanswerable from the client.
     */
    thoughtsTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}

/** Assembles the single user turn: prompt, receipt text, and any retry feedback. */
export function buildPromptText(request: ParseRequest): string {
  const parts = [request.prompt, '', '## Receipt text', '', request.ocrText];

  if (!request.images?.length) {
    // Text-only path. The base prompt already warns that OCR is noisy and says
    // "do your best to recover the true content", but it never actually says
    // the model *may* change what it was given — so it tends to copy an
    // obviously mangled name through verbatim. This grants that permission and
    // then bounds it, because an unbounded licence to correct is a licence to
    // invent, and there is no photograph here to check against.
    parts.push(
      '',
      '## Correcting the OCR text',
      '',
      'This text is all you have — there is no photograph. Where you are ' +
        'confident what the receipt actually said, correct it rather than ' +
        'copying the error through:',
      '',
      '- Product and merchant names: fix obvious character confusions ' +
        '(0/O, 1/l/I, 5/S, rn/m), split or merged words, and stray thermal-printer ' +
        'symbols. A recognisable brand or product name is almost always the right read.',
      '- Numbers: correct a digit only when something *proves* it — the line ' +
        'arithmetic (qty × unit price), or the items against the printed total. ' +
        'A digit that merely looks odd is not evidence.',
      '- Never supply a value that is not in the text at all. The "when you are ' +
        'not sure" rules still win: null, and say so.',
      '- If you corrected a line and any doubt remains, set its `confidence` to ' +
        '`"low"` so the person checks it.'
    );
  }

  if (request.images?.length) {
    // The OCR text is still sent. On-device OCR resolves small print that a
    // compressed JPEG loses, so the two disagree in *both* directions — but
    // the photograph is why the user turned this on, so it is named as the
    // authority. Without saying so, a confidently garbled line of OCR can
    // anchor the model against what it can plainly see.
    const count = request.images.length;
    parts.push(
      '',
      '## Photographs',
      '',
      `${count} photograph${count === 1 ? '' : 's'} of this receipt ${count === 1 ? 'is' : 'are'} attached, in page order. ` +
        'They are the authoritative source: where the receipt text above disagrees ' +
        'with what you can see, trust the photographs. That text came from ' +
        'on-device OCR and may have merged columns, dropped characters, or ' +
        'misread digits.'
    );
  }

  if (request.priorErrors?.length) {
    parts.push(
      '',
      '## Your previous answer was rejected',
      '',
      'Fix these and return the corrected JSON only:',
      ...request.priorErrors.map((error) => `- ${error}`)
    );
  }

  return parts.join('\n');
}

export function createByokTransport(): ParseTransport {
  return {
    name: 'byok-gemini',

    async parseReceipt(request: ParseRequest): Promise<ParseResponse> {
      const key = await getByokKey();
      if (!key) {
        throw new TransportUnavailableError(
          'No API key is set. Add one in Settings to read receipts automatically.'
        );
      }

      // §13.5: the app asks for an alias; the hub decides what answers. A
      // deliberate Settings entry still wins, so a model can be evaluated
      // before the hub is repointed at it.
      const model = (await getByokModelOverride()) ?? modelForAlias('parse-strong');

      const send = (thinkingLevel: string) =>
        fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: buildPromptText(request) },
                // Images follow the text so the instructions are already in
                // context when the model reaches them, and stay in page order.
                ...(request.images ?? []).map((image) => ({
                  inline_data: { mime_type: image.mimeType, data: image.base64 },
                })),
              ],
            },
          ],
          generationConfig: {
            // Ask for JSON directly. `extractJson` still tolerates prose and
            // fences, because a formatting quirk must not burn the one retry
            // §5.5 allows.
            responseMimeType: 'application/json',
            temperature: 0,
            /**
             * Thinking is the parse latency — §5.7 wants ≤ 6 s and we measured
             * 9.6–15.0 s, with `think=1456–2584` against `out=456`. At roughly
             * 5 ms per generated token, ~80% of the wait is reasoning the user
             * never sees, for what is extraction against a fixed schema.
             *
             * An earlier note here concluded thinking could not be switched off,
             * because `thinkingBudget: 0` came back "Request contains an invalid
             * argument". That read the error as being about thinking; it was
             * about the *parameter*. `thinkingBudget` is the Gemini 2.5 control
             * and Gemini 3 replaced it with `thinkingLevel` — the two are
             * mutually exclusive, and sending the retired one is a 400 whatever
             * its value. Google's migration note names `minimal` as the
             * equivalent of the old zero budget: "as close as possible to a zero
             * budget for thinking".
             *
             * `minimal` rather than `low` because the ladder is documented as
             * minimal < low < medium < high and this is the floor. If this model
             * turns out not to offer it — the published tables cover 3.1 and 3.5
             * flash-lite, not 3.6 — `low` is the next rung, not a return to the
             * default.
             *
             * Watch accuracy, not just the clock. This trades reasoning for
             * speed on exactly the receipts that most need it (faint thermal
             * print, wrapped item lines), so §5.7's accuracy figures want
             * re-measuring before this is called a win.
             */
            thinkingConfig: { thinkingLevel },
          },
        }),
      });

      let level = thinkingLevelFor(model);
      let response = await send(level);
      let body = (await response.json().catch(() => ({}))) as GeminiResponse;

      // The one error worth spending a second request on: the model refused
      // the level rather than the receipt, so the same prompt one rung up is
      // the whole fix. Remembered, so a batch of receipts pays for this once.
      if (
        !response.ok &&
        response.status === 400 &&
        level === THINKING_FLOOR &&
        isThinkingLevelRefusal(body.error?.message ?? '')
      ) {
        REJECTS_FLOOR.add(model);
        level = THINKING_NEXT_RUNG;
        response = await send(level);
        body = (await response.json().catch(() => ({}))) as GeminiResponse;
      }

      if (!response.ok) {
        const detail = body.error?.message ?? `HTTP ${response.status}`;
        // 401/403 mean the key is the problem, which is a different fix for
        // the user than "the service is busy".
        if (response.status === 401 || response.status === 403) {
          throw new TransportUnavailableError(`The API key was rejected: ${detail}`);
        }
        throw new TransportRequestError(detail, response.status);
      }

      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
      if (text.trim() === '') {
        throw new TransportRequestError('The model returned an empty response.');
      }

      return {
        text,
        modelAlias: model,
        usage: {
          promptTokens: body.usageMetadata?.promptTokenCount,
          completionTokens: body.usageMetadata?.candidatesTokenCount,
          thoughtTokens: body.usageMetadata?.thoughtsTokenCount,
        },
      };
    },
  };
}
