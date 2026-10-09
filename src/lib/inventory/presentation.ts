import { formatCount, formatDate } from '@/lib/format';
import { STOCK_MOVEMENT_TYPES, type StockLevelFilter } from '@/lib/inventory/validation';

/**
 * Display helpers shared by the inventory server and client components.
 *
 * Like the rest of the inventory library layer this file imports no database and
 * no React, so every helper is unit testable. It also holds the label maps, so
 * the list, the detail page, the movement ledger and the dashboard can never
 * disagree about what "Order deduction" is called or what colour it gets.
 *
 * Money formatting is re-exported from the Orders module rather than redefined:
 * product prices are the same major-unit decimal strings the order totals use,
 * and a second implementation of currency formatting would eventually disagree
 * with the first.
 */

import { formatDateTime } from '@/lib/format';
import { formatMoney, formatTaxRate } from '@/lib/orders/presentation';

export { formatCount, formatDate, formatDateTime, formatMoney, formatTaxRate };

/** Human-readable movement type. */
export const STOCK_MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  RECEIPT: 'Received',
  ADJUSTMENT: 'Adjusted',
  TRANSFER_OUT: 'Transferred out',
  TRANSFER_IN: 'Transferred in',
  ORDER_DEDUCTION: 'Order deduction',
  ORDER_RELEASE: 'Order release',
};

/** Tone per movement type, so the ledger reads at a glance. */
export const STOCK_MOVEMENT_TONES: Readonly<
  Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'brand'>
> = {
  RECEIPT: 'success',
  ADJUSTMENT: 'warning',
  TRANSFER_OUT: 'warning',
  TRANSFER_IN: 'success',
  ORDER_DEDUCTION: 'danger',
  ORDER_RELEASE: 'brand',
};

export const STOCK_LEVEL_OPTIONS: ReadonlyArray<{ value: StockLevelFilter; label: string }> = [
  { value: 'all', label: 'Any stock level' },
  { value: 'low', label: 'Low or below threshold' },
  { value: 'out', label: 'Out of stock' },
];

export const MOVEMENT_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'Every type' },
  ...STOCK_MOVEMENT_TYPES.map((type) => ({
    value: type,
    label: STOCK_MOVEMENT_LABELS[type] ?? type,
  })),
];

export function movementTypeLabel(type: string): string {
  return STOCK_MOVEMENT_LABELS[type] ?? type;
}

export function movementTypeTone(
  type: string,
): 'neutral' | 'success' | 'warning' | 'danger' | 'brand' {
  return STOCK_MOVEMENT_TONES[type] ?? 'neutral';
}

/**
 * `+12` from a signed quantity.
 *
 * The sign is the whole point of the ledger's `quantity` column, so it is kept
 * visible rather than shown as an absolute value the reader has to infer.
 */
export function formatQuantityChange(quantity: number): string {
  return quantity > 0 ? `+${quantity}` : String(quantity);
}

/** A plain integer, grouped, for stock counts and thresholds. */
export function formatStock(quantity: number): string {
  return formatCount(quantity);
}
