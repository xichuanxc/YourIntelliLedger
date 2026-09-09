/**
 * The agent talking to the hub — §13.2's `POST /v1/chat`.
 *
 * This is what §13 is for. The app sends an **alias** (§13.5: "the alias is
 * the only model name the app knows") and the hub decides what answers it, so
 * changing which model — or which provider — serves Ask is a Worker config
 * edit rather than an app release on two platforms.
 *
 * ## Phase 1 still carries the key
 *
 * The hub holds no gateway key yet, so `X-BYOK` is required and the user's own
 * key still travels with the request — to our Worker instead of to Google.
 * That is a smaller change than it sounds and a real one: the app no longer
 * knows a model name, no longer speaks a provider's dialect, and the hub is in
 * a position to add attestation, a quota and a spend ceiling (phases 2 and 3)
 * without touching the app again.
 *
 * ## No silent fallback to calling the provider directly
 *
 * `byokChatTransport` still exists and still works, but nothing falls back to
 * it automatically. A quiet fallback would mean the privacy property — that
 * requests go through a Worker whose invariants are auditable (§13.7) —
 * disappears exactly when something goes wrong, which is when a user is least
 * able to notice. An unreachable hub is an offline notice (§6.1), and the
 * direct transport is a one-line change for a developer who needs it.
 */

import { fetch as expoFetch } from 'expo/fetch';

import type { ChatTransport, OnDelta } from '@/agent/chatTransport';
import { getAskKey } from '@/agent/byokKey';
import type { ChatReply, ChatRequest, HubMeta } from '@/agent/messages';
import { HUB_BASE_URL } from '@/agent/modelConfig';
import { TransportRequestError, TransportUnavailableError } from '@/agent/parseTransport';

/** A hub turn should not outlast the user's patience by much (§6.8). */
const TIMEOUT_MS = 60_000;

interface HubError {
  error?: {
    code?: string;
    message?: string;
    /**
     * The provider's own complaint, when it made one. Shown only in a
     * development build — it is the difference between "the provider rejected
     * the request" and knowing which field it objected to.
     */
    detail?: string;
  };
}

interface HubChatResponse {
  message: ChatReply['message'];
  hub_meta?: HubMeta;
}

/**
 * §13.6's table, as the two failures the loop can act on.
 *
 * `TransportUnavailableError` means *this app is not configured* and its
 * message names the fix; anything else is a fault the user cannot do anything
 * about, and §6.1 turns it into an apology rather than an instruction.
 */
function toTransportError(status: number, code: string | undefined, fallback: string): Error {
  switch (code) {
    case 'attestation_required':
    case 'token_invalid':
    case 'token_expired':
      return new TransportUnavailableError(
        'The hub would not accept this request. Check the API key in Settings.'
      );
    case 'app_version_unsupported':
      return new TransportUnavailableError(
        'This version of the app is too old for the hub. Please update.'
      );
    case 'quota_exceeded':
      return new TransportUnavailableError(
        'This month’s question allowance is used up. Your ledger still works.'
      );
    default:
      return new TransportRequestError(fallback, status);
  }
}

/**
 * `expo/fetch`, not the global — §6.2's ⚠️.
 *
 * React Native's own `fetch` is XHR-backed and **does not expose a readable
 * stream**: `response.body` is null and the whole answer arrives at once. The
 * failure mode is the dangerous one, because nothing errors — a naive port
 * looks like it streams, returns the right text, passes every test about what
 * was said, and takes exactly as long as it always did.
 */
export function createHubChatTransport(fetchImpl: typeof fetch = expoFetch as typeof fetch): ChatTransport {
  return {
    name: 'hub-chat',

    async chat(request: ChatRequest, onDelta?: OnDelta): Promise<ChatReply> {
      const key = await getAskKey();
      if (!key) {
        throw new TransportUnavailableError(
          'No API key is set. Add one in Settings to ask questions about your spending.'
        );
      }

      let response: Response;
      try {
        response = await fetchImpl(`${HUB_BASE_URL}/v1/chat`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // §13.7: a credential. It is never logged here either, which is
            // why nothing in this file writes the request or its headers out.
            'X-BYOK': key,
          },
          // Sent as assembled, apart from `stream`, which is this transport's
          // to decide: the loop asks for an answer, not for a delivery method.
          body: JSON.stringify({ ...request, stream: onDelta !== undefined }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new TransportRequestError(
          error instanceof Error ? error.message : 'The hub could not be reached.'
        );
      }

      if (response.ok && onDelta) return readStream(response, onDelta);

      const body = (await response.json().catch(() => ({}))) as HubChatResponse & HubError;

      if (!response.ok) {
        // The detail leads, because this message becomes the loop's
        // `errorDetail` and the `[dev]` line in the answer. A user never sees
        // it in a release build.
        const detail = body.error?.detail;
        const message = body.error?.message ?? `The hub returned HTTP ${response.status}.`;
        throw toTransportError(
          response.status,
          body.error?.code,
          detail ? `${message} ${detail}` : message
        );
      }

      if (!body.message) {
        throw new TransportRequestError('The hub returned a reply with no message.');
      }

      return { message: body.message, meta: body.hub_meta };
    },
  };
}


/**
 * Reads §13.2's event stream into the same `ChatReply` a whole response gives.
 *
 * Streaming is a delivery detail, so nothing above this function knows it
 * happened: the loop gets a reply, the tool calls arrive complete, and
 * `hub_meta` becomes the usage it always was.
 *
 * A stream that ends without `hub_meta` is a failed turn, not a short answer —
 * the status code was already sent as 200 before the provider refused, so the
 * failure can only arrive inside the body.
 */
async function readStream(response: Response, onDelta: OnDelta): Promise<ChatReply> {
  const body = response.body;
  if (!body) throw new TransportRequestError('The hub sent an empty stream.');

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let raw = '';
  let event: string | undefined;
  let toolCalls: ChatReply['message']['tool_calls'];
  let meta: HubMeta | undefined;
  let failure: string | undefined;

  const handle = (name: string | undefined, data: string) => {
    if (data === '[DONE]') return;

    if (name === 'error') {
      const parsed = safeJson(data) as { code?: string; detail?: string } | null;
      failure = parsed?.detail ?? parsed?.code ?? 'The provider failed mid-answer.';
      return;
    }
    if (name === 'tool_calls') {
      toolCalls = (safeJson(data) as ChatReply['message']['tool_calls']) ?? undefined;
      return;
    }
    if (name === 'hub_meta') {
      meta = (safeJson(data) as HubMeta) ?? undefined;
      return;
    }

    const delta = (safeJson(data) as { delta?: string } | null)?.delta;
    if (typeof delta === 'string' && delta !== '') {
      raw += delta;
      // Everything received so far, not the increment: the caller decodes a
      // prefix of the envelope, which is not something increments compose to.
      onDelta(raw);
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);

        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) {
          handle(event, line.slice(5).trim());
          // An event name applies to the one frame that follows it.
          event = undefined;
        }

        newline = buffer.indexOf('\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (failure) throw new TransportRequestError(failure);
  if (!meta) {
    throw new TransportRequestError('The answer stopped before it finished.');
  }

  return {
    message: {
      content: raw === '' ? null : raw,
      ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    meta,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
