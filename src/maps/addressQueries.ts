/**
 * Turning a printed receipt address into queries a geocoder will accept.
 *
 * §4.14 keeps `bills.merchant_address` exactly as printed, and credits the
 * platform maps app with handling "abbreviation, misspelling and
 * disambiguation". That credit is deserved and it does not transfer: a maps
 * app runs a fuzzy relevance search, whereas Nominatim matches *structured*
 * address components. One unrecognised leading token makes the whole query
 * fail rather than degrading to the street.
 *
 * Measured against the receipt corpus, six of nine addresses resolved as
 * printed. All three failures shared one shape — a shop unit or a mall name
 * in front of the street address:
 *
 *   Shop 50 and 65 Centre Place 501 Victoria Street Hamilton Central HAMILTON
 *   Shop A/33 Lorne Street, Auckland Central, Auckland 1010
 *   Te Rapa, The Base Shopping Centre, Te Rapa Road, Te Rapa
 *
 * and all three resolved once the prefix was removed. So rather than one
 * clever rule, this produces a short ladder of candidates from most specific
 * to least, for the caller to try in order. The printed address is always
 * first, so the six that already work are unaffected — the fallbacks only
 * ever run for an address that has already missed.
 *
 * Pure and dependency-free, so it runs in the `node` test project.
 */

/** Words a receipt puts in front of the real street address. */
const UNIT_DESIGNATOR = /^(?:shops?|units?|suite|level|lvl|kiosk|stall|tenancy|store|floor|building|bldg)\b[\s.]*/i;

/** `12`, `12a`, `130-136` — a street number, not a postcode or a year. */
const STREET_NUMBER = /^\d{1,5}[a-z]?(?:-\d{1,5}[a-z]?)?$/i;

/** `A/33 Lorne Street` → `33 Lorne Street`. The unit is before the slash. */
const UNIT_SLASH = /^[^\s,]*\/(?=\S)/;

/**
 * A miss costs one request per candidate, so this is deliberately short. It
 * is paid once per distinct address ever — misses are cached too.
 */
const MAX_CANDIDATES = 4;

/**
 * Queries to try, most specific first. Always at least one: the address as
 * printed, with whitespace collapsed.
 */
export function addressQueries(address: string): string[] {
  const printed = address.replace(/\s+/g, ' ').trim();
  if (!printed) return [];

  const candidates = [printed];
  const add = (candidate: string) => {
    const cleaned = candidate.replace(/\s+/g, ' ').trim().replace(/^[,\s]+|[,\s]+$/g, '');
    if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
  };

  // "Shop A/33 Lorne Street" → "33 Lorne Street"
  if (UNIT_DESIGNATOR.test(printed)) {
    add(printed.replace(UNIT_DESIGNATOR, '').replace(UNIT_SLASH, ''));
  }

  // "Shop 50 and 65 Centre Place 501 Victoria Street …" → "501 Victoria Street …"
  //
  // When the first segment holds more than one street number, the last one is
  // the building — the earlier ones number the shop inside it, or the mall.
  const [first = '', ...rest] = printed.split(',');
  const tokens = first.trim().split(' ').filter(Boolean);
  let lastNumber = -1;
  tokens.forEach((token, index) => {
    // Needs a street name after it, or this is a postcode at the end.
    if (STREET_NUMBER.test(token) && index < tokens.length - 2) lastNumber = index;
  });
  if (lastNumber > 0) add([tokens.slice(lastNumber).join(' '), ...rest].join(','));

  // "Te Rapa, The Base Shopping Centre, Te Rapa Road, Te Rapa" → "Te Rapa Road, Te Rapa"
  //
  // Peel leading segments off a comma-separated address — but only ones with
  // no digit in them, because a segment carrying a number may be the building
  // and dropping it loses the address. Without that guard this turned
  // "44 Horsham Downs Road, Rototuna, Hamilton" into "Rototuna, Hamilton",
  // which is a suburb: a confidently wrong pin, and worse than no map.
  //
  // Stopping at two remaining keeps a street and its locality.
  const segments = printed.split(',').map((segment) => segment.trim()).filter(Boolean);
  for (let dropped = 0; dropped < 2 && segments.length - dropped > 2; dropped++) {
    if (/\d/.test(segments[dropped])) break;
    add(segments.slice(dropped + 1).join(', '));
  }

  return candidates.slice(0, MAX_CANDIDATES);
}
