/**
 * How the agent reaches a model — the §6.1 loop's one dependency on a network.
 *
 * An interface for the same reason `ParseTransport` is one: two
 * implementations are planned and the loop must not know which it has. Week 7
 * ships the non-streaming shape only, because §6.2 is firm that "correctness
 * must never depend on streaming" — so the correct path is built first and
 * streaming is layered on top, which also means an unstable stream costs a
 * fallback rather than a rewrite.
 */

import type { ChatReply, ChatRequest } from '@/agent/messages';

/**
 * Called as the answer arrives, with everything received so far.
 *
 * The *raw* text, not a decoded answer: what streams back is §14.7's JSON
 * envelope, and turning that into something readable is `partialAnswer`'s job,
 * one layer up. A transport that decoded it would have to know what an
 * envelope is, and the next provider would have to know too.
 */
export type OnDelta = (rawSoFar: string) => void;

export interface ChatTransport {
  readonly name: string;
  /**
   * `onDelta` is a request, not a promise. §6.2: "correctness must never
   * depend on streaming" — a transport that cannot stream ignores it and
   * returns the same reply at the end, and everything above works unchanged.
   */
  chat(request: ChatRequest, onDelta?: OnDelta): Promise<ChatReply>;
}
