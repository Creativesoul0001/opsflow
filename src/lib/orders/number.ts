/**
 * Order number allocation and formatting.
 *
 * Numbers are human-facing (`ORD-000001`) and unique *per organization*, which
 * rules out a Postgres sequence — one sequence would hand every tenant the same
 * counter. The allocator therefore increments a single `order_sequences` row
 * inside the transaction that creates the order.
 *
 * The formatting side is pure so the shape can be unit tested without a
 * database.
 */

export const ORDER_NUMBER_PREFIX = 'ORD';

/** Digits reserved for the sequence, so the list sorts lexicographically. */
const SEQUENCE_DIGITS = 6;

/**
 * Formats a sequence value as an order number.
 *
 * Six digits cover a million orders per organization before the padding grows;
 * the migration's CHECK allows `ORD-[0-9]{6,}` so that growth does not need a
 * migration.
 */
export function formatOrderNumber(sequence: number): string {
  return `${ORDER_NUMBER_PREFIX}-${String(sequence).padStart(SEQUENCE_DIGITS, '0')}`;
}

/** Extracts the sequence value from an order number, or `null` if malformed. */
export function parseOrderNumber(orderNumber: string): number | null {
  const match = /^([A-Z]+)-(\d{6,})$/.exec(orderNumber);
  if (!match || match[1] !== ORDER_NUMBER_PREFIX) return null;

  const value = Number(match[2]);
  return Number.isSafeInteger(value) ? value : null;
}
