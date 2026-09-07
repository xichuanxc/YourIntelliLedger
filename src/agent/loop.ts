/**
 * The orchestrator — §6.1.
 *
 *     assemble prompt -> POST /v1/chat
 *       tool_call -> validate -> execute locally -> append -> repeat (max 8)
 *       final     -> parse envelope -> render
 *     network error -> fastpath if the pattern matches, else offline notice
 *     loop cap hit  -> partial answer ("here's what I found so far")
 *
 * Four rules shape everything below.
 *
 * **A rejection is a message, not an exception.** §14.5 returns validation
 * failures to the model as the tool result so it can correct itself on its
 * single retry. A second failure ends the turn with a plain-language apology
 * and `outcome='error'` — the model is not going to find it on the third try,
 * and each attempt costs the user money and seconds.
 *
 * **The cap produces an answer, not an error.** §6.1 asks for "here's what I
 * found so far", so hitting eight iterations spends one more call with the
 * tools switched off. The model summarises what it already has, which is a
 * partial answer in the honest sense rather than a canned apology.
 *
 * **A write ends the tool phase.** §6.4: write tools "return
 * `pending_user_confirmation` to the model and end the loop". The model still
 * gets to phrase the confirmation card, so the loop continues to a final
 * message — but with `tool_choice: 'none'`, so no further tool call is
 * possible and nothing else can be proposed alongside the pending write.
 *
 * **The turn is logged, not the transcript.** §15.3: no question text and no
 * financial values in `query_log`. This returns the log row's contents and
 * lets the caller write it, so the loop stays testable without a database
 * beyond the one the tools read.
 */

import type { ChatTransport } from '@/agent/chatTransport';
import type { DataCatalog } from '@/agent/catalog';
import { parseEnvelope, type AnswerEnvelope } from '@/agent/envelope';
import { executeToolCall, type BillReference, type ExecutionStatus } from '@/agent/execute';
import type { ChatMessage, ChatReply } from '@/agent/messages';
import { TransportRequestError, TransportUnavailableError } from '@/agent/parseTransport';
import { assembleRequest } from '@/agent/prompt';
import type { ValidationContext } from '@/agent/validate';
import type { SqlDriver } from '@/data/driver';
import type { QueryOutcome } from '@/types/vocabulary';

/** §6.1's cap. Eight tool calls is already a question that went wrong. */
export const MAX_ITERATIONS = 8;
/** §14.5 allows one retry, so the second failure is the last. */
export const MAX_REJECTIONS = 2;

export interface AgentDeps {
  transport: ChatTransport;
  db: SqlDriver;
  catalog: DataCatalog;
  validation: ValidationContext;
  /** Injected so latency is measurable without a real clock. */
  now?: () => number;
}

/** The §15.3 row, for the caller to write. Deliberately content-free. */
export interface QueryLogDraft {
  route: 'agent';
  outcome: QueryOutcome;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  modelAlias: string;
  /** Names and statuses only — never arguments, which carry the question. */
  toolCalls: { name: string; status: ExecutionStatus }[];
  errorCode?: string;
}

export interface AgentTurn {
  envelope: AnswerEnvelope;
  /** The conversation including this turn, for the next one. */
  history: ChatMessage[];
  log: QueryLogDraft;
  /**
   * Names the tools vouched for, so the answer can link to the bills behind
   * it. Gathered from rows rather than from the model — see `execute.ts`.
   */
  references: BillReference[];
  /**
   * What actually went wrong, for a developer.
   *
   * Returned rather than logged: §15.3 keeps `query_log` free of content, and
   * a provider's error message can quote the request. The caller decides
   * whether anyone sees it — the development build shows it, a release does
   * not.
   */
  errorDetail?: string;
}

const OFFLINE_TEXT =
  'I could not reach the assistant just now. Your ledger is still here, and the ' +
  'Insights tab works offline.';

const UPSTREAM_TEXT =
  'The assistant service refused that request. This is a fault in the app rather ' +
  'than in your ledger — everything else still works.';

const GAVE_UP_TEXT =
  'I could not work that one out. Try asking it a different way, or with a ' +
  'narrower time range.';

export async function runAgentTurn(
  userMessage: string,
  history: readonly ChatMessage[],
  deps: AgentDeps
): Promise<AgentTurn> {
  const clock = deps.now ?? Date.now;
  const startedAt = clock();

  const working: ChatMessage[] = [...history, { role: 'user', content: userMessage }];
  const toolCalls: QueryLogDraft['toolCalls'] = [];
  const references: BillReference[] = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let rejections = 0;
  let toolsOff = false;

  const finish = (
    envelope: AnswerEnvelope,
    outcome: QueryOutcome,
    errorCode?: string,
    errorDetail?: string
  ): AgentTurn => {
    working.push({ role: 'assistant', content: envelope.text });
    return {
      envelope,
      history: working,
      references,
      errorDetail,
      log: {
        route: 'agent',
        outcome,
        latencyMs: clock() - startedAt,
        tokensIn,
        tokensOut,
        // §13.5: the alias is the only model name the app knows.
        modelAlias: 'chat-fast',
        toolCalls,
        errorCode,
      },
    };
  };

  const ask = async (allowTools: boolean): Promise<ChatReply> => {
    const request = assembleRequest({ catalog: deps.catalog, history: working }, false);
    if (!allowTools) request.tool_choice = 'none';
    const reply = await deps.transport.chat(request);
    tokensIn += reply.meta?.usage?.prompt_tokens ?? 0;
    tokensOut += reply.meta?.usage?.completion_tokens ?? 0;
    return reply;
  };

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
      const reply = await ask(!toolsOff);
      const calls = reply.message.tool_calls ?? [];

      if (calls.length === 0) {
        const { envelope, degraded } = parseEnvelope(reply.message.content ?? '');
        // §15.3: `retry` is "one validation failure, then success", and
        // `fallback` covers a text-only render — so a turn that had both is
        // reported as the more degraded of the two.
        const outcome: QueryOutcome = degraded ? 'fallback' : rejections > 0 ? 'retry' : 'ok';
        return finish(envelope, outcome);
      }

      working.push({ role: 'assistant', content: reply.message.content, tool_calls: calls });

      for (const call of calls) {
        const result = await executeToolCall(call, { db: deps.db, validation: deps.validation });
        toolCalls.push({ name: call.function.name, status: result.status });
        references.push(...(result.references ?? []));
        working.push({ role: 'tool', tool_call_id: call.id, content: result.content });

        if (result.status === 'rejected') rejections += 1;
        if (result.status === 'pending') toolsOff = true;
      }

      if (rejections >= MAX_REJECTIONS) {
        return finish({ text: GAVE_UP_TEXT }, 'error', 'validation_failed');
      }
    }

    // §6.1's cap. One more call, tools off: the model says what it found
    // rather than the app apologising on its behalf.
    const summary = await ask(false);
    const { envelope } = parseEnvelope(summary.message.content ?? '');
    return finish(envelope.text === '' ? { text: GAVE_UP_TEXT } : envelope, 'fallback', 'loop_cap');
  } catch (error) {
    // §6.1 puts the fastpath check here — "network error → fastpath if the
    // pattern matches, else offline notice". The fastpaths are §6.6 and land
    // in Week 8; until then a network failure takes the offline branch.
    //
    // Three outcomes, not one. The first version of this said "could not
    // reach the assistant" for everything, which made an unreachable network
    // and a provider rejecting the request look identical — and they are the
    // two most likely things to go wrong, needing opposite fixes.
    const detail = error instanceof Error ? error.message : String(error);

    // Not a network failure: the app is unconfigured — no key, or a rejected
    // one — and the message names the fix.
    if (error instanceof TransportUnavailableError) {
      return finish({ text: error.message }, 'error', 'transport_unavailable', detail);
    }

    // The provider answered, and said no. Sending the user to check their
    // signal would be a wild goose chase.
    if (error instanceof TransportRequestError) {
      return finish({ text: UPSTREAM_TEXT }, 'error', 'upstream_error', detail);
    }

    return finish({ text: OFFLINE_TEXT }, 'error', 'transport_error', detail);
  }
}
