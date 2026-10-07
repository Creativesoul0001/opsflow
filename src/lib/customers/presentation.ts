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

/**
 * Dates and counts live in `@/lib/format` so every module formats them the same
 * way. Re-exported here so existing customer imports keep working unchanged.
 */
export { formatCount, formatDate, formatDateTime } from '@/lib/format';
