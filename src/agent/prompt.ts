/**
 * Prompt assembly — §6.3.
 *
 *     [system prompt][tool schemas]   static, byte-identical (prefix cache)
 *     [data catalog]                  per conversation
 *     [history: last 6 turns]
 *     [user message]
 *
 * The ordering is not cosmetic. Everything before the catalog must be
 * **byte-identical on every request** or the provider's prefix cache misses
 * and each turn pays full price for the system prompt and four tool schemas.
 * So `SYSTEM_PROMPT` is a constant with nothing interpolated into it, the
 * catalog is a separate message rather than an appendix to it, and the tools
 * travel in the request's `tools` field where their order is fixed by the
 * registry.
 */

import { toolDeclarations } from '@/agent/tools';
import { renderCatalog, type DataCatalog } from '@/agent/catalog';
import type { ChatMessage, ChatRequest } from '@/agent/messages';

/** §6.3: the last six turns. Older context is dropped, not summarised. */
export const HISTORY_TURNS = 6;

/**
 * Nothing is interpolated here — see the file header. It is also deliberately
 * short: it is re-sent on every turn of every conversation, and the model
 * learns the tool arguments from the schemas rather than from prose.
 */
export const SYSTEM_PROMPT = [
  'You answer questions about the user\'s own grocery and shopping receipts,',
  'stored on their phone. You are talking to the person whose ledger it is.',
  '',
  'Rules:',
  '- Never invent a number. Every figure in your answer must come from a tool',
  '  result in this conversation.',
  '- Amounts from tools are in cents. Convert them for the user.',
  '- If a tool result carries a note, say what it says. A clamped range means',
  '  you answered a narrower question than the one you were asked.',
  '- An empty result is an answer: say there is nothing, do not guess why.',
  '- update_bill_item and delete_bill do not take effect when you call them.',
  '  They return pending_user_confirmation and the user decides. Say what you',
  '  are proposing; never claim it is done.',
  '',
  'Reply with a JSON object and nothing else:',
  '{"text": "<one or two sentences>",',
  ' "render": {"type": "none|stat|table|bar|line|donut", ...},',
  ' "pending_actions": [], "followups": ["<a short suggestion>"]}',
  'Only "text" is required. Omit "render" when a sentence is the whole answer.',
].join('\n');

/**
 * The last `HISTORY_TURNS` turns.
 *
 * A turn is a user message and everything that answered it, so the window is
 * counted in user messages and then cut at that boundary — slicing a fixed
 * number of *messages* would routinely start the history with an orphaned
 * `tool` result whose `assistant` call had been dropped, which some providers
 * reject outright.
 */
export function recentHistory(
  history: readonly ChatMessage[],
  turns: number = HISTORY_TURNS
): ChatMessage[] {
  const starts: number[] = [];
  history.forEach((message, index) => {
    if (message.role === 'user') starts.push(index);
  });
  if (starts.length <= turns) return [...history];
  return history.slice(starts[starts.length - turns]);
}

export interface PromptInput {
  catalog: DataCatalog;
  /** Everything said so far this conversation, oldest first. */
  history: readonly ChatMessage[];
  /** Omitted when the loop is continuing after a tool result. */
  userMessage?: string;
}

export function assembleMessages(input: PromptInput): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: renderCatalog(input.catalog) },
    ...recentHistory(input.history),
  ];
  if (input.userMessage !== undefined) {
    messages.push({ role: 'user', content: input.userMessage });
  }
  return messages;
}

export function assembleRequest(input: PromptInput, stream: boolean): ChatRequest {
  return {
    model: 'chat-fast',
    stream,
    messages: assembleMessages(input),
    tools: toolDeclarations().map((declaration) => ({
      type: 'function' as const,
      function: declaration,
    })),
    tool_choice: 'auto',
  };
}
