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

import type { ChatTransport } from '@/agent/chatTransport';
import { getAskKey } from '@/agent/byokKey';
import type { ChatReply, ChatRequest, HubMeta } from '@/agent/messages';
import { HUB_BASE_URL } from '@/agent/modelConfig';
import { TransportRequestError, TransportUnavailableError } from '@/agent/parseTransport';

/** A hub turn should not outlast the user's patience by much (§6.8). */
const TIMEOUT_MS = 60_000;

interface HubError {
  error?: { code?: string; message?: string };
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

export function createHubChatTransport(fetchImpl: typeof fetch = fetch): ChatTransport {
  return {
    name: 'hub-chat',

    async chat(request: ChatRequest): Promise<ChatReply> {
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
          // Sent as assembled. The model name is an alias and stays one.
          body: JSON.stringify(request),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new TransportRequestError(
          error instanceof Error ? error.message : 'The hub could not be reached.'
        );
      }

      const body = (await response.json().catch(() => ({}))) as HubChatResponse & HubError;

      if (!response.ok) {
        throw toTransportError(
          response.status,
          body.error?.code,
          body.error?.message ?? `The hub returned HTTP ${response.status}.`
        );
      }

      if (!body.message) {
        throw new TransportRequestError('The hub returned a reply with no message.');
      }

      return { message: body.message, meta: body.hub_meta };
    },
  };
}
