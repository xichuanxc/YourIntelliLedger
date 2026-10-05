/**
 * How hard the model is told to think before reading a receipt.
 *
 * §5.7 wants a parse inside six seconds and thinking is most of the wait, so
 * the request asks for the floor of the ladder. The floor is not universal:
 * measured against the live API, `gemini-3.7-flash` and `gemini-3.8-flash`
 * answer a request for `minimal` with a 400 — *"Thinking level MINIMAL is not
 * supported for this model"* — while 3.6-flash and both flash-lites accept it.
 * Version numbers do not predict it; the newer models are the stricter ones.
 *
 * What is pinned here is therefore the behaviour that keeps a parse working
 * whatever the model: ask for the floor, and if the model refuses the *level*
 * rather than the receipt, ask again one rung up and remember it.
 */

import { createByokTransport } from '@/agent/byokTransport';
import type { ParseRequest } from '@/agent/parseTransport';
import { TransportRequestError } from '@/agent/parseTransport';

/** Prefixed `mock` because that is the only name a jest.mock factory may reach. */
const mockOverride = jest.fn<Promise<string | null>, []>();

jest.mock('@/agent/byokKey', () => ({
  getByokKey: async () => 'test-key',
  getByokModelOverride: () => mockOverride(),
}));

jest.mock('@/agent/modelConfig', () => ({
  modelForAlias: () => 'gemini-3.6-flash',
}));

const request: ParseRequest = { prompt: 'read this', ocrText: 'MILK 2L 7.50' };

const PARSED = { candidates: [{ content: { parts: [{ text: '{"items":[]}' }] } }] };

const REFUSAL = {
  error: {
    code: 400,
    message: 'Thinking level MINIMAL is not supported for this model. Please retry with LOW.',
  },
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/** The thinking level each call asked for, in order. */
function levelsAsked(fetchMock: jest.Mock): string[] {
  return fetchMock.mock.calls.map(
    (call) => JSON.parse(String(call[1].body)).generationConfig.thinkingConfig.thinkingLevel
  );
}

let fetchMock: jest.Mock;

beforeEach(() => {
  mockOverride.mockResolvedValue(null);
  fetchMock = jest.fn(async () => reply(PARSED));
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('asking for the floor', () => {
  it('asks for minimal on a model that allows it', async () => {
    await createByokTransport().parseReceipt(request);

    expect(levelsAsked(fetchMock)).toEqual(['minimal']);
  });

  /** Seeded knowledge, so the common case costs no wasted request. */
  it('asks a known-strict model for low first time', async () => {
    mockOverride.mockResolvedValue('gemini-3.7-flash');

    await createByokTransport().parseReceipt(request);

    expect(levelsAsked(fetchMock)).toEqual(['low']);
  });
});

describe('a model that refuses the floor', () => {
  it('tries again one rung up rather than failing the parse', async () => {
    mockOverride.mockResolvedValue('gemini-9.9-unmeasured');
    fetchMock
      .mockImplementationOnce(async () => reply(REFUSAL, 400))
      .mockImplementationOnce(async () => reply(PARSED));

    const result = await createByokTransport().parseReceipt(request);

    expect(levelsAsked(fetchMock)).toEqual(['minimal', 'low']);
    expect(result.text).toContain('items');
  });

  /** A batch of receipts must not pay for the discovery once each. */
  it('remembers the refusal for the next receipt', async () => {
    mockOverride.mockResolvedValue('gemini-9.8-unmeasured');
    fetchMock
      .mockImplementationOnce(async () => reply(REFUSAL, 400))
      .mockImplementation(async () => reply(PARSED));

    const transport = createByokTransport();
    await transport.parseReceipt(request);
    fetchMock.mockClear();
    await transport.parseReceipt(request);

    expect(levelsAsked(fetchMock)).toEqual(['low']);
  });
});

describe('errors that are not about thinking', () => {
  it('does not retry a rejection of the request itself', async () => {
    fetchMock.mockImplementation(async () =>
      reply({ error: { code: 400, message: 'Request contains an invalid argument.' } }, 400)
    );

    await expect(createByokTransport().parseReceipt(request)).rejects.toThrow(
      TransportRequestError
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry a refusal that is already one rung up', async () => {
    mockOverride.mockResolvedValue('gemini-3.7-flash');
    fetchMock.mockImplementation(async () => reply(REFUSAL, 400));

    await expect(createByokTransport().parseReceipt(request)).rejects.toThrow(/Thinking level/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
