/**
 * Money is integer cents, always — spec §4.3. No REAL, ever.
 *
 * These helpers exist so that the *only* place a decimal string becomes a
 * number is here, where the rounding is deliberate and tested. Anywhere else,
 * `0.1 + 0.2` style drift would accumulate straight into the §5.5 sum checks.
 */

/**
 * Parses user- or receipt-supplied text into cents.
 *
 * Accepts `"12.34"`, `"$12.34"`, `"12"`, `"1,234.50"`, `"-4.20"` and pads a
 * single trailing decimal (`"12.3"` → 1230). Returns null for anything it
 * cannot read confidently — the caller decides whether that is an error or an
 * illegible price (which is NULL in the schema, not zero).
 */
export function parseCents(input: string): number | null {
  const cleaned = input.trim().replace(/[$\s,]/g, '');
  if (cleaned === '' || cleaned === '-') return null;

  const match = /^(-?)(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, sign, whole, fraction = ''] = match;
  if (whole === '' && fraction === '') return null;

  const cents = Number(whole || '0') * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return sign === '-' ? -cents : cents;
}

/** Renders cents as a bare decimal string for text inputs: 1234 → `"12.34"`. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/**
 * Formats cents for display in the device locale (§7).
 *
 * `Intl.NumberFormat` is available in Hermes, and currency formatting is one
 * of the things it genuinely gets right per-locale — hand-rolling `$` prefixes
 * would be wrong the moment the device is set to anything but en-NZ.
 */
export function formatMoney(
  cents: number | null | undefined,
  currency = 'NZD',
  options: { showPlaceholder?: boolean } = {}
): string {
  if (cents == null) return options.showPlaceholder === false ? '' : '—';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  }).format(cents / 100);
}

/**
 * Short form for chart axes, where a full currency string will not fit:
 * 1234500 → `"$12.3k"`.
 *
 * Hand-rolled rather than `Intl`'s `notation: 'compact'`, which Hermes does not
 * reliably implement — a silent fallback to long form would overflow the axis
 * gutter on a narrow screen.
 */
export function formatMoneyCompact(cents: number, currency = 'NZD'): string {
  const symbol = currencySymbol(currency);
  const dollars = Math.round(cents / 100);
  const sign = dollars < 0 ? '-' : '';
  const magnitude = Math.abs(dollars);

  if (magnitude >= 1_000_000) return `${sign}${symbol}${(magnitude / 1_000_000).toFixed(1)}m`;
  if (magnitude >= 1_000) return `${sign}${symbol}${(magnitude / 1_000).toFixed(1)}k`;
  return `${sign}${symbol}${magnitude}`;
}

/**
 * Last resort when `Intl` cannot answer. Only the currencies this app is
 * likely to meet; anything else falls through to a dollar sign, which may be
 * wrong but is legible — better than a blank axis label or a crash.
 */
const SYMBOL_FALLBACK: Record<string, string> = {
  NZD: '$',
  AUD: '$',
  USD: '$',
  GBP: '£',
  EUR: '€',
  JPY: '¥',
  CNY: '¥',
};

/**
 * The locale's symbol for a currency, e.g. `'NZD'` → `'$'`.
 *
 * ## Why this is three attempts deep
 *
 * **`formatToParts` does not exist in Hermes on iOS.** Android's Hermes gets
 * `Intl` from the platform, so the original one-liner worked there and looked
 * finished. The first launch on an iPhone threw
 * `TypeError: undefined is not a function`, and React attributed it to the tab
 * layout several frames above the real cause — the chart axis labels on
 * Insights. Exactly the §2.2 class of bug that only a second platform finds.
 *
 * So: ask precisely where that is supported, otherwise recover the symbol from
 * a formatted zero, otherwise use the table. `currencyDisplay: 'narrowSymbol'`
 * is itself not universally implemented and can throw, so the whole thing is
 * wrapped rather than just the `formatToParts` call.
 */
export function currencySymbol(currency = 'NZD'): string {
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    });

    if (typeof formatter.formatToParts === 'function') {
      const symbol = formatter.formatToParts(0).find((part) => part.type === 'currency')?.value;
      if (symbol) return symbol;
    }

    // Strip a formatted zero down to its non-numeric remainder: digits,
    // separators, and the non-breaking and narrow no-break spaces some locales
    // put between symbol and amount.
    const stripped = formatter.format(0).replace(/[\d\s.,  ]/g, '');
    if (stripped) return stripped;
  } catch {
    // Intl missing, or the option unsupported — fall through to the table.
  }

  return SYMBOL_FALLBACK[currency.toUpperCase()] ?? '$';
}

/**
 * Quantities are REAL because weighed goods genuinely are (§4.3), so they are
 * displayed with just enough precision to be honest and no more.
 */
export function formatQuantity(qty: number): string {
  if (Number.isInteger(qty)) return String(qty);
  return String(Number(qty.toFixed(3)));
}
