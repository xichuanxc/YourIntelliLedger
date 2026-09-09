/**
 * Reading the answer out of a half-arrived envelope (§14.7, §6.2).
 *
 * §6.7 makes the model reply with a JSON object, so what streams back is
 * `{"text":"You spent $12...` — braces and quotes, not an answer. Showing the
 * raw tokens would be worse than showing nothing, and showing nothing until
 * the object closes would make streaming pointless: §6.8's budget is four
 * seconds to *first token*, and the token in question is one a person reads.
 *
 * So this decodes as much of the `text` field as has definitely arrived, and
 * not one character more. It is a preview: when the turn ends, `parseEnvelope`
 * produces the authoritative text and the caller replaces whatever was shown.
 * That makes a wrong guess here self-correcting rather than permanent, which
 * is why it can afford to be simple.
 *
 * Pure, because the failure modes are all about where a chunk boundary lands —
 * mid-escape, mid-`\u` sequence, mid-key — and those are miserable to
 * reproduce against a live model and trivial to write down.
 */

/** `"text"` followed by a colon and the opening quote of its value. */
const TEXT_KEY = /"text"\s*:\s*"/;

const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

/**
 * The decoded `text` value so far, or `''` when none of it has arrived.
 *
 * Stops at anything incomplete rather than guessing: a trailing backslash
 * might begin `\n` or `\"`, and a partial `\u00e` cannot be resolved until its
 * last digit lands. Emitting a guess would put a stray character on screen
 * that the final replacement then removes — a visible flicker for no gain.
 */
export function partialAnswer(raw: string): string {
  const start = TEXT_KEY.exec(raw);
  if (!start) return '';

  let index = start.index + start[0].length;
  let out = '';

  while (index < raw.length) {
    const char = raw[index];

    if (char === '"') break; // the value ended; everything after is structure

    if (char !== '\\') {
      out += char;
      index += 1;
      continue;
    }

    // An escape needs at least one more character, and `\u` needs four.
    const next = raw[index + 1];
    if (next === undefined) break;

    if (next === 'u') {
      const hex = raw.slice(index + 2, index + 6);
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      index += 6;
      continue;
    }

    const decoded = SIMPLE_ESCAPES[next];
    // An escape JSON does not define means the model is not emitting the
    // envelope we asked for. Stop; `parseEnvelope` will salvage what it can.
    if (decoded === undefined) break;
    out += decoded;
    index += 2;
  }

  return out;
}
