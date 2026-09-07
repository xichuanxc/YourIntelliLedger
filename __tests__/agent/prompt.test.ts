/**
 * §6.3's assembly order, and the two properties it exists to protect: the
 * prefix stays byte-identical, and the history never starts mid-turn.
 */

import { createMemoryCatalogCache, getDataCatalog, type DataCatalog } from '@/agent/catalog';
import type { ChatMessage } from '@/agent/messages';
import { HISTORY_TURNS, SYSTEM_PROMPT, assembleMessages, assembleRequest, recentHistory } from '@/agent/prompt';
import { openTestDriver } from '../support/sqlite-driver';
import { migrate } from '@/data/migrate';

const catalog: DataCatalog = {
  categories: ['produce'],
  merchants_top: ['Countdown'],
  data_range: { first_bill: '2026-02-03', last_bill: '2026-07-19' },
  currency: 'NZD',
  bill_count: 142,
} as unknown as DataCatalog;

function user(text: string): ChatMessage {
  return { role: 'user', content: text };
}

function assistant(text: string): ChatMessage {
  return { role: 'assistant', content: text };
}

describe('assembly order (§6.3)', () => {
  it('puts the static prefix first and the catalog after it', () => {
    const messages = assembleMessages({ catalog, history: [], userMessage: 'how much in June?' });
    expect(messages.map((m) => m.role)).toEqual(['system', 'system', 'user']);
    expect(messages[0].content).toBe(SYSTEM_PROMPT);
    expect(messages[1].content).toContain('142');
    expect(messages[2].content).toBe('how much in June?');
  });

  /**
   * The prefix cache is the reason §6.3 draws the boxes in that order. If the
   * catalog were appended to the system prompt, every conversation would have
   * a different first message and the provider would re-read the whole prompt
   * and four tool schemas on every turn.
   */
  it('keeps the prefix byte-identical across different ledgers', async () => {
    const db = openTestDriver();
    await migrate(db);
    const other = await getDataCatalog(db, createMemoryCatalogCache());
    await db.close();

    const a = assembleMessages({ catalog, history: [], userMessage: 'x' });
    const b = assembleMessages({ catalog: other, history: [], userMessage: 'y' });
    expect(a[0].content).toBe(b[0].content);
    expect(a[1].content).not.toBe(b[1].content);
  });

  it('sends all four tools with an alias, never a model name (§13.5)', () => {
    const request = assembleRequest({ catalog, history: [], userMessage: 'x' }, true);
    expect(request.model).toBe('chat-fast');
    expect(request.tools?.map((t) => t.function.name)).toEqual([
      'query_ledger',
      'get_bill_detail',
      'update_bill_item',
      'delete_bill',
    ]);
    expect(JSON.stringify(request)).not.toContain('gemini');
  });

  it('omits the user message when the loop is continuing after a tool result', () => {
    const history: ChatMessage[] = [user('a'), assistant('b')];
    const messages = assembleMessages({ catalog, history });
    expect(messages.at(-1)).toEqual(assistant('b'));
  });
});

describe('the history window', () => {
  function conversation(turns: number): ChatMessage[] {
    return Array.from({ length: turns }, (_, i) => [user('q' + i), assistant('a' + i)]).flat();
  }

  it('keeps everything while it fits', () => {
    const history = conversation(3);
    expect(recentHistory(history)).toEqual(history);
  });

  it('keeps the last six turns', () => {
    const kept = recentHistory(conversation(10));
    expect(kept).toHaveLength(HISTORY_TURNS * 2);
    expect(kept[0]).toEqual(user('q4'));
  });

  /**
   * Cutting a fixed number of *messages* rather than turns is the bug this
   * guards: it routinely leaves a `tool` result whose `assistant` tool call
   * was dropped, and some providers reject that outright.
   */
  it('never starts on an orphaned tool result', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 10; i += 1) {
      history.push(user('q' + i));
      history.push({
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 't' + i, type: 'function', function: { name: 'query_ledger', arguments: '{}' } },
        ],
      });
      history.push({ role: 'tool', tool_call_id: 't' + i, content: '{}' });
      history.push(assistant('a' + i));
    }
    expect(recentHistory(history)[0].role).toBe('user');
  });
});
