import { formatCount, formatDate, formatDateTime } from '@/lib/format';
import { ORDER_STATUS_LABELS, ORDER_STATUSES, isOrderStatus } from '@/lib/orders/status';

/**
 * Display helpers shared by the order server and client components.
 *
 * Money and tax formatting lives here too, and both are *string* operations:
 * `formatMoney` groups an already-validated decimal string without ever handing
 * it to `parseFloat`, so no display path can introduce the rounding that the
 * arithmetic module exists to avoid.
 *
 * Like the rest of the Orders library layer this file imports no database and no
 * React, so every helper is unit testable.
 */

export { formatCount, formatDate, formatDateTime };

export const ORDER_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  CREATED: 'Order created',
  UPDATED: 'Order updated',
  STATUS_CHANGED: 'Status changed',
  ASSIGNED: 'Assignment changed',
  CANCELLED: 'Order cancelled',
  NOTE_ADDED: 'Note added',
};

export const ORDER_STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  ...ORDER_STATUSES.map((status) => ({ value: status, label: ORDER_STATUS_LABELS[status] })),
];

export const ORDER_ASSIGNEE_OPTIONS = [
  { value: '', label: 'Anyone' },
  { value: 'me', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
];

/** The next status the UI offers, in workflow order, for a menu of actions. */
export const ORDER_TRANSITION_LABELS: Readonly<Record<string, string>> = {
  CONFIRMED: 'Confirm order',
  PROCESSING: 'Start processing',
  SHIPPED: 'Mark shipped',
  DELIVERED: 'Mark delivered',
};

export function orderStatusLabel(status: string): string {
  return isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
}

export function orderActivityLabel(type: string): string {
  return ORDER_ACTIVITY_LABELS[type] ?? type;
}

/**
 * `$1,250.50` from a decimal string.
 *
 * Entirely string based: the integer part is grouped with a look-ahead regex and
 * the fraction is padded to two digits. No `Number`, no `parseFloat`, so a value
 * such as `"0.1"` can never appear as `$0.10000000000000001`, and a malformed
 * amount is displayed rather than silently rounded.
 */
export function formatMoney(value: string): string {
  const [integer = '', fraction] = value.split('.');
  const grouped = (integer || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (fraction ?? '').padEnd(2, '0').slice(0, 2);
  return `$${grouped}.${cents}`;
}

/**
 * `true` when a decimal string is zero, without converting it to a number.
 *
 * `Number(value) === 0` would work for well-formed input, but it is also true for
 * malformed input such as `Number('0x0')`, and presentation should never be the
 * first place a bad amount is accepted.
 */
export function isZeroAmount(value: string): boolean {
  return /^[0.]*$/.test(value.trim());
}

/**
 * `18.5%`, or an explicit zero label.
 *
 * A rate of zero is written out rather than shown as `0%`, because "No tax" and
 * "0%" carry different weight on an invoice and only the first is a statement
 * about the order rather than a number someone has to interpret.
 */
export function formatTaxRate(rate: string): string {
  return isZeroAmount(rate) ? 'No tax' : `${rate}%`;
}

/** Line count for headers: `3 items`. */
export function formatItemCount(count: number): string {
  return `${formatCount(count)} item${count === 1 ? '' : 's'}`;
}
