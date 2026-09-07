/**
 * The orchestrator, §6.1 — driven by a scripted transport against a real
 * SQLite ledger, so the tool results are the ones the model would actually
 * see.
 *
 * The cases that matter are the unhappy ones: a rejection has to reach the
 * model rather than the user, a second rejection has to stop, the cap has to
 * produce an answer, and a write must not touch the database no matter what
 * the model says.
 */

import { openTestDriver } from '../support/sqlite-driver';

import type { ChatTransport } from '@/agent/chatTransport';
import type { DataCatalog } from '@/agent/catalog';
import { MAX_ITERATIONS, runAgentTurn, type AgentDeps } from '@/agent/loop';
import type { ChatReply, ChatRequest, ToolCall } from '@/agent/messages';
import { TransportRequestError, TransportUnavailableError } from '@/agent/parseTransport';
import type { SqlDriver } from '@/data/driver';
import { migrate } from '@/data/migrate';
import { CATEGORIES } from '@/types/vocabulary';

const catalog: DataCatalog = {
  categories: CATEGORIES,
  merchants_top: ['Countdown'],
  data_range: { first_bill: '2026-06-01', last_bill: '2026-06-30' },
  currency: 'NZD',
  bill_count: 2,
};

function call(name: string, args: unknown, id = 'c1'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
  };
}

function says(text: string): ChatReply {
  return { message: { content: JSON.stringify({ text }) }, meta: { usage: { prompt_tokens: 10, completion_tokens: 5 } } };
}

function calls(...toolCalls: ToolCall[]): ChatReply {
  return { message: { content: null, tool_calls: toolCalls } };
}

/** Replays a script, and records what it was asked. */
function scripted(replies: ChatReply[]): ChatTransport & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    name: 'scripted',
    requests,
    async chat(request) {
      requests.push(request);
      const next = replies.shift();
      if (!next) throw new Error('the loop asked more times than the script allows');
      return next;
    },
  };
}

describe('the loop', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = openTestDriver();
    await migrate(db);
    await db.run(
      `INSERT INTO bills (id, merchant, merchant_norm, purchased_at, total_cents, source,
                          created_at, updated_at)
       VALUES (1, 'Countdown', 'countdown', '2026-06-05', 5000, 'receipt', ?, ?)`,
      ['2026-06-05T00:00:00.000Z', '2026-06-05T00:00:00.000Z']
    );
    await db.run(
      `INSERT INTO bill_items (bill_id, line_no, name, category, price_cents)
       VALUES (1, 1, 'milk 2l', 'dairy', 2000)`
    );
  });

  afterEach(async () => {
    await db.close();
  });

  function deps(transport: ChatTransport): AgentDeps {
    let tick = 0;
    return {
      transport,
      db,
      catalog,
      validation: { today: '2026-06-30', firstBill: '2026-06-01' },
      now: () => (tick += 100),
    };
  }

  it('answers a question that needs no tool', async () => {
    const turn = await runAgentTurn('hello', [], deps(scripted([says('Hello.')])));
    expect(turn.envelope.text).toBe('Hello.');
    expect(turn.log).toMatchObject({ route: 'agent', outcome: 'ok', toolCalls: [] });
    expect(turn.log.latencyMs).toBeGreaterThan(0);
  });

  it('runs a tool, feeds the result back, and answers from it', async () => {
    const transport = scripted([
      calls(call('query_ledger', { metric: 'sum_amount', time_range: { unit: 'month', last: 1 } })),
      says('You spent $50.00 in June.'),
    ]);
    const turn = await runAgentTurn('how much in June?', [], deps(transport));

    expect(turn.envelope.text).toBe('You spent $50.00 in June.');
    expect(turn.log.toolCalls).toEqual([{ name: 'query_ledger', status: 'ok' }]);

    // The second request carries the assistant's call and the tool result.
    const second = transport.requests[1].messages;
    expect(second.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
    expect(JSON.parse((second.at(-1) as { content: string }).content)).toMatchObject({
      row_count: 1,
      // The plain total came from printed bill totals, not item prices — so
      // the model can say so rather than guess (§14.6).
      amounts_from: 'printed_bill_totals',
    });
  });

  it('accumulates usage across every call in the turn', async () => {
    const transport = scripted([calls(call('query_ledger', { metric: 'count' })), says('Two.')]);
    const turn = await runAgentTurn('how many?', [], deps(transport));
    expect(turn.log).toMatchObject({ tokensIn: 10, tokensOut: 5, modelAlias: 'chat-fast' });
  });
});

describe('when the model gets it wrong', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = openTestDriver();
    await migrate(db);
  });

  afterEach(async () => {
    await db.close();
  });

  function deps(transport: ChatTransport): AgentDeps {
    return {
      transport,
      db,
      catalog,
      validation: { today: '2026-06-30', firstBill: null },
    };
  }

  /**
   * §14.5: the rejection goes back to the model as the tool result. The user
   * should never see it, and the turn is logged `retry` rather than `ok`.
   */
  it('hands a rejection to the model and lets it correct itself', async () => {
    const transport = scripted([
      calls(call('query_ledger', { metric: 'SUM_AMOUNT' })),
      calls(call('query_ledger', { metric: 'sum_amount' }, 'c2')),
      says('You spent nothing.'),
    ]);
    const turn = await runAgentTurn('how much?', [], deps(transport));

    expect(turn.envelope.text).toBe('You spent nothing.');
    expect(turn.log.outcome).toBe('retry');
    expect(turn.log.toolCalls.map((c) => c.status)).toEqual(['rejected', 'ok']);

    const rejection = JSON.parse(
      (transport.requests[1].messages.at(-1) as { content: string }).content
    );
    expect(rejection.code ?? rejection.error).toBe('invalid_enum');
    expect(rejection.message).toContain('sum_amount');
  });

  it('stops after the second failure rather than paying for a third', async () => {
    const transport = scripted([
      calls(call('query_ledger', { metric: 'nope' })),
      calls(call('query_ledger', { metric: 'still_nope' }, 'c2')),
    ]);
    const turn = await runAgentTurn('how much?', [], deps(transport));

    expect(turn.log).toMatchObject({ outcome: 'error', errorCode: 'validation_failed' });
    expect(turn.envelope.text).toContain('different way');
  });

  it('treats arguments that are not JSON as a rejection, not a crash', async () => {
    const transport = scripted([
      calls(call('query_ledger', '{"metric": ')),
      says('Sorry, let me try again.'),
    ]);
    const turn = await runAgentTurn('how much?', [], deps(transport));
    expect(turn.log.toolCalls).toEqual([{ name: 'query_ledger', status: 'rejected' }]);
    expect(turn.log.outcome).toBe('retry');
  });

  it('rejects a tool it never sent', async () => {
    const transport = scripted([calls(call('drop_everything', {})), says('I cannot do that.')]);
    const turn = await runAgentTurn('delete it all', [], deps(transport));
    expect(turn.log.toolCalls).toEqual([{ name: 'drop_everything', status: 'rejected' }]);
  });

  it('asks for a partial answer when it hits the cap (§6.1)', async () => {
    const script: ChatReply[] = [];
    for (let i = 0; i < MAX_ITERATIONS; i += 1) {
      script.push(calls(call('query_ledger', { metric: 'count' }, 'c' + i)));
    }
    script.push(says("Here's what I found so far: nothing yet."));
    const transport = scripted(script);

    const turn = await runAgentTurn('how much?', [], deps(transport));
    expect(turn.envelope.text).toContain('found so far');
    expect(turn.log).toMatchObject({ outcome: 'fallback', errorCode: 'loop_cap' });
    // The last request had the tools switched off, or it would loop forever.
    expect(transport.requests.at(-1)?.tool_choice).toBe('none');
  });

  it('shows an offline notice when the network fails', async () => {
    const transport: ChatTransport = {
      name: 'broken',
      chat: async () => {
        throw new Error('Network request failed');
      },
    };
    const turn = await runAgentTurn('how much?', [], deps(transport));
    expect(turn.envelope.text).toContain('could not reach');
    expect(turn.log).toMatchObject({ outcome: 'error', errorCode: 'transport_error' });
  });

  /**
   * These three were one message once, which made an unreachable network and a
   * provider rejecting the request look identical to the user — and they are
   * the two most likely faults, needing opposite fixes. The detail comes back
   * on the turn rather than in `query_log`, which §15.3 keeps free of content.
   */
  it('says the provider refused, not that the network is down', async () => {
    const transport: ChatTransport = {
      name: 'rejecting',
      chat: async () => {
        throw new TransportRequestError('Invalid JSON payload: unknown name "anyOf"', 400);
      },
    };
    const turn = await runAgentTurn('how much?', [], deps(transport));
    expect(turn.envelope.text).not.toContain('could not reach');
    expect(turn.envelope.text).toContain('refused');
    expect(turn.log.errorCode).toBe('upstream_error');
    expect(turn.errorDetail).toContain('anyOf');
  });

  it('names the fix when no key is configured', async () => {
    const transport: ChatTransport = {
      name: 'unconfigured',
      chat: async () => {
        throw new TransportUnavailableError('No API key is set. Add one in Settings.');
      },
    };
    const turn = await runAgentTurn('how much?', [], deps(transport));
    expect(turn.envelope.text).toContain('Settings');
    expect(turn.log.errorCode).toBe('transport_unavailable');
  });

  it('still records the turn when it fails', async () => {
    const transport: ChatTransport = {
      name: 'broken',
      chat: async () => {
        throw new Error('boom');
      },
    };
    const turn = await runAgentTurn('how much?', [], deps(transport));
    expect(turn.log).toMatchObject({ route: 'agent', outcome: 'error' });
  });
});

/** §6.8: "No write ever commits without an explicit user tap." */
describe('writes never commit', () => {
  let db: SqlDriver;

  beforeEach(async () => {
    db = openTestDriver();
    await migrate(db);
    await db.run(
      `INSERT INTO bills (id, merchant, merchant_norm, purchased_at, total_cents, source,
                          created_at, updated_at)
       VALUES (1, 'Countdown', 'countdown', '2026-06-05', 5000, 'receipt', ?, ?)`,
      ['2026-06-05T00:00:00.000Z', '2026-06-05T00:00:00.000Z']
    );
    await db.run(
      `INSERT INTO bill_items (id, bill_id, line_no, name, category, price_cents)
       VALUES (7, 1, 1, 'milk 2l', 'dairy', 2000)`
    );
  });

  afterEach(async () => {
    await db.close();
  });

  async function remaining(): Promise<{ bills: number; category: string }> {
    const row = await db.get<{ bills: number; category: string }>(
      'SELECT (SELECT COUNT(*) FROM bills) AS bills, (SELECT category FROM bill_items WHERE id = 7) AS category'
    );
    return row!;
  }

  it.each([
    ['update_bill_item', { bill_item_id: 7, set: { category: 'snacks' } }],
    ['delete_bill', { bill_id: 1, reason: 'duplicate' }],
  ])('returns %s as pending and changes nothing', async (name, args) => {
    const transport = scripted([
      calls(call(name, args)),
      { message: { content: JSON.stringify({ text: 'Shall I?', pending_actions: [{ tool: name, summary: 's' }] }) } },
    ]);
    const turn = await runAgentTurn('fix it', [], {
      transport,
      db,
      catalog,
      validation: { today: '2026-06-30', firstBill: '2026-06-01' },
    });

    expect(turn.log.toolCalls).toEqual([{ name, status: 'pending' }]);
    expect(turn.envelope.pending_actions).toEqual([{ tool: name, summary: 's' }]);
    expect(await remaining()).toEqual({ bills: 1, category: 'dairy' });

    // §6.4: the write ends the tool phase, so nothing else can be proposed
    // alongside it.
    expect(transport.requests.at(-1)?.tool_choice).toBe('none');
  });
});
