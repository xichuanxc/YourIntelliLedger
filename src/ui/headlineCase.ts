/**
 * Receipt text, cased for reading rather than for a till.
 *
 * Tills shout. `BORMAN FRESH`, `TABLE CARROTS`, `WELLMART HAMILTON` — printed
 * in capitals because a thermal printer has one font and no weight, which is
 * a constraint of the paper, not a fact about the shop's name. On screen it
 * reads as emphasis nobody intended, and a ledger of it is exhausting.
 *
 * ## What must not be touched
 *
 * The naive fix — lowercase everything, capitalise each first letter — is
 * worse than the problem, because it destroys names that were already right:
 *
 *     PAK'nSAVE  ->  Pak'nsave      a real shop, misspelled
 *     McDonald's ->  Mcdonald's
 *     2L         ->  2l
 *
 * So a word is only re-cased when its existing case carries no information:
 * all capitals, or all lowercase. A word with capitals *inside* it was
 * deliberate and is left exactly as it is, which covers every brand that
 * styles itself. Anything containing a digit is left alone too — sizes and
 * codes are not words and gain nothing from being capitalised.
 *
 * ## The small words
 *
 * Headline case lowercases articles and prepositions inside a title, so
 * `SALT AND PEPPER` reads `Salt and Pepper`. The first word is always
 * capitalised however small, because `and Pepper` is not a heading.
 */

/** Lowercased inside a headline, never at the start of one. */
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of',
  'on', 'or', 'per', 'the', 'to', 'via', 'with',
]);

/**
 * True when the existing capitals were chosen rather than imposed.
 *
 * Two conditions, and both are needed. A capital *after* the first letter is
 * a styling choice -- PAK'nSAVE, iPhone, McCain -- but so is every letter of
 * a word a till shouted, so that test alone calls WELLMART deliberate and
 * leaves it shouting.
 *
 * What separates them is lowercase. A styled name mixes the two on purpose;
 * a shouted one has no lowercase at all, because the printer had none to
 * give. So the capitals only count as chosen when there is lowercase beside
 * them to have chosen against.
 */
function isDeliberatelyCased(word: string): boolean {
  return /\p{Lu}/u.test(word.slice(1)) && /\p{Ll}/u.test(word);
}

function capitaliseFirst(word: string): string {
  const first = word.search(/\p{L}/u);
  if (first === -1) return word;
  return word.slice(0, first) + word[first].toUpperCase() + word.slice(first + 1);
}

/**
 * One word, cased for a headline.
 *
 * `minor` asks for the lowercase treatment given to articles inside a title;
 * it is ignored for any word whose case was deliberate.
 */
function caseWord(word: string, minor: boolean): string {
  // Digits mean a size or a code. `2L` is not improved by becoming `2l`.
  if (/\d/.test(word)) return word;
  if (isDeliberatelyCased(word)) return word;

  const lower = word.toLowerCase();
  return minor ? lower : capitaliseFirst(lower);
}

/**
 * `BORMAN FRESH` -> `Borman Fresh`, leaving `PAK'nSAVE` alone.
 *
 * Whitespace is preserved as written: a receipt's spacing is sometimes the
 * only thing separating a name from a code, and collapsing it loses that.
 */
export function headlineCase(text: string | null | undefined): string {
  if (!text) return '';

  let seenWord = false;

  return text.replace(/\S+/g, (word) => {
    const cased = caseWord(word, seenWord && MINOR_WORDS.has(word.toLowerCase()));
    // Only a word with letters counts as "the first word"; a leading `#` or
    // `2x` should not use up the always-capitalise exemption.
    if (/\p{L}/u.test(word)) seenWord = true;
    return cased;
  });
}
