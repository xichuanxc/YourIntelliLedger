import { centsToInput, formatQuantity, parseCents } from '@/data/money';

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
