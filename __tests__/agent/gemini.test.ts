/**
 * The OpenAI-shaped request → Gemini translation.
 *
 * These are the tests Stage B Phase 1 inherits when this function moves into
 * the Worker, so they are written against the shape rather than against this
 * transport: what Gemini is sent, and what comes back as a `ChatReply`.
 *
 * The content-equality case is the one §13.7 cares about — the envelope is
 * rewritten, the message text never is.
 */

import { fromGeminiResponse, toGeminiRequest, toGeminiSchema } from '@/agent/gemini';
import type { ChatRequest } from '@/agent/messages';
import { toolDeclarations } from '@/agent/tools';
import { queryLedgerTool } from '@/agent/tools/queryLedger';

const tools = toolDeclarations().map((declaration) => ({
  type: 'function' as const,
  function: declaration,
}));

function request(partial: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'chat-fast',
    stream: false,
    messages: [{ role: 'user', content: 'how much in June?' }],
    ...partial,
  };
}

describe('the schema subset', () => {
  it('names types the way Gemini does', () => {
    const schema = toGeminiSchema(queryLedgerTool.declaration.parameters);
    expect(schema.type).toBe('OBJECT');
    expect(schema.properties?.limit).toMatchObject({ type: 'INTEGER', minimum: 1, maximum: 50 });
    expect(schema.properties?.filters).toMatchObject({ type: 'ARRAY', maxItems: 4 });
  });

  it('gives an enum a type, which Gemini requires alongside it', () => {
    const schema = toGeminiSchema(queryLedgerTool.declaration.parameters);
    expect(schema.properties?.metric).toEqual({
      type: 'STRING',
      enum: ['sum_amount', 'avg_amount', 'count', 'list_items', 'list_bills'],
    });
  });

  /**
   * §14.1's `filters[].value` is the only untyped field, because what it must
   * be depends on the sibling `op` — a term for `eq` and `contains`, a list
   * for `in`. Gemini requires a type, and `anyOf` is the honest one.
   */
  it('expresses the untyped filter value as anyOf rather than guessing', () => {
    const schema = toGeminiSchema(queryLedgerTool.declaration.parameters);
    const value = schema.properties?.filters?.items?.properties?.value;
    expect(value).toEqual({
      anyOf: [{ type: 'STRING' }, { type: 'ARRAY', items: { type: 'STRING' } }],
    });
  });

  it('keeps required and nested properties', () => {
    const schema = toGeminiSchema(queryLedgerTool.declaration.parameters);
    expect(schema.required).toEqual(['metric']);
    expect(schema.properties?.time_range?.required).toEqual(['unit', 'last']);
  });
});

describe('the request', () => {
  it('lifts system messages into systemInstruction, joined', () => {
    const body = toGeminiRequest(
      request({
        messages: [
          { role: 'system', content: 'rules' },
          { role: 'system', content: '{"bill_count":3}' },
          { role: 'user', content: 'hi' },
        ],
      }),
      {}
    );
    expect(body.systemInstruction?.parts[0].text).toBe('rules\n\n{"bill_count":3}');
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('sends the tool declarations under functionDeclarations', () => {
    const body = toGeminiRequest(request({ tools }), {});
    expect(body.tools?.[0].functionDeclarations.map((d) => d.name)).toEqual([
      'query_ledger',
      'get_bill_detail',
      'update_bill_item',
      'delete_bill',
    ]);
    expect(body.toolConfig?.functionCallingConfig.mode).toBe('AUTO');
  });

  it('switches function calling off when the loop has switched tools off', () => {
    const body = toGeminiRequest(request({ tools, tool_choice: 'none' }), {});
    expect(body.toolConfig?.functionCallingConfig.mode).toBe('NONE');
  });

  it('sends no tool config when there are no tools', () => {
    const body = toGeminiRequest(request(), {});
    expect(body.tools).toBeUndefined();
    expect(body.toolConfig).toBeUndefined();
  });

  it('turns an assistant tool call into a model functionCall part', () => {
    const body = toGeminiRequest(
      request({
        messages: [
          { role: 'user', content: 'how much?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'query_ledger', arguments: '{"metric":"count"}' },
              },
            ],
          },
        ],
      }),
      {}
    );
    expect(body.contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { name: 'query_ledger', args: { metric: 'count' } } }],
    });
  });

  /**
   * Gemini pairs a result with its call by *name*; the OpenAI shape uses an
   * opaque id. The name has to be recovered from the assistant turn, and
   * getting it wrong is the kind of bug that shows up as the model answering
   * a question nobody asked.
   */
  it('recovers the tool name for a result from the call that made it', () => {
    const body = toGeminiRequest(
      request({
        messages: [
          { role: 'user', content: 'how much?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'query_ledger', arguments: '{}' } },
              { id: 'b', type: 'function', function: { name: 'get_bill_detail', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'b', content: '{"id":7}' },
        ],
      }),
      {}
    );
    expect(body.contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'get_bill_detail', response: { result: { id: 7 } } } }],
    });
  });

  it('wraps a tool result that is not an object, rather than sending an illegal one', () => {
    const body = toGeminiRequest(
      request({
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'a', type: 'function', function: { name: 'query_ledger', arguments: '{}' } },
            ],
          },
          { role: 'tool', tool_call_id: 'a', content: 'not json at all' },
        ],
      }),
      {}
    );
    expect(body.contents[1].parts[0].functionResponse?.response).toEqual({
      result: 'not json at all',
    });
  });

  /** §13.7: the envelope is rewritten, the content never is. */
  it('passes message text through unchanged', () => {
    const text = 'How much did I spend at PAK\'nSAVE on 豆腐干? 100% sure.';
    const body = toGeminiRequest(request({ messages: [{ role: 'user', content: text }] }), {});
    expect(body.contents[0].parts[0].text).toBe(text);
  });

  it('carries the generation config through untouched', () => {
    const body = toGeminiRequest(request(), { temperature: 0, thinkingConfig: { thinkingLevel: 'low' } });
    expect(body.generationConfig).toEqual({
      temperature: 0,
      thinkingConfig: { thinkingLevel: 'low' },
    });
  });
});

describe('the response', () => {
  it('reads a plain answer', () => {
    const reply = fromGeminiResponse({
      candidates: [{ content: { parts: [{ text: '{"text":"You spent $12."}' }] } }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, thoughtsTokenCount: 120 },
    });
    expect(reply.message.content).toBe('{"text":"You spent $12."}');
    expect(reply.message.tool_calls).toBeUndefined();
    expect(reply.meta?.usage).toEqual({ prompt_tokens: 900, completion_tokens: 40 });
  });

  it('gives every function call an id, since Gemini supplies none', () => {
    const reply = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: 'query_ledger', args: { metric: 'count' } } },
              { functionCall: { name: 'get_bill_detail', args: { bill_id: 3 } } },
            ],
          },
        },
      ],
    });
    const ids = reply.message.tool_calls?.map((call) => call.id) ?? [];
    expect(new Set(ids).size).toBe(2);
    expect(reply.message.tool_calls?.[0].function).toEqual({
      name: 'query_ledger',
      arguments: '{"metric":"count"}',
    });
  });

  it('handles a turn with both text and a call', () => {
    const reply = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [{ text: 'Let me check.' }, { functionCall: { name: 'query_ledger' } }],
          },
        },
      ],
    });
    expect(reply.message.content).toBe('Let me check.');
    expect(reply.message.tool_calls).toHaveLength(1);
    expect(reply.message.tool_calls?.[0].function.arguments).toBe('{}');
  });

  it('survives an empty candidate rather than throwing', () => {
    expect(fromGeminiResponse({})).toEqual({
      message: { content: null },
      meta: { usage: { prompt_tokens: undefined, completion_tokens: undefined } },
    });
  });
});

/**
 * Gemini 3 signs the reasoning behind a function call and refuses the *next*
 * turn if the signature does not come back — which is why the first live
 * question failed after the tool had already run, and why none of the
 * single-turn tests above could have caught it.
 */
describe('thought signatures survive the round trip', () => {
  it('reads the signature off a function call', () => {
    const reply = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'query_ledger', args: { metric: 'count' } },
                thoughtSignature: 'Ct0BAbc123==',
              },
            ],
          },
        },
      ],
    });
    expect(reply.message.tool_calls?.[0].thought_signature).toBe('Ct0BAbc123==');
  });

  it('sends it back verbatim on the next turn', () => {
    const body = toGeminiRequest(
      request({
        messages: [
          { role: 'user', content: 'how much?' },
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'c1',
                type: 'function',
                function: { name: 'query_ledger', arguments: '{"metric":"count"}' },
                thought_signature: 'Ct0BAbc123==',
              },
            ],
          },
          { role: 'tool', tool_call_id: 'c1', content: '{"row_count":1}' },
        ],
      }),
      {}
    );
    expect(body.contents[1].parts[0]).toEqual({
      functionCall: { name: 'query_ledger', args: { metric: 'count' } },
      thoughtSignature: 'Ct0BAbc123==',
    });
  });

  it('omits the field entirely when there is none, rather than sending null', () => {
    const body = toGeminiRequest(
      request({
        messages: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'query_ledger', arguments: '{}' } },
            ],
          },
        ],
      }),
      {}
    );
    expect(body.contents[0].parts[0]).not.toHaveProperty('thoughtSignature');
  });

  it('keeps signatures with their own calls when a turn makes two', () => {
    const reply = fromGeminiResponse({
      candidates: [
        {
          content: {
            parts: [
              { functionCall: { name: 'query_ledger' }, thoughtSignature: 'first' },
              { functionCall: { name: 'get_bill_detail' }, thoughtSignature: 'second' },
            ],
          },
        },
      ],
    });
    expect(reply.message.tool_calls?.map((call) => call.thought_signature)).toEqual([
      'first',
      'second',
    ]);
  });
});
