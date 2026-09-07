/**
 * The conversation as it crosses the wire — §13.2's "OpenAI-compatible
 * chat-completions payload".
 *
 * These are provider shapes, not app shapes, which is why they are snake_case
 * and why `tool_calls[].function.arguments` is a **string** rather than an
 * object: the model emits JSON text, and it is free to emit text that is not
 * valid JSON. Typing it as `unknown` here would hide the one failure the loop
 * has to handle explicitly (§6.1 — a bad tool call is returned to the model as
 * a rejection so it can retry, not thrown at the user).
 */

import type { FunctionDeclaration } from '@/agent/tools/schema';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** JSON text, as produced by the model. Parse defensively. */
    arguments: string;
  };
  /**
   * An opaque token the provider attaches to a tool call and requires back,
   * verbatim, when the conversation continues.
   *
   * Gemini 3 signs the reasoning behind a function call and refuses the next
   * turn without it — *"Function call is missing a thought_signature in
   * functionCall parts"* — which is a second-turn failure, so a single-turn
   * test cannot catch it.
   *
   * It is provider-specific and does not belong in an OpenAI-shaped message,
   * but it has nowhere else to live: the app sends the whole conversation on
   * every turn (§6.3), so anything the provider needs back has to survive a
   * round trip through the client. Treated as opaque — never parsed, never
   * shortened, never regenerated.
   */
  thought_signature?: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ChatRequest {
  /** An alias, never a model name — §13.5, and the hub rejects anything else. */
  model: 'chat-fast' | 'parse-strong';
  stream: boolean;
  messages: ChatMessage[];
  tools?: readonly { type: 'function'; function: FunctionDeclaration }[];
  tool_choice?: 'auto' | 'none';
}

/** §13.2's terminal `hub_meta`, whether it arrived as an event or a field. */
export interface HubMeta {
  quota_remaining_units?: number;
  model_used?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface ChatReply {
  /** The assistant turn as the model produced it. */
  message: { content: string | null; tool_calls?: ToolCall[] };
  meta?: HubMeta;
}
