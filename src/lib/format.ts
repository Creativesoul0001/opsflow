/**
 * Date and number formatting shared by every module.
 *
 * Extracted from the customer presentation layer so Orders can format a date the
 * same way without importing from a sibling module. Kept free of React and of
 * any database import so the output is unit-testable and identical whether it is
 * produced on the server or in the browser.
 */

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/**
 * Formats an ISO timestamp as `Mar 4, 2026`.
 *
 * The time zone is pinned to UTC so the same string is produced on the server and
 * in the browser; a locale-dependent default would risk a hydration mismatch.
 */
export function formatDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso));
}

/** `1,204` — used for counts in list headers and on the dashboard. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}
