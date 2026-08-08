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
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

/** Assembles the single user turn: prompt, receipt text, and any retry feedback. */
export function buildPromptText(request: ParseRequest): string {
  const parts = [request.prompt, '', '## Receipt text', '', request.ocrText];

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
          contents: [{ role: 'user', parts: [{ text: buildPromptText(request) }] }],
          generationConfig: {
            // Ask for JSON directly. `extractJson` still tolerates prose and
            // fences, because a formatting quirk must not burn the one retry
            // §5.5 allows.
            responseMimeType: 'application/json',
            temperature: 0,
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
        },
      };
    },
  };
}
