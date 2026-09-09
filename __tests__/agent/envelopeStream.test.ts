/**
 * Reading a half-arrived answer.
 *
 * Every case here is a chunk boundary landing somewhere awkward — which is the
 * only thing that goes wrong, is miserable to reproduce against a live model,
 * and is trivial to write down.
 */

import { partialAnswer } from '@/agent/envelopeStream';

describe('while the envelope is still arriving', () => {
  it('shows nothing before the text field has started', () => {
    expect(partialAnswer('')).toBe('');
    expect(partialAnswer('{')).toBe('');
    expect(partialAnswer('{"te')).toBe('');
    expect(partialAnswer('{"text"')).toBe('');
    expect(partialAnswer('{"text":')).toBe('');
  });

  it('shows the sentence as it lands', () => {
    expect(partialAnswer('{"text":"You spent ')).toBe('You spent ');
    expect(partialAnswer('{"text":"You spent $12.')).toBe('You spent $12.');
  });

  it('stops at the closing quote, not at the end of the object', () => {
    expect(partialAnswer('{"text":"You spent $12.","render":{"type":"bar"}}')).toBe(
      'You spent $12.'
    );
  });

  it('tolerates whitespace the model puts in its own JSON', () => {
    expect(partialAnswer('{ "text" : "You spent')).toBe('You spent');
  });

  it('finds the field inside a code fence', () => {
    expect(partialAnswer('```json\n{"text":"You spent')).toBe('You spent');
  });
});

describe('escapes, which is where a naive reader breaks', () => {
  it('decodes the ones JSON defines', () => {
    expect(partialAnswer('{"text":"She said \\"hi\\" twice')).toBe('She said "hi" twice');
    expect(partialAnswer('{"text":"line\\nbreak')).toBe('line\nbreak');
    expect(partialAnswer('{"text":"a\\\\b')).toBe('a\\b');
  });

  it('decodes a unicode escape', () => {
    expect(partialAnswer('{"text":"caf\\u00e9')).toBe('café');
  });

  /**
   * The reason this holds back rather than guessing: a trailing backslash
   * might begin `\\n` or `\\"`, and emitting either would put a character on
   * screen that the final answer then removes — a visible flicker for nothing.
   */
  it('waits rather than guessing at a half-arrived escape', () => {
    expect(partialAnswer('{"text":"line\\')).toBe('line');
    expect(partialAnswer('{"text":"caf\\u00')).toBe('caf');
    expect(partialAnswer('{"text":"caf\\u00e')).toBe('caf');
  });

  it('does not mistake an escaped quote for the end of the answer', () => {
    expect(partialAnswer('{"text":"a \\" b","render"')).toBe('a " b');
  });

  it('stops at an escape JSON does not define, rather than inventing one', () => {
    expect(partialAnswer('{"text":"ok\\x41')).toBe('ok');
  });
});

describe('when the model is not sending an envelope at all', () => {
  /** It shows nothing, and `parseEnvelope` salvages the prose at the end. */
  it('shows nothing for plain prose', () => {
    expect(partialAnswer('You spent about twelve dollars.')).toBe('');
  });

  it('is not fooled by the word text appearing in the answer', () => {
    expect(partialAnswer('{"text":"the text of the receipt"}')).toBe('the text of the receipt');
  });
});
