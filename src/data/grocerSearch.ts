/**
 * Looking a bought item up against today's shelf prices (demo).
 *
 * The ledger knows what you paid. It does not know what the shop across town
 * is charging this morning, and building that would mean a product catalogue
 * on the handset, a daily price pipeline, and a matcher good enough to bind
 * a receipt line to one product — which measurement put at 62% top-1.
 *
 * This does none of it. It hands the item's own words to grocer.nz, whose
 * whole purpose is comparing New Zealand grocery prices, and lets their
 * search answer. Nothing is downloaded, nothing is cached, nothing is
 * republished, and the prices are current because they come from the source
 * at the moment you ask.
 *
 * ## Why a plain https link rather than a scheme
 *
 * grocer's Android app is a Trusted Web Activity and its
 * `/.well-known/assetlinks.json` claims every grocer.nz URL with
 * `handle_all_urls`, so an ordinary link opens the app when it is installed
 * and the browser when it is not — with no scheme to register, nothing to
 * detect, and no broken link on a device that has never heard of it.
 *
 * On iOS the same URL opens Safari: grocer publishes no
 * `apple-app-site-association`, so Universal Links are not configured and
 * their app cannot claim it. That is their file to add, not ours, and the
 * web page is a perfectly good answer meanwhile.
 *
 * ## What leaves the device
 *
 * The item's name, and only when somebody taps it. Not the price paid, the
 * shop, the date, or anything else on the bill. The tap opens a visible
 * browser or app, so unlike a background request there is no version of this
 * the user is unaware of.
 */

/** grocer has no per-product permalink; `/search` takes `term`. */
const GROCER_SEARCH = 'https://grocer.nz/search';

/**
 * How many words to send.
 *
 * A till prints the identifying words first and pads the rest: the brand and
 * the product lead, the abbreviated qualifiers follow. `Anchor Milk Blue Top
 * Plastic B` is recognisable from its first four words and no clearer for the
 * last two.
 *
 * This also suits how grocer searches. Meilisearch's default strategy drops
 * query words from the *end* until it finds results, so a leading word is
 * load-bearing and a trailing one is nearly free -- but every extra word
 * still competes for the ranking, and sending six when four identify the
 * product buries the match.
 */
const MAX_WORDS = 4;

/**
 * Fragments shorter than this are a till's abbreviations, not words.
 *
 * `Janola Pwm C/Tg Eoc 750Ml` carries one word a shopper would recognise and
 * three contractions that mean nothing to a search engine -- they match no
 * product and dilute the ranking of the one word that does. Three characters
 * is the cut: it keeps `Tea`, `Oil` and `Ham`, and drops `Pwm`, `Tg` and `B`.
 */
const MIN_WORD_LENGTH = 3;

/**
 * Long enough for a shop name and a size, short enough that a mangled OCR
 * line cannot turn into a paragraph of query string.
 */
const MAX_TERM_LENGTH = 60;

/** A word worth sending: long enough to mean something, or a size. */
function isSearchable(word: string): boolean {
  // A size is short and highly identifying -- 2L separates three milks that
  // share every other word -- so it is kept whatever its length.
  if (/\d/.test(word)) return true;
  return word.length >= MIN_WORD_LENGTH;
}

/**
 * What to search for, from what the receipt printed.
 *
 * The English name rather than `nameLocal`: grocer's catalogue is English,
 * so a Chinese or Korean product name would match nothing there even though
 * it is the more faithful record of the receipt.
 *
 * Punctuation becomes spaces because tills use it as a separator, not as
 * meaning — `C/Tg` is two fragments, not a fraction.
 *
 * Then the line is cut to the words that identify the product: the till's
 * own contractions are dropped and only the leading few are kept. Sending
 * the whole line searches for the abbreviations too, and a product that
 * matches one real word out of six ranks below one that matches two of its
 * own — so the noise does not merely fail to help, it actively buries the
 * answer.
 *
 * If nothing survives the filter the original words are used instead: a line
 * of nothing but short fragments is a poor query, and no query is worse.
 */
export function grocerSearchTerm(item: { name: string }): string {
  const words = item.name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';

  const meaningful = words.filter(isSearchable);
  const chosen = (meaningful.length > 0 ? meaningful : words).slice(0, MAX_WORDS);

  return chosen.join(' ').slice(0, MAX_TERM_LENGTH).trim();
}

/** The URL to open, or null when the line has no words to search for. */
export function grocerSearchUrl(item: { name: string }): string | null {
  const term = grocerSearchTerm(item);
  if (!term) return null;
  return `${GROCER_SEARCH}?term=${encodeURIComponent(term)}`;
}
