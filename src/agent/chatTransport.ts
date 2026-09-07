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

export interface ChatTransport {
  readonly name: string;
  chat(request: ChatRequest): Promise<ChatReply>;
}
