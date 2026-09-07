/**
 * The agent's BYOK transport — the user's own Gemini key, called directly.
 *
 * The sibling of `byokTransport` (which parses receipts) and, like it, honest
 * about what it is: §8.2's BYOK mode, a real fallback rather than a
 * workaround, but the key travels from the device to the provider with no hub
 * in between. Stage B Phase 1 replaces this with `POST /v1/chat` (§13.2) by
 * swapping one constructor — which is the whole reason `ChatTransport` is an
 * interface — and the translation in `gemini.ts` moves to the Worker with it.
 *
 * Non-streaming only. §6.2 is firm that "correctness must never depend on
 * streaming", so the correct path is built first; streaming is layered on top
 * once it has been verified on physical hardware on both platforms.
 */

import { getByokKey } from '@/agent/byokKey';
import type { ChatTransport } from '@/agent/chatTransport';
import { fromGeminiResponse, toGeminiRequest, type GeminiResponseBody } from '@/agent/gemini';
import type { ChatReply, ChatRequest } from '@/agent/messages';
import { modelForAlias } from '@/agent/modelConfig';
import { TransportRequestError, TransportUnavailableError } from '@/agent/parseTransport';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * The agent thinks; the parser does not.
 *
 * §5.7 cuts receipt parsing to `minimal` because extraction against a fixed
 * schema does not benefit from reasoning. Choosing a metric, a dimension and a
 * time range from a sentence is the opposite case, and §6.8's budget is p50
 * under 4 s to first token rather than the parse path's 6 s end to end. `low`
 * buys that judgement without paying for the default.
 */
const THINKING_LEVEL = 'low';

export function createByokChatTransport(): ChatTransport {
  return {
    name: 'byok-gemini-chat',

    async chat(request: ChatRequest): Promise<ChatReply> {
      const key = await getByokKey();
      if (!key) {
        throw new TransportUnavailableError(
          'No API key is set. Add one in Settings to ask questions about your spending.'
        );
      }

      // §13.5: the app asks for an alias and something else decides what
      // answers it. Here that is the cached hub config; after Phase 1 it is
      // the hub itself, and this line goes away with the rest of the file.
      const model = modelForAlias(request.model);

      // `responseMimeType: application/json` is asked for only when no tools
      // are on the table. Constraining the output to JSON while the model may
      // also emit a function call is a combination Gemini has rejected, and
      // the turns that matter are covered anyway: the prompt asks for the
      // envelope as JSON, and `parseEnvelope` salvages a fenced or
      // prose-wrapped one rather than losing the answer (§6.7).
      const toolsOffered = request.tool_choice !== 'none' && (request.tools?.length ?? 0) > 0;

      const body = toGeminiRequest(request, {
        ...(toolsOffered ? {} : { responseMimeType: 'application/json' }),
        temperature: 0,
        thinkingConfig: { thinkingLevel: THINKING_LEVEL },
      });

      const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
      });

      const parsed = (await response.json().catch(() => ({}))) as GeminiResponseBody;

      if (!response.ok) {
        const detail = parsed.error?.message ?? `HTTP ${response.status}`;
        if (response.status === 401 || response.status === 403) {
          throw new TransportUnavailableError(`The API key was rejected: ${detail}`);
        }
        throw new TransportRequestError(detail, response.status);
      }

      return fromGeminiResponse(parsed);
    },
  };
}
