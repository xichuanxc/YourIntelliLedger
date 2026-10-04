/**
 * Which words in an answer become links.
 *
 * The bar throughout: a missing link is a small loss, a wrong link is the app
 * asserting something false. Every case below that refuses to link is refusing
 * on purpose.
 */

import type { BillReference } from '@/agent/execute';
import { linkify } from '@/ui/linkify';

const ref = (billId: number, label: string): BillReference => ({ billId, label });

describe('linking', () => {
  it('links a name a tool result vouched for', () => {
    expect(linkify('You bought milk 2l on Tuesday.', [ref(7, 'milk 2l')])).toEqual([
      { text: 'You bought ' },
      { text: 'milk 2l', billId: 7 },
      { text: ' on Tuesday.' },
    ]);
  });

  it('leaves the text alone when nothing was vouched for', () => {
    expect(linkify('You spent $214.', [])).toEqual([{ text: 'You spent $214.' }]);
  });

  it('links several names in one answer', () => {
    const segments = linkify('Milk and beef mince were the priciest.', [
      ref(7, 'milk'),
      ref(9, 'beef mince'),
    ]);
    expect(segments.filter((s) => s.billId).map((s) => [s.text, s.billId])).toEqual([
      ['Milk', 7],
      ['beef mince', 9],
    ]);
  });

  it('keeps the answer’s own capitalisation, not the stored spelling', () => {
    const [, link] = linkify('I found Beef Mince there.', [ref(9, 'beef mince')]);
    expect(link).toEqual({ text: 'Beef Mince', billId: 9 });
  });

  it('prefers the longer name where both match', () => {
    const segments = linkify('milk 2l was $4.', [ref(7, 'milk'), ref(7, 'milk 2l')]);
    expect(segments[0]).toEqual({ text: 'milk 2l', billId: 7 });
  });
});

describe('refusing to link', () => {
  /**
   * "Countdown" naming four receipts is the common case, and there is no
   * honest way to choose between them.
   */
  it('drops a name that belongs to more than one bill', () => {
    expect(linkify('You shop at Countdown most.', [ref(1, 'Countdown'), ref(2, 'Countdown')])).toEqual(
      [{ text: 'You shop at Countdown most.' }]
    );
  });

  it('still links a name repeated on the same bill', () => {
    const segments = linkify('Countdown again.', [ref(1, 'Countdown'), ref(1, 'Countdown')]);
    expect(segments[0]).toEqual({ text: 'Countdown', billId: 1 });
  });

  it('does not link inside a longer word', () => {
    expect(linkify('Buttermilk was cheaper.', [ref(7, 'milk')])).toEqual([
      { text: 'Buttermilk was cheaper.' },
    ]);
  });

  it('ignores names too short to be distinctive', () => {
    expect(linkify('It was 1L of something.', [ref(7, '1L')])).toEqual([
      { text: 'It was 1L of something.' },
    ]);
  });

  it('links a name that is present but not one that is absent', () => {
    const segments = linkify('You bought bread.', [ref(7, 'bread'), ref(8, 'washing powder')]);
    expect(segments.filter((s) => s.billId)).toHaveLength(1);
  });
});

/**
 * What a shortened name may still link to.
 *
 * The case this exists for: asked what the produce cost, the model writes
 * "Orange Kumara" for a line the till printed as `ORANGE KUMARA (MED)`. These
 * are the same product by any reading, and requiring the name verbatim left an
 * answer half-linked for no reason a reader could see.
 */
describe('linking a name the answer shortened', () => {
  it('links the leading words of a longer name', () => {
    expect(linkify('Orange Kumara cost $5.00.', [ref(5, 'ORANGE KUMARA (MED)')])).toEqual([
      { text: 'Orange Kumara', billId: 5 },
      { text: ' cost $5.00.' },
    ]);
  });

  it('links two products that share their leading words on one bill', () => {
    const refs = [
      ref(9, "Whittaker's Mini Slab Almond Gold Share Pack 12 Pack"),
      ref(9, "Whittaker's Mini Slab Creamy Milk Share Pack 12 Pack"),
    ];

    expect(linkify("Two Whittaker's Mini Slab packs.", refs)).toEqual([
      { text: 'Two ' },
      { text: "Whittaker's Mini Slab", billId: 9 },
      { text: ' packs.' },
    ]);
  });

  /** A shortening that cannot name one receipt must not name any. */
  it('refuses a shortened name that fits two bills', () => {
    const refs = [ref(2, 'Nice Milk Bottles 250g'), ref(9, 'Nice Milk Bottles 500g')];

    expect(linkify('You bought Nice Milk Bottles twice.', refs)).toEqual([
      { text: 'You bought Nice Milk Bottles twice.' },
    ]);
  });

  /**
   * The rule that keeps this from overfitting. "Table" is a word a sentence
   * uses for itself, and one bill selling `Table Carrots` must not claim it.
   */
  it('never links a single word out of a longer name', () => {
    expect(linkify('It was on the table.', [ref(1, 'Table Carrots')])).toEqual([
      { text: 'It was on the table.' },
    ]);
  });

  it('ignores a leading pair too short to be distinctive', () => {
    expect(linkify('Hot Dog rolls, $4.', [ref(3, 'Hot Dog Buns Six Pack')])).toEqual([
      { text: 'Hot Dog rolls, $4.' },
    ]);
  });

  /** An abbreviation of one product must never shadow another's real name. */
  it('gives a name spelled out in full to the bill that spells it', () => {
    const refs = [ref(2, 'Nice Milk Bottles'), ref(9, 'Nice Milk Bottles 250g')];

    expect(linkify('Nice Milk Bottles, $3.', refs)).toEqual([
      { text: 'Nice Milk Bottles', billId: 2 },
      { text: ', $3.' },
    ]);
  });

  it('still prefers the full name where the answer gives it', () => {
    const refs = [ref(9, 'Nice Marshmallows 250g')];

    expect(linkify('Nice Marshmallows 250g, $4.', refs)).toEqual([
      { text: 'Nice Marshmallows 250g', billId: 9 },
      { text: ', $4.' },
    ]);
  });
});

describe('names that would break a naive matcher', () => {
  /**
   * `\b` is defined against ASCII word characters, so it matches at every
   * position around 豆腐干 and would refuse the match entirely if applied
   * blindly. §4.7 stores these names precisely so they can be found.
   */
  it('links a non-Latin name', () => {
    const segments = linkify('The 豆腐干 was $3.', [ref(7, '豆腐干')]);
    expect(segments[1]).toEqual({ text: '豆腐干', billId: 7 });
  });

  it('treats regex punctuation in a name as text', () => {
    const segments = linkify("PAK'nSAVE (Mill St) was busiest.", [ref(3, "PAK'nSAVE (Mill St)")]);
    expect(segments[0]).toEqual({ text: "PAK'nSAVE (Mill St)", billId: 3 });
  });

  it('handles a name with a + in it', () => {
    const segments = linkify('You bought 2+1 pack there.', [ref(4, '2+1 pack')]);
    expect(segments[1]).toEqual({ text: '2+1 pack', billId: 4 });
  });

  it('reassembles into exactly the original text', () => {
    const text = 'Milk, 豆腐干 and beef mince came to $18.40.';
    const segments = linkify(text, [ref(7, 'milk'), ref(8, '豆腐干'), ref(9, 'beef mince')]);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
  });

  it('reassembles even when nothing matches', () => {
    const text = 'Nothing here matches anything at all.';
    expect(linkify(text, [ref(7, 'bread')]).map((s) => s.text).join('')).toBe(text);
  });

  it('survives an empty answer', () => {
    expect(linkify('', [ref(7, 'milk')])).toEqual([{ text: '' }]);
  });
});
