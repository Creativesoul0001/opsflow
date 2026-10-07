import { describe, expect, it } from 'vitest';

import { ValidationError, type FieldIssue } from '@/lib/api/errors';
import {
  MAX_TAX_RATE_BP,
  computeOrderTotals,
  formatTaxRateBp,
  parseTaxRateBp,
} from '@/lib/orders/calculation';
import { MAX_MONEY_MINOR, formatMinorUnits, parseMinorUnits } from '@/lib/orders/money';
import { formatMoney, formatTaxRate, isZeroAmount } from '@/lib/orders/presentation';

/**
 * Order arithmetic and the display rules layered on top of it.
 *
 * The arithmetic module is the only place an order's money is ever produced, so
 * these tests pin the properties the rest of the system depends on: integer-only
 * computation, exact half-up rounding, and hard bounds that keep every stored
 * value inside PostgreSQL's `int4`. The formatting half proves money can be
 * rendered without a float ever touching it.
 */

function issues(error: unknown): FieldIssue[] {
  return (error as { details?: { issues?: FieldIssue[] } }).details?.issues ?? [];
}

function pathsOf(error: unknown): string[] {
  return issues(error).map((issue) => issue.path);
}

describe('parseMinorUnits', () => {
  it('reads decimal strings as integer minor units', () => {
    expect(parseMinorUnits('0')).toBe(0);
    expect(parseMinorUnits('0.00')).toBe(0);
    expect(parseMinorUnits('0.05')).toBe(5);
    expect(parseMinorUnits('1250.50')).toBe(125050);
    expect(parseMinorUnits('1250.5')).toBe(125050);
    expect(parseMinorUnits('0001.20')).toBe(120);
  });

  it('never produces a float, which is the whole point of the representation', () => {
    // `Number('1.005') * 100` is 100.49999999999999; this must be exact.
    expect(parseMinorUnits('1.005')).toBeNull();
    expect(parseMinorUnits('1.10')).toBe(110);
    expect(parseMinorUnits('0.1')).toBe(10);
    expect(parseMinorUnits('0.3')).toBe(30);
  });

  it('rejects everything that is not a plain non-negative amount', () => {
    for (const value of ['', ' ', '-1', '1,250', '1e3', '$5', '0x10', '1.234', 'abc', 'NaN']) {
      expect(parseMinorUnits(value), value).toBeNull();
    }
  });

  it('rejects amounts larger than the storable ceiling', () => {
    expect(parseMinorUnits(formatMinorUnits(MAX_MONEY_MINOR))).toBe(MAX_MONEY_MINOR);
    expect(parseMinorUnits(formatMinorUnits(MAX_MONEY_MINOR + 1))).toBeNull();
  });
});

describe('formatMinorUnits', () => {
  it('always renders exactly two decimals', () => {
    expect(formatMinorUnits(0)).toBe('0.00');
    expect(formatMinorUnits(5)).toBe('0.05');
    expect(formatMinorUnits(125050)).toBe('1250.50');
  });

  it('round-trips with parseMinorUnits', () => {
    for (const minor of [0, 1, 99, 100, 12345678, MAX_MONEY_MINOR]) {
      expect(parseMinorUnits(formatMinorUnits(minor))).toBe(minor);
    }
  });
});

describe('tax rate basis points', () => {
  it('parses the percentages people actually write', () => {
    expect(parseTaxRateBp('0')).toBe(0);
    expect(parseTaxRateBp('18')).toBe(1800);
    expect(parseTaxRateBp('18.5')).toBe(1850);
    expect(parseTaxRateBp('0.01')).toBe(1);
    expect(parseTaxRateBp('100')).toBe(MAX_TAX_RATE_BP);
  });

  it('rejects rates outside 0-100 and anything imprecise', () => {
    expect(parseTaxRateBp('100.01')).toBeNull();
    expect(parseTaxRateBp('101')).toBeNull();
    expect(parseTaxRateBp('-5')).toBeNull();
    expect(parseTaxRateBp('12.345')).toBeNull();
    expect(parseTaxRateBp('1e2')).toBeNull();
    expect(parseTaxRateBp('')).toBeNull();
  });

  it('renders back to the decimal a person would write', () => {
    expect(formatTaxRateBp(0)).toBe('0');
    expect(formatTaxRateBp(1800)).toBe('18');
    expect(formatTaxRateBp(1850)).toBe('18.5');
    expect(formatTaxRateBp(1234)).toBe('12.34');
    expect(formatTaxRateBp(1)).toBe('0.01');
  });

  it('round-trips through parse', () => {
    for (const bp of [0, 1, 99, 100, 1850, 10000]) {
      expect(parseTaxRateBp(formatTaxRateBp(bp))).toBe(bp);
    }
  });
});

describe('computeOrderTotals', () => {
  it('derives every figure from the line items', () => {
    const totals = computeOrderTotals({
      items: [{ productName: 'Hours', quantity: 3, unitPrice: '10.00' }],
    });

    expect(totals.subtotalMinor).toBe(3000);
    expect(totals.discountMinor).toBe(0);
    expect(totals.taxMinor).toBe(0);
    expect(totals.taxRateBp).toBe(0);
    expect(totals.totalMinor).toBe(3000);
    expect(totals.lines).toHaveLength(1);
    expect(totals.lines[0]).toMatchObject({ index: 0, totalMinor: 3000 });
  });

  it('applies line discounts before the order discount', () => {
    const totals = computeOrderTotals({
      items: [
        { productName: 'A', quantity: 2, unitPrice: '100.00', discount: '10.00' },
        { productName: 'B', quantity: 1, unitPrice: '50.00' },
      ],
      discount: '25.00',
    });

    expect(totals.subtotalMinor).toBe(20000 - 1000 + 5000);
    expect(totals.discountMinor).toBe(2500);
    expect(totals.totalMinor).toBe(20000 - 1000 + 5000 - 2500);
  });

  it('taxes the discounted amount, not the subtotal', () => {
    const totals = computeOrderTotals({
      items: [{ productName: 'A', quantity: 1, unitPrice: '100.00' }],
      discount: '10.00',
      taxRate: '10',
    });

    expect(totals.subtotalMinor).toBe(10000);
    expect(totals.taxMinor).toBe(900); // (100.00 - 10.00) * 10%
    expect(totals.totalMinor).toBe(9900);
  });

  it('rounds tax half-up with integers, never through a float', () => {
    // 0.33 * 5% = 0.0165, which is above the .005 midpoint and must go to 0.02.
    // `Math.round(0.0165 * 100)` reaches the same answer here only by luck; the
    // integer path is what makes it deterministic.
    const totals = computeOrderTotals({
      items: [{ productName: 'A', quantity: 1, unitPrice: '0.33' }],
      taxRate: '5',
    });

    expect(totals.taxMinor).toBe(2);
    expect(formatMinorUnits(totals.taxMinor)).toBe('0.02');
    expect(totals.totalMinor).toBe(35);
  });

  it('collects every line issue in one pass instead of throwing on the first', () => {
    const error = catchValidationError(() =>
      computeOrderTotals({
        items: [
          { productName: 'A', quantity: 0, unitPrice: '10.00' },
          { productName: '', quantity: 1, unitPrice: 'not-a-price' },
          { productName: 'C', quantity: 1, unitPrice: '10.00', discount: '999.00' },
        ],
      }),
    );

    expect(pathsOf(error)).toEqual(['items.0.quantity', 'items.1.unitPrice', 'items.2.discount']);
  });

  it('refuses an order discount larger than the subtotal', () => {
    const error = catchValidationError(() =>
      computeOrderTotals({
        items: [{ productName: 'A', quantity: 1, unitPrice: '10.00' }],
        discount: '20.00',
      }),
    );

    expect(pathsOf(error)).toEqual(['discount']);
    expect(issues(error)[0]?.message).toContain('subtotal');
  });

  it('refuses an order whose totals would overflow int4', () => {
    const error = catchValidationError(() =>
      computeOrderTotals({
        items: [
          { productName: 'Big', quantity: 1_000_000, unitPrice: formatMinorUnits(MAX_MONEY_MINOR) },
        ],
      }),
    );

    expect(pathsOf(error)).toEqual(['items.0.unitPrice']);
    expect(issues(error)[0]?.message).toMatch(/too large/i);
  });

  it('rejects an empty order', () => {
    const error = catchValidationError(() => computeOrderTotals({ items: [] }));
    expect(pathsOf(error)).toEqual(['items']);
  });

  it('treats absent discount and tax rate as zero rather than as errors', () => {
    const totals = computeOrderTotals({
      items: [{ productName: 'A', quantity: 1, unitPrice: '10.00' }],
      discount: null,
      taxRate: null,
    });

    expect(totals.discountMinor).toBe(0);
    expect(totals.taxRateBp).toBe(0);
    expect(totals.totalMinor).toBe(1000);
  });

  it('reports a tax rate above 100 as a field issue', () => {
    const error = catchValidationError(() =>
      computeOrderTotals({
        items: [{ productName: 'A', quantity: 1, unitPrice: '10.00' }],
        taxRate: '150',
      }),
    );

    expect(pathsOf(error)).toEqual(['taxRate']);
  });
});

function catchValidationError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('Expected a ValidationError, but the call succeeded.');
}

describe('money formatting', () => {
  it('groups the integer part without converting to a number', () => {
    expect(formatMoney('0.00')).toBe('$0.00');
    expect(formatMoney('1250.50')).toBe('$1,250.50');
    expect(formatMoney('1000000')).toBe('$1,000,000.00');
    expect(formatMoney('1234567.89')).toBe('$1,234,567.89');
    expect(formatMoney('0.5')).toBe('$0.50');
    expect(formatMoney('99')).toBe('$99.00');
  });

  it('detects zero without a numeric conversion', () => {
    expect(isZeroAmount('0')).toBe(true);
    expect(isZeroAmount('0.00')).toBe(true);
    expect(isZeroAmount('')).toBe(true);
    expect(isZeroAmount('0.01')).toBe(false);
    expect(isZeroAmount('10')).toBe(false);
  });

  it('writes an explicit label for a zero tax rate', () => {
    expect(formatTaxRate('0')).toBe('No tax');
    expect(formatTaxRate('0.00')).toBe('No tax');
    expect(formatTaxRate('18.5')).toBe('18.5%');
    expect(formatTaxRate('100')).toBe('100%');
  });
});

describe('ValidationError carries issues', () => {
  it('is the error type the arithmetic module throws', () => {
    const error = catchValidationError(() =>
      computeOrderTotals({
        items: [{ productName: '', quantity: -1, unitPrice: '' }],
      }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(issues(error).length).toBeGreaterThan(0);
  });
});
