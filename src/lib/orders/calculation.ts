import { ValidationError, type FieldIssue } from '@/lib/api/errors';
import {
  formatMinorUnits,
  isStorableMoney,
  MAX_MONEY_MINOR,
  parseMinorUnits,
} from '@/lib/orders/money';

/**
 * Server-side order totals.
 *
 * A client may say *what* it wants to order — which customer, how many of which
 * item, at what unit price, under which tax rate — but never what the resulting
 * subtotal, tax or total are. Every stored figure on an order is derived here
 * from those inputs using integer arithmetic, so no payload can claim a total
 * that disagrees with its own line items. That is also why the schemas never
 * accept `subtotal`/`total` at all: they are outputs of this function.
 *
 * All issues are accumulated and reported together rather than thrown one at a
 * time, so a form with three bad amounts shows three messages.
 */

/** Most line items a single order may carry. */
export const MAX_ORDER_ITEMS = 100;

/** Upper bound on `quantity`, so `quantity * unitPrice` cannot wander off quietly. */
export const MAX_QUANTITY = 1_000_000;

/** A tax rate is a percentage, so the ceiling is 100% = 10_000 basis points. */
export const MAX_TAX_RATE_BP = 10_000;

/**
 * `^12`, `12.5`, `12.55`, `100` — up to four integer digits and at most two
 * decimals. Rejects signs, separators and exponent notation outright.
 */
const RATE_PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/;

export interface OrderLineDraft {
  productId?: string | null;
  productName: string;
  quantity: number;
  /** Major-unit decimal string, e.g. `"1250.50"`. */
  unitPrice: string;
  /** Major-unit decimal string. Defaults to `"0"`. */
  discount?: string | null;
}

export interface OrderTotalsDraft {
  items: readonly OrderLineDraft[];
  /** Order-level discount, major-unit decimal string. Defaults to `"0"`. */
  discount?: string | null;
  /** Percentage as a decimal string, e.g. `"18"` or `"18.5"`. Defaults to `"0"`. */
  taxRate?: string | null;
}

export interface ComputedLine {
  index: number;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  totalMinor: number;
}

export interface ComputedOrderTotals {
  lines: ComputedLine[];
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  taxRateBp: number;
  totalMinor: number;
}

/**
 * Parses a percentage into integer basis points (`"18.5" -> 1850`).
 *
 * Returns `null` for anything outside `0`–`100`, for a malformed number, or for
 * a value with more precision than two decimals.
 */
export function parseTaxRateBp(value: string): number | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!RATE_PATTERN.test(trimmed)) return null;

  const [whole, fraction = ''] = trimmed.split('.');
  const bp = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(bp)) return null;
  if (bp > MAX_TAX_RATE_BP) return null;

  return bp;
}

/**
 * Rounds `numerator / divisor` half-up using integers only.
 *
 * `Math.round((subtotal * rate) / 10000)` looks equivalent but is not: the
 * division produces a float, and for values near `.5` the float's own rounding
 * error decides which way it goes. Keeping everything integral makes the policy
 * exact and deterministic.
 */
function divideRoundHalfUp(numerator: number, divisor: number): number {
  const quotient = Math.floor(numerator / divisor);
  const remainder = numerator % divisor;
  return remainder * 2 >= divisor ? quotient + 1 : quotient;
}

/**
 * Renders integer basis points as a percentage string, so `1850 -> '18.5'`.
 *
 * `taxRate` is stored in basis points because a percentage like `18.5` cannot be
 * held exactly as a float, but it travels and renders as the decimal a person
 * would write.
 */
export function formatTaxRateBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = bp % 100;

  if (fraction === 0) return String(whole);

  const padded = String(fraction).padStart(2, '0').replace(/0$/, '');
  return `${whole}.${padded}`;
}

function push(issues: FieldIssue[], path: string, message: string): void {
  issues.push({ path, message });
}

/**
 * Computes every stored money value on an order.
 *
 * @throws {ValidationError} with one issue per problem found.
 */
export function computeOrderTotals(draft: OrderTotalsDraft): ComputedOrderTotals {
  const issues: FieldIssue[] = [];

  if (draft.items.length === 0) {
    push(issues, 'items', 'An order needs at least one line item.');
  }
  if (draft.items.length > MAX_ORDER_ITEMS) {
    push(
      issues,
      'items',
      `An order can hold at most ${MAX_ORDER_ITEMS} line items. This one has ${draft.items.length}.`,
    );
  }

  const lines: ComputedLine[] = [];
  let subtotalMinor = 0;

  draft.items.forEach((item, index) => {
    const path = `items.${index}`;

    if (item.quantity < 1 || !Number.isInteger(item.quantity)) {
      push(issues, `${path}.quantity`, 'Quantity must be a whole number of at least 1.');
    }
    if (item.quantity > MAX_QUANTITY) {
      push(issues, `${path}.quantity`, `Quantity must be at most ${MAX_QUANTITY}.`);
    }

    const unitPriceMinor = parseMinorUnits(item.unitPrice);
    if (unitPriceMinor === null) {
      push(
        issues,
        `${path}.unitPrice`,
        'Enter a price such as 12.50 — up to two decimal places, no negatives.',
      );
    }

    const lineDiscountMinor = parseMinorUnits(item.discount ?? '0');
    if (lineDiscountMinor === null) {
      push(issues, `${path}.discount`, 'Enter a discount such as 10.00, or leave it blank.');
    }

    // Arithmetic is only meaningful once both operands parsed; skip it rather
    // than fabricate a second, confusing issue from an already-bad value.
    if (
      unitPriceMinor === null ||
      lineDiscountMinor === null ||
      item.quantity < 1 ||
      !Number.isInteger(item.quantity) ||
      item.quantity > MAX_QUANTITY
    ) {
      return;
    }

    const grossMinor = item.quantity * unitPriceMinor;
    if (!isStorableMoney(grossMinor)) {
      push(
        issues,
        `${path}.unitPrice`,
        `This line is too large — keep each line at or below ${formatMinorUnits(MAX_MONEY_MINOR)}.`,
      );
      return;
    }

    if (lineDiscountMinor > grossMinor) {
      push(
        issues,
        `${path}.discount`,
        `The line discount cannot exceed ${formatMinorUnits(grossMinor)}.`,
      );
      return;
    }

    const totalMinor = grossMinor - lineDiscountMinor;
    subtotalMinor += totalMinor;

    lines.push({
      index,
      productId: item.productId ?? null,
      productName: item.productName,
      quantity: item.quantity,
      unitPriceMinor,
      discountMinor: lineDiscountMinor,
      totalMinor,
    });
  });

  const discountMinor = parseMinorUnits(draft.discount ?? '0');
  if (discountMinor === null) {
    push(issues, 'discount', 'Enter a discount such as 100.00, or leave it blank.');
  }

  const taxRateBp = parseTaxRateBp(draft.taxRate ?? '0');
  if (taxRateBp === null) {
    push(issues, 'taxRate', 'Enter a tax rate between 0 and 100, for example 18 or 18.5.');
  }

  if (issues.length > 0) throw new ValidationError(issues);

  const orderDiscount = discountMinor ?? 0;
  const rate = taxRateBp ?? 0;

  if (orderDiscount > subtotalMinor) {
    throw new ValidationError([
      {
        path: 'discount',
        message: `The order discount cannot exceed the subtotal of ${formatMinorUnits(subtotalMinor)}.`,
      },
    ]);
  }

  const taxableMinor = subtotalMinor - orderDiscount;
  const taxMinor = divideRoundHalfUp(taxableMinor * rate, 10_000);
  const totalMinor = taxableMinor + taxMinor;

  const overflowing = [
    { path: 'subtotal', value: subtotalMinor },
    { path: 'discount', value: orderDiscount },
    { path: 'tax', value: taxMinor },
    { path: 'total', value: totalMinor },
  ].filter((field) => !isStorableMoney(field.value));

  if (overflowing.length > 0) {
    throw new ValidationError(
      overflowing.map((field) => ({
        path: field.path,
        message: `This order is too large — the largest storable amount is ${formatMinorUnits(MAX_MONEY_MINOR)}.`,
      })),
    );
  }

  return {
    lines,
    subtotalMinor,
    discountMinor: orderDiscount,
    taxMinor,
    taxRateBp: rate,
    totalMinor,
  };
}
