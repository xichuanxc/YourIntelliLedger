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

jest.mock('@/agent/byokKey', () => ({
  getByokKey: jest.fn(async () => 'test-key'),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getByokKey } = require('@/agent/byokKey') as { getByokKey: jest.Mock };

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
  getByokKey.mockResolvedValue('test-key');
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

  it('carries the key in X-BYOK, which phase 1 still needs', async () => {
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
    getByokKey.mockResolvedValue(null);
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
