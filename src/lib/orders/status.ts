import type { BadgeTone } from '@/components/ui/badge';

/**
 * Order lifecycle policy.
 *
 * The workflow is deliberately kept here rather than in the database. A
 * `CHECK` constraint could enforce it, but a constraint can only say "no" —
 * it cannot tell a member *that* a shipped order has to be delivered before it
 * can be cancelled. Expressing the policy as data lets the API return a
 * meaningful 409 and lets the UI disable actions that would be rejected anyway.
 */

export const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;

export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/** Statuses that can never be left. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatusValue[] = ['DELIVERED', 'CANCELLED'];

/**
 * Legal forward transitions.
 *
 * The happy path advances one step at a time, and cancellation is offered from
 * every stage where the goods have not left yet. `SHIPPED` can only become
 * `DELIVERED`: by then the order is in a courier's hands and "cancel" would be
 * a lie about what physically happened.
 */
const ALLOWED_TRANSITIONS: Record<OrderStatusValue, readonly OrderStatusValue[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export const ORDER_STATUS_LABELS: Record<OrderStatusValue, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
};

/**
 * Tone per status, used by the badge in tables and on the detail page. Kept in
 * the library layer so a test can assert every status has one.
 */
export const ORDER_STATUS_TONES: Record<OrderStatusValue, BadgeTone> = {
  PENDING: 'warning',
  CONFIRMED: 'brand',
  PROCESSING: 'brand',
  SHIPPED: 'neutral',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

export function isOrderStatus(value: string): value is OrderStatusValue {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isTerminalOrderStatus(status: OrderStatusValue): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/** Whether `from -> to` is an allowed transition. */
export function canTransition(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Every status `from` may move to, for driving the UI's action menu. */
export function allowedTransitions(from: OrderStatusValue): readonly OrderStatusValue[] {
  return ALLOWED_TRANSITIONS[from];
}

/**
 * Cancellation is legal from any stage before delivery, and never from
 * `CANCELLED` itself (it is already cancelled, so re-cancelling is a no-op
 * rather than a second event).
 */
export function canCancel(status: OrderStatusValue): boolean {
  return status !== 'CANCELLED' && status !== 'DELIVERED';
}

/**
 * Human-readable reason a transition was refused.
 *
 * Returns `null` when the transition is allowed, so one call answers both
 * questions and the API cannot report success and a reason at the same time.
 */
export function transitionRejection(from: OrderStatusValue, to: OrderStatusValue): string | null {
  if (canTransition(from, to)) return null;

  if (from === to) {
    return `This order is already ${ORDER_STATUS_LABELS[to].toLowerCase()}.`;
  }

  if (isTerminalOrderStatus(from)) {
    return `An order that is ${ORDER_STATUS_LABELS[from].toLowerCase()} cannot be changed.`;
  }

  const options = ALLOWED_TRANSITIONS[from]
    .map((status) => ORDER_STATUS_LABELS[status].toLowerCase())
    .join(' or ');

  return `An order that is ${ORDER_STATUS_LABELS[from].toLowerCase()} can only become ${options}.`;
}
