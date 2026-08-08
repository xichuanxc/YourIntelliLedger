import {
  centsToInput,
  currencySymbol,
  formatMoneyCompact,
  formatQuantity,
  parseCents,
} from '@/data/money';

describe('parseCents (spec §4.3 — integer cents only)', () => {
  it('parses plain and currency-prefixed decimals', () => {
    expect(parseCents('12.34')).toBe(1234);
    expect(parseCents('$12.34')).toBe(1234);
    expect(parseCents(' 1,234.50 ')).toBe(123450);
  });

  it('treats a whole number as dollars', () => {
    expect(parseCents('12')).toBe(1200);
  });

  it('pads a single decimal place', () => {
    expect(parseCents('12.3')).toBe(1230);
  });

  it('handles values that float arithmetic would drift on', () => {
    // 0.1 + 0.2 style drift is exactly what §4.3 bans REAL money to avoid.
    expect(parseCents('0.10')).toBe(10);
    expect(parseCents('0.20')).toBe(20);
    expect(parseCents('1.15')).toBe(115);
    expect(parseCents('8.30')).toBe(830);
    expect(parseCents('1234567.89')).toBe(123456789);
  });

  it('parses negatives, for discount entry', () => {
    expect(parseCents('-4.20')).toBe(-420);
  });

  it('rejects anything it cannot read confidently', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('   ')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    expect(parseCents('12.345')).toBeNull(); // more precision than a cent
    expect(parseCents('1.2.3')).toBeNull();
    expect(parseCents('-')).toBeNull();
    expect(parseCents('.')).toBeNull();
  });

  it('parses a bare decimal fraction', () => {
    expect(parseCents('.50')).toBe(50);
  });
});

describe('centsToInput', () => {
  it('round-trips through parseCents', () => {
    for (const cents of [0, 5, 99, 100, 1234, 123450, -420]) {
      expect(parseCents(centsToInput(cents))).toBe(cents);
    }
  });

  it('pads the cents column', () => {
    expect(centsToInput(5)).toBe('0.05');
    expect(centsToInput(50)).toBe('0.50');
    expect(centsToInput(1200)).toBe('12.00');
  });

  it('renders an unknown amount as an empty field, not zero', () => {
    expect(centsToInput(null)).toBe('');
  });
});

describe('formatQuantity', () => {
  it('shows whole quantities without a decimal point', () => {
    expect(formatQuantity(2)).toBe('2');
  });

  it('keeps weighed quantities honest', () => {
    expect(formatQuantity(0.605)).toBe('0.605');
    expect(formatQuantity(0.67)).toBe('0.67');
  });
});

/**
 * These simulate Hermes on iOS, because Node has a complete `Intl` and cannot
 * reproduce the failure on its own — which is exactly why the bug shipped.
 *
 * The original `currencySymbol` called `formatToParts` unguarded. That works
 * on Android, whose Hermes gets `Intl` from the platform, and throws
 * `TypeError: undefined is not a function` on iOS, where it does not exist.
 * It surfaced on the first-ever iPhone launch, reported by React against the
 * tab layout — several frames above the chart axis label that actually called
 * it.
 */
describe('currencySymbol on a degraded Intl (iOS Hermes)', () => {
  const realNumberFormat = Intl.NumberFormat;

  afterEach(() => {
    Object.defineProperty(Intl, 'NumberFormat', {
      value: realNumberFormat,
      configurable: true,
      writable: true,
    });
  });

  const stubNumberFormat = (impl: unknown) => {
    Object.defineProperty(Intl, 'NumberFormat', {
      value: impl,
      configurable: true,
      writable: true,
    });
  };

  it('uses formatToParts when it exists', () => {
    expect(currencySymbol('NZD')).toBe('$');
    expect(currencySymbol('GBP')).toBe('£');
  });

  it('recovers the symbol from a formatted zero when formatToParts is missing', () => {
    stubNumberFormat(function () {
      return { format: () => '$0.00' };
    });

    expect(currencySymbol('NZD')).toBe('$');
  });

  it('handles a locale that puts a non-breaking space between symbol and amount', () => {
    stubNumberFormat(function () {
      return { format: () => '0,00 €' };
    });

    expect(currencySymbol('EUR')).toBe('€');
  });

  it('falls back to the table when narrowSymbol itself throws', () => {
    stubNumberFormat(function () {
      throw new RangeError('Unsupported currencyDisplay');
    });

    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('JPY')).toBe('¥');
  });

  it('falls back when Intl is absent altogether', () => {
    stubNumberFormat(undefined);
    expect(currencySymbol('NZD')).toBe('$');
  });

  /** Legible-but-wrong beats blank on a chart axis. */
  it('gives an unknown currency a dollar sign rather than nothing', () => {
    stubNumberFormat(function () {
      throw new RangeError('nope');
    });

    expect(currencySymbol('XYZ')).toBe('$');
  });

  it('never returns an empty string, whatever Intl does', () => {
    stubNumberFormat(function () {
      return { format: () => '0.00' }; // symbol-less output
    });

    expect(currencySymbol('NZD')).toBe('$');
  });
});

/** The caller that actually broke: chart axis labels on Insights. */
describe('formatMoneyCompact', () => {
  it('shortens thousands and millions for an axis gutter', () => {
    expect(formatMoneyCompact(123450000)).toBe('$1.2m');
    expect(formatMoneyCompact(1234500)).toBe('$12.3k');
    expect(formatMoneyCompact(12345)).toBe('$123');
  });

  it('keeps the sign on the outside of the symbol', () => {
    expect(formatMoneyCompact(-1234500)).toBe('-$12.3k');
  });

  it('renders a zero axis label rather than an empty one', () => {
    expect(formatMoneyCompact(0)).toBe('$0');
  });
});
