/**
 * §6.7: "An unparseable envelope falls back to showing the model's text only —
 * never a crash." So the interesting tests here are all the ways a model
 * answers badly.
 */

import { parseEnvelope } from '@/agent/envelope';

describe('a well-formed envelope', () => {
  it('is passed through', () => {
    const result = parseEnvelope(
      JSON.stringify({
        text: 'You spent $214 on groceries in June.',
        render: {
          type: 'bar',
          title: 'Grocery spend',
          x: { label: 'Category', values: ['Produce', 'Dairy'] },
          series: [{ label: 'NZD', values: [64.2, 43.1] }],
        },
        followups: ['Compare to May'],
      })
    );
    expect(result.degraded).toBe(false);
    expect(result.envelope.render?.type).toBe('bar');
    expect(result.envelope.followups).toEqual(['Compare to May']);
  });

  it('survives being wrapped in a single-element array', () => {
    // Same salvage as a code fence: one envelope arrived, just parcelled.
    expect(parseEnvelope('[{"text":"You spent $12."}]')).toEqual({
      envelope: { text: 'You spent $12.' },
      degraded: false,
    });
  });

  it('survives a code fence and surrounding prose', () => {
    const result = parseEnvelope('Sure!\n```json\n{"text":"You spent $12."}\n```\nHope that helps.');
    expect(result).toEqual({ envelope: { text: 'You spent $12.' }, degraded: false });
  });
});

describe('falling back rather than crashing', () => {
  it.each([
    ['plain prose', 'You spent about twelve dollars.'],
    ['broken JSON', '{"text": "You spent $12.'],
    ['an empty string', ''],
    ['an object with no text', '{"render":{"type":"bar"}}'],
    ['an object whose text is blank', '{"text":"   "}'],
    ['a non-string text', '{"text":42}'],
    ['two envelopes at once', '[{"text":"a"},{"text":"b"}]'],
  ])('degrades on %s', (_label, raw) => {
    const result = parseEnvelope(raw);
    expect(result.degraded).toBe(true);
    expect(result.envelope.render).toBeUndefined();
  });

  /**
   * Keeping the model's own words matters: a correct sentence in a broken
   * envelope is still a correct sentence, and replacing it with an apology
   * would be the app losing the answer rather than the model.
   */
  it('keeps what the model actually said', () => {
    expect(parseEnvelope('You spent about twelve dollars.').envelope.text).toBe(
      'You spent about twelve dollars.'
    );
  });
});

describe('salvaging a bad field without losing the answer', () => {
  it.each(['pie', 'BAR', '', 'none'])('drops an unusable render type %s', (type) => {
    const result = parseEnvelope(JSON.stringify({ text: 'ok', render: { type } }));
    expect(result.degraded).toBe(false);
    expect(result.envelope.render).toBeUndefined();
  });

  it('drops a series that is not numeric rather than rendering NaN', () => {
    const result = parseEnvelope(
      JSON.stringify({ text: 'ok', render: { type: 'bar', series: [{ values: ['a', 'b'] }] } })
    );
    expect(result.envelope.render).toEqual({ type: 'bar' });
  });

  it('caps followups at something a person will read', () => {
    const result = parseEnvelope(
      JSON.stringify({ text: 'ok', followups: ['a', 'b', 'c', 'd', 'e', 'f'] })
    );
    expect(result.envelope.followups).toHaveLength(4);
  });

  /**
   * §6.8: "No write ever commits without an explicit user tap." A card is how
   * the tap is offered, so a card naming a read-only or invented tool is not a
   * card the UI could honour.
   */
  it.each(['query_ledger', 'get_bill_detail', 'rm_rf', '__proto__'])(
    'drops a pending action naming %s',
    (tool) => {
      const result = parseEnvelope(
        JSON.stringify({ text: 'ok', pending_actions: [{ tool, summary: 's' }] })
      );
      expect(result.envelope.pending_actions).toBeUndefined();
    }
  );

  it('keeps a pending action naming a real write tool', () => {
    const result = parseEnvelope(
      JSON.stringify({
        text: 'ok',
        pending_actions: [{ tool: 'update_bill_item', summary: "Set 'milk' to dairy", ref: 'a1' }],
      })
    );
    expect(result.envelope.pending_actions).toEqual([
      { tool: 'update_bill_item', summary: "Set 'milk' to dairy", ref: 'a1' },
    ]);
  });
});
