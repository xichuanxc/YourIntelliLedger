/**
 * The app's half of §13.2.
 *
 * Two things worth pinning: the app sends an *alias* and never a model name
 * (§13.5 is the whole reason the hub exists), and §13.6's codes become the two
 * failures the loop can act on — one that names a fix, one that does not.
 */

import { createHubChatTransport } from '@/agent/hubChatTransport';
import type { ChatRequest } from '@/agent/messages';
import { TransportRequestError, TransportUnavailableError } from '@/agent/parseTransport';

// `getAskKey`, not `getByokKey`: Ask has its own key now, because the hub may
// be pointed at a different provider from the one receipt parsing uses
// (§13.5). It falls back to the receipt key, which is why one key still works.
jest.mock('@/agent/byokKey', () => ({
  getAskKey: jest.fn(async () => 'test-key'),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getAskKey } = require('@/agent/byokKey') as { getAskKey: jest.Mock };

const request: ChatRequest = {
  model: 'chat-fast',
  stream: false,
  messages: [{ role: 'user', content: 'how much did I spend?' }],
};

function stub(body: unknown, status = 200): jest.Mock {
  return jest.fn(async () => new Response(JSON.stringify(body), { status }));
}

const answer = { message: { content: '{"text":"You spent $12."}' }, hub_meta: { model_used: 'x' } };

beforeEach(() => {
  getAskKey.mockResolvedValue('test-key');
});

describe('the request', () => {
  it('posts the alias, not a model name (§13.5)', async () => {
    const fetchImpl = stub(answer);
    await createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/v1/chat');
    expect(JSON.parse(init.body as string).model).toBe('chat-fast');
    expect(init.body).not.toContain('gemini');
  });

  it('carries the Ask key in X-BYOK, which phase 1 still needs', async () => {
    const fetchImpl = stub(answer);
    await createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request);
    expect(fetchImpl.mock.calls[0][1].headers['X-BYOK']).toBe('test-key');
  });

  it('returns the hub_meta as the reply’s usage', async () => {
    const fetchImpl = stub({
      message: { content: 'hi' },
      hub_meta: { model_used: 'gemini-3.6-flash', usage: { prompt_tokens: 900 } },
    });
    const reply = await createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request);
    expect(reply.meta?.usage?.prompt_tokens).toBe(900);
  });
});

describe('failures the user can act on', () => {
  it('asks for a key when none is stored', async () => {
    getAskKey.mockResolvedValue(null);
    const fetchImpl = stub(answer);
    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
    ).rejects.toBeInstanceOf(TransportUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['attestation_required', 'token_invalid', 'token_expired'])(
    'treats %s as "check your key", not as an outage',
    async (code) => {
      const fetchImpl = stub({ error: { code, message: 'nope' } }, 403);
      await expect(
        createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
      ).rejects.toBeInstanceOf(TransportUnavailableError);
    }
  );

  it('names the update when the app is too old', async () => {
    const fetchImpl = stub({ error: { code: 'app_version_unsupported' } }, 403);
    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
    ).rejects.toThrow(/update/i);
  });

  it('says the ledger still works when the quota is spent (§13.3)', async () => {
    const fetchImpl = stub({ error: { code: 'quota_exceeded' } }, 429);
    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
    ).rejects.toThrow(/ledger still works/i);
  });
});

describe('failures the user cannot', () => {
  it.each([
    ['unknown_model', 400],
    ['rate_limited', 429],
    ['upstream_error', 502],
  ])('reports %s as a request fault', async (code, status) => {
    const fetchImpl = stub({ error: { code, message: 'detail' } }, status);
    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
    ).rejects.toBeInstanceOf(TransportRequestError);
  });

  it('does not pretend an unreachable hub was an answer', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('Network request failed');
    });
    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
    ).rejects.toBeInstanceOf(TransportRequestError);
  });

  it('rejects a 200 with no message rather than passing undefined on', async () => {
    const fetchImpl = stub({ hub_meta: {} });
    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request)
    ).rejects.toThrow(/no message/i);
  });
});

/**
 * §13.2's event stream, read back into the same `ChatReply` a whole response
 * gives — streaming is a delivery detail, and nothing above the transport
 * should be able to tell which one it got.
 */
describe('the streamed form', () => {
  const encoder = new TextEncoder();

  /** A hub SSE response, delivered in whatever pieces the caller asks for. */
  function sse(...pieces: string[]) {
    return jest.fn(
      async (_url: string, _init: { body?: string }) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const piece of pieces) controller.enqueue(encoder.encode(piece));
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    );
  }

  const meta = 'event: hub_meta\ndata: {"model_used":"m","usage":{"prompt_tokens":9}}\n\n';

  it('asks for a stream only when someone is listening', async () => {
    const quiet = stub(answer);
    await createHubChatTransport(quiet as unknown as typeof fetch).chat(request);
    expect(JSON.parse(quiet.mock.calls[0][1].body as string).stream).toBe(false);

    const loud = sse(meta, 'data: [DONE]\n\n');
    await createHubChatTransport(loud as unknown as typeof fetch).chat(request, () => {});
    expect(JSON.parse(loud.mock.calls[0][1].body as string).stream).toBe(true);
  });

  it('reports everything received so far, not the increment', async () => {
    const seen: string[] = [];
    const fetchImpl = sse(
      'data: {"delta":"{\\"text\\":\\"You "}\n\n',
      'data: {"delta":"spent $12.\\"}"}\n\n',
      meta,
      'data: [DONE]\n\n'
    );

    const reply = await createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(
      request,
      (raw) => seen.push(raw)
    );

    expect(seen).toEqual(['{"text":"You ', '{"text":"You spent $12."}']);
    expect(reply.message.content).toBe('{"text":"You spent $12."}');
    expect(reply.meta?.usage?.prompt_tokens).toBe(9);
  });

  /** A chunk boundary lands wherever the network puts it, not on a line. */
  it('reassembles an event split across two reads', async () => {
    const seen: string[] = [];
    const fetchImpl = sse('data: {"del', 'ta":"hi"}\n\n', meta, 'data: [DONE]\n\n');

    await createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request, (raw) =>
      seen.push(raw)
    );

    expect(seen).toEqual(['hi']);
  });

  it('delivers tool calls whole, as the non-streaming path does', async () => {
    const fetchImpl = sse(
      'event: tool_calls\ndata: [{"id":"c1","type":"function","function":{"name":"query_ledger","arguments":"{}"},"thought_signature":"sig"}]\n\n',
      meta,
      'data: [DONE]\n\n'
    );

    const reply = await createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(
      request,
      () => {}
    );

    expect(reply.message.tool_calls?.[0]).toMatchObject({
      function: { name: 'query_ledger' },
      thought_signature: 'sig',
    });
  });

  /**
   * The status was already 200 before the provider refused, so a failure can
   * only arrive inside the body — and a stream that simply stops is a failed
   * turn, not a short answer. Treating it as an answer would show a truncated
   * sentence as if it were complete.
   */
  it('treats an error event as a failure, not an answer', async () => {
    const fetchImpl = sse(
      'data: {"delta":"You sp"}\n\n',
      'event: error\ndata: {"code":"upstream_error","detail":"bad value at contents[1]"}\n\n'
    );

    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request, () => {})
    ).rejects.toThrow(/contents\[1\]/);
  });

  it('refuses a stream that stops before hub_meta', async () => {
    const fetchImpl = sse('data: {"delta":"You sp"}\n\n');

    await expect(
      createHubChatTransport(fetchImpl as unknown as typeof fetch).chat(request, () => {})
    ).rejects.toThrow(/stopped before it finished/);
  });
});
