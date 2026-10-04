/**
 * Display helpers shared by the customer server and client components.
 *
 * Kept free of React and of any database import so labels and formatting stay
 * unit-testable and identical wherever they are rendered.
 */

export const CUSTOMER_STATUS_LABELS: Readonly<Record<string, string>> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LEAD: 'Lead',
  ARCHIVED: 'Archived',
};

export const CUSTOMER_TYPE_LABELS: Readonly<Record<string, string>> = {
  INDIVIDUAL: 'Individual',
  BUSINESS: 'Business',
};

export const CUSTOMER_ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  CREATED: 'Customer created',
  UPDATED: 'Details updated',
  NOTE_ADDED: 'Note added',
  ASSIGNED: 'Assignment changed',
  ARCHIVED: 'Customer archived',
};

export const CUSTOMER_STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'LEAD', label: 'Lead' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export const CUSTOMER_TYPE_OPTIONS = [
  { value: '', label: 'Any type' },
  { value: 'INDIVIDUAL', label: 'Individual' },
  { value: 'BUSINESS', label: 'Business' },
];

export const CUSTOMER_ASSIGNEE_OPTIONS = [
  { value: '', label: 'Anyone' },
  { value: 'me', label: 'Assigned to me' },
  { value: 'unassigned', label: 'Unassigned' },
];

export function customerStatusLabel(status: string): string {
  return CUSTOMER_STATUS_LABELS[status] ?? status;
}

export function customerTypeLabel(customerType: string): string {
  return CUSTOMER_TYPE_LABELS[customerType] ?? customerType;
}

export function customerActivityLabel(type: string): string {
  return CUSTOMER_ACTIVITY_LABELS[type] ?? type;
}

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

/** `1,204` — used for counts in the list header and dashboard. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}