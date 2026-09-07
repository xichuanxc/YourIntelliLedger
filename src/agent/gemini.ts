/**
 * OpenAI-shaped chat request → Gemini's native `:generateContent`, and back.
 *
 * This is the translation §13.2's hub will need — Stage B's Spike 0 settled
 * that the Worker translates rather than relays, because the OpenAI-compat
 * endpoint folds reasoning tokens into the completion count "without any sort
 * of delimiter" and §5.7's latency work depends on reading them apart. Writing
 * it here first means Phase 1 ports a function that has answered real
 * questions rather than inventing one against a spec.
 *
 * ## The schema subset
 *
 * Gemini's function declarations take an OpenAPI-ish subset of JSON Schema,
 * not JSON Schema. Keywords it does not accept are dropped on the way out
 * rather than being worked around, and that is safe for a reason worth stating
 * plainly: the declaration on the wire is a *hint to the model*, while
 * `validate.ts` is the whitelist, and it walks the original. A dropped
 * `maxLength` means the model is not told the limit; it does not mean the
 * limit stops being enforced.
 *
 * §14.1's `filters[].value` is the one field with no type at all, because what
 * it must be depends on the sibling `op`. `anyOf` says that honestly.
 */

import type { ChatReply, ChatRequest, ChatMessage, ToolCall } from '@/agent/messages';
import type { FunctionDeclaration, JsonSchema } from '@/agent/tools/schema';

/** Gemini names its types in upper case. */
const TYPE_NAMES: Record<NonNullable<JsonSchema['type']>, string> = {
  object: 'OBJECT',
  array: 'ARRAY',
  string: 'STRING',
  integer: 'INTEGER',
  number: 'NUMBER',
  boolean: 'BOOLEAN',
};

interface GeminiSchema {
  type?: string;
  description?: string;
  enum?: readonly string[];
  properties?: Record<string, GeminiSchema>;
  required?: readonly string[];
  items?: GeminiSchema;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  minProperties?: number;
  anyOf?: GeminiSchema[];
}

export function toGeminiSchema(schema: JsonSchema): GeminiSchema {
  // The untyped schema — §14.1's `filters[].value`. A single term for `eq` and
  // `contains`, a list for `in`; `compile.ts` reads both.
  if (!schema.type && !schema.enum) {
    return {
      anyOf: [{ type: 'STRING' }, { type: 'ARRAY', items: { type: 'STRING' } }],
    };
  }

  const out: GeminiSchema = {};
  // An enum is a string enum here; Gemini requires the type alongside it.
  if (schema.enum) {
    out.type = 'STRING';
    out.enum = schema.enum;
  } else if (schema.type) {
    out.type = TYPE_NAMES[schema.type];
  }

  if (schema.description) out.description = schema.description;
  if (schema.required) out.required = schema.required;
  if (schema.maxItems !== undefined) out.maxItems = schema.maxItems;
  if (schema.minimum !== undefined) out.minimum = schema.minimum;
  if (schema.maximum !== undefined) out.maximum = schema.maximum;
  if (schema.maxLength !== undefined) out.maxLength = schema.maxLength;
  if (schema.minProperties !== undefined) out.minProperties = schema.minProperties;

  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)])
    );
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);

  return out;
}

export function toGeminiTools(declarations: readonly FunctionDeclaration[]) {
  return [
    {
      functionDeclarations: declarations.map((declaration) => ({
        name: declaration.name,
        description: declaration.description,
        parameters: toGeminiSchema(declaration.parameters),
      })),
    },
  ];
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/**
 * Which tool a `tool` message is answering.
 *
 * Gemini identifies a function response by *name*, while the OpenAI shape uses
 * an opaque `tool_call_id`, so the name has to be recovered from the assistant
 * turn that made the call. Walking backwards rather than keeping a map because
 * the history is short (§6.3 caps it at six turns) and a map would be a second
 * thing to keep in step with the messages.
 */
function toolNameFor(messages: readonly ChatMessage[], index: number): string {
  const target = messages[index];
  if (target.role !== 'tool') return 'unknown';

  for (let i = index - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant' || !message.tool_calls) continue;
    const match = message.tool_calls.find((call) => call.id === target.tool_call_id);
    if (match) return match.function.name;
  }
  return 'unknown';
}

export interface GeminiRequestBody {
  systemInstruction?: { parts: { text: string }[] };
  contents: GeminiContent[];
  tools?: ReturnType<typeof toGeminiTools>;
  toolConfig?: { functionCallingConfig: { mode: 'AUTO' | 'NONE' } };
  generationConfig: Record<string, unknown>;
}

/**
 * A tool result goes back with role `user`.
 *
 * Gemini's own function-calling guide shows the result in a `user` turn
 * carrying a `functionResponse` part; some SDKs write `function` instead, and
 * the two are not interchangeable across versions. Named here so a rejection
 * from the API is a one-line change rather than a hunt.
 */
const TOOL_RESULT_ROLE = 'user' as const;

export function toGeminiRequest(
  request: ChatRequest,
  generationConfig: Record<string, unknown>
): GeminiRequestBody {
  const system: string[] = [];
  const contents: GeminiContent[] = [];

  request.messages.forEach((message, index) => {
    switch (message.role) {
      case 'system':
        // §6.3 sends the static prompt and the data catalog as two system
        // messages; Gemini takes one instruction block, so they are joined
        // rather than one of them being demoted to a user turn.
        system.push(message.content);
        return;

      case 'user':
        contents.push({ role: 'user', parts: [{ text: message.content }] });
        return;

      case 'assistant': {
        const parts: GeminiPart[] = [];
        if (message.content) parts.push({ text: message.content });
        for (const call of message.tool_calls ?? []) {
          parts.push({
            functionCall: { name: call.function.name, args: safeArgs(call.function.arguments) },
          });
        }
        if (parts.length > 0) contents.push({ role: 'model', parts });
        return;
      }

      case 'tool':
        contents.push({
          role: TOOL_RESULT_ROLE,
          parts: [
            {
              functionResponse: {
                name: toolNameFor(request.messages, index),
                // Gemini requires an object, and a tool result is not always
                // one — a bare number or a rejection string would be legal
                // JSON and an illegal response. Wrapping keeps it an object
                // without inventing a shape the model has to learn.
                response: { result: safeJson(message.content) },
              },
            },
          ],
        });
        return;
    }
  });

  return {
    ...(system.length > 0
      ? { systemInstruction: { parts: [{ text: system.join('\n\n') }] } }
      : {}),
    contents,
    ...(request.tools?.length ? { tools: toGeminiTools(request.tools.map((t) => t.function)) } : {}),
    ...(request.tools?.length
      ? {
          toolConfig: {
            functionCallingConfig: {
              mode: request.tool_choice === 'none' ? ('NONE' as const) : ('AUTO' as const),
            },
          },
        }
      : {}),
    generationConfig,
  };
}

function safeArgs(raw: string): Record<string, unknown> {
  const parsed = safeJson(raw);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export interface GeminiResponseBody {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { message?: string; status?: string };
}

/**
 * Gemini gives function calls no identifier, but the OpenAI shape needs one to
 * pair a result with its call. Synthesised from the position in the turn,
 * which is unique within it and is all the pairing requires.
 */
export function fromGeminiResponse(body: GeminiResponseBody): ChatReply {
  const parts = body.candidates?.[0]?.content?.parts ?? [];

  const text = parts
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  const toolCalls: ToolCall[] = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => part.functionCall)
    .map(({ part, index }) => ({
      id: `call_${index}`,
      type: 'function' as const,
      function: {
        name: part.functionCall!.name,
        arguments: JSON.stringify(part.functionCall!.args ?? {}),
      },
    }));

  return {
    message: {
      content: text === '' ? null : text,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    },
    meta: {
      usage: {
        prompt_tokens: body.usageMetadata?.promptTokenCount,
        completion_tokens: body.usageMetadata?.candidatesTokenCount,
      },
    },
  };
}
