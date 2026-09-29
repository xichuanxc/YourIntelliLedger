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
 * Long enough for a shop name and a size, short enough that a mangled OCR
 * line cannot turn into a paragraph of query string.
 */
const MAX_TERM_LENGTH = 60;

/**
 * What to search for, from what the receipt printed.
 *
 * The English name rather than `nameLocal`: grocer's catalogue is English,
 * so a Chinese or Korean product name would match nothing there even though
 * it is the more faithful record of the receipt.
 *
 * Punctuation becomes spaces because tills use it as a separator, not as
 * meaning — `C/Tg` is two fragments, not a fraction. Nothing else is
 * stripped: the abbreviations are what the receipt says, and guessing which
 * fragments are noise would throw away the distinctive ones.
 */
export function grocerSearchTerm(item: { name: string }): string {
  return item.name
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, MAX_TERM_LENGTH)
    .trim();
}

/** The URL to open, or null when the line has no words to search for. */
export function grocerSearchUrl(item: { name: string }): string | null {
  const term = grocerSearchTerm(item);
  if (!term) return null;
  return `${GROCER_SEARCH}?term=${encodeURIComponent(term)}`;
}
