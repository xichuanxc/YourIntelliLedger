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

import { getByokKey, getByokModel } from '@/agent/byokKey';
import {
  TransportRequestError,
  TransportUnavailableError,
  type ParseRequest,
  type ParseResponse,
  type ParseTransport,
} from '@/agent/parseTransport';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

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

      const model = await getByokModel();
      const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
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
            // NOTE — measured, and the obvious fix does not work here.
            //
            // On the TAIER receipt this model spent 726 thinking tokens against
            // 92 of output: eight times the answer, for a receipt with no line
            // items at all. Thinking tokens are timed as well as billed, so they
            // dominate the wait, and a receipt parse is extraction against an
            // explicit schema rather than reasoning.
            //
            // `thinkingConfig: { thinkingBudget: 0 }` is therefore what you want,
            // but gemini-3.6-flash rejects it outright with "Request contains an
            // invalid argument" — this model appears not to allow thinking to be
            // switched off. Left unset deliberately. The levers that remain are a
            // model that permits a thinking budget, or a shorter prompt.
          },
        }),
      });

      const body = (await response.json().catch(() => ({}))) as GeminiResponse;

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
