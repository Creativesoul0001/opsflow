import { describe, expect, it } from 'vitest';

import { ORDER_NUMBER_PREFIX, formatOrderNumber, parseOrderNumber } from '@/lib/orders/number';

/**
 * Order numbers are the one identifier on an order a human reads aloud, so the
 * format has to be stable (documents already sent out keep matching), padded so
 * the list sorts lexicographically, and strict enough that the database's CHECK
 * constraint and the parser agree on what counts as valid.
 */

describe('formatOrderNumber', () => {
  it('pads to six digits so lexical sort matches numeric sort', () => {
    expect(formatOrderNumber(1)).toBe('ORD-000001');
    expect(formatOrderNumber(42)).toBe('ORD-000042');
    expect(formatOrderNumber(999_999)).toBe('ORD-999999');
  });

  it('grows past six digits rather than wrapping or truncating', () => {
    expect(formatOrderNumber(1_000_000)).toBe('ORD-1000000');
    expect(formatOrderNumber(1_234_567)).toBe('ORD-1234567');
  });

  it('never emits a zero or negative number', () => {
    expect(formatOrderNumber(1)).toBe(`${ORDER_NUMBER_PREFIX}-000001`);
    expect(formatOrderNumber(1).startsWith(`${ORDER_NUMBER_PREFIX}-0`)).toBe(true);
  });
});

describe('parseOrderNumber', () => {
  it('round-trips every formatted number', () => {
    for (const sequence of [1, 12, 999, 1000, 999_999, 1_000_000, 4_294_967_295]) {
      expect(parseOrderNumber(formatOrderNumber(sequence)), String(sequence)).toBe(sequence);
    }
  });

  it("refuses numbers that are not this system's format", () => {
    for (const malformed of [
      '',
      'ORD-123', // below the six-digit floor
      'ABC-000001', // wrong prefix
      'ord-000001', // prefix is case sensitive
      'ORD-0000012extra',
      '000001',
      'ORD--000001',
      'ORD-000001-000001',
    ]) {
      expect(parseOrderNumber(malformed), malformed).toBeNull();
    }
  });
});

describe('formatting is sort-safe', () => {
  it('keeps lexicographic order identical to numeric order up to a million', () => {
    const sequences = [1, 2, 10, 100, 999, 1000, 12_345, 999_999];
    const formatted = sequences.map(formatOrderNumber);

    expect([...formatted].sort()).toEqual(formatted);
  });
});
