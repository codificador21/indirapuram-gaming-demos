import { describe, expect, it } from 'vitest';
import { formatINR, formatINRCompact, groupIndian, rupeesToPaise } from './money';

describe('rupeesToPaise', () => {
  it.each([
    ['250', 25000],
    ['250.5', 25050],
    ['250.05', 25005],
    ['1,23,456.78', 12345678],
    ['85,000.00', 8500000],
    ['500/-', 50000],
    ['180.0', 18000],
    ['₹ 1,299', 129900],
    ['12.999', 1299], // extra precision is truncated, not rounded up
  ])('%s → %i', (input, expected) => {
    expect(rupeesToPaise(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.2.3', '-5'])('rejects %j', (input) => {
    expect(rupeesToPaise(input)).toBeNull();
  });
});

describe('Indian digit grouping', () => {
  it.each([
    ['0', '0'],
    ['999', '999'],
    ['1000', '1,000'],
    ['123456', '1,23,456'],
    ['1234567', '12,34,567'],
    ['123456789', '12,34,56,789'],
  ])('%s → %s', (input, expected) => {
    expect(groupIndian(input)).toBe(expected);
  });

  it('formats rupees with the ₹ symbol', () => {
    expect(formatINR(12345600)).toBe('₹1,23,456');
    expect(formatINR(12345678)).toBe('₹1,23,456.78');
    expect(formatINR(12345678, { decimals: 0 })).toBe('₹1,23,457');
    expect(formatINR(50000, { decimals: 2 })).toBe('₹500.00');
    expect(formatINR(-150000)).toBe('−₹1,500');
    expect(formatINR(150000, { signed: true })).toBe('+₹1,500');
    expect(formatINR(0)).toBe('₹0');
  });

  it('compacts large values with K / L / Cr', () => {
    expect(formatINRCompact(95000)).toBe('₹950');
    expect(formatINRCompact(1250000)).toBe('₹12.5K');
    expect(formatINRCompact(12000000)).toBe('₹1.2L');
    expect(formatINRCompact(3_40_00_000_00)).toBe('₹3.4Cr');
  });
});
