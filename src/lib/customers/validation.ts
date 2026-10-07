import { z } from 'zod';

import { ValidationError } from '@/lib/api/errors';
import { emailSchema } from '@/lib/validation';

/**
 * Zod contracts for the CRM module.
 *
 * Everything a client sends about a customer is parsed here before it reaches
 * the service layer. Two deliberate choices:
 *
 *  * Write payloads use `.strict()`, so an unexpected key (for example a client
 *    trying to set `organizationId` or `archivedAt` directly) is a 422 instead of
 *    being silently dropped. Tenant ownership is never client-settable.
 *  * Absent vs. empty distinction: forms submit `''` for "cleared", which is
 *    normalised to `null` rather than stored as an empty string.
 */

const MAX_NAME = 80;
const MAX_COMPANY = 120;
const MAX_PHONE = 32;
const MAX_NOTES = 5_000;
const MAX_SEARCH = 120;

/** `''` from a form means "no value"; normalise it to `null`. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();
}

export const customerStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'LEAD', 'ARCHIVED']);
export const customerTypeSchema = z.enum(['INDIVIDUAL', 'BUSINESS']);

/**
 * Archiving is deliberately unreachable through the update schema: it is a
 * distinct operation with its own permission and its own activity record, so the
 * status a member may set by hand stops short of the terminal value.
 */
export const editableCustomerStatusSchema = z.enum(['ACTIVE', 'INACTIVE', 'LEAD']);

const PHONE_PATTERN = /^[+()0-9 .-]*$/;

/** Optional phone: an empty submission clears the field, anything else is checked. */
const optionalPhone = z
  .string()
  .trim()
  .max(MAX_PHONE, `Phone must be at most ${MAX_PHONE} characters.`)
  .regex(PHONE_PATTERN, 'Phone may only contain digits, spaces and + - ( ) . characters.')
  .refine((value) => value.length === 0 || value.length >= 3, 'Enter a valid phone number.')
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

const requiredName = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(MAX_NAME, `${label} must be at most ${MAX_NAME} characters.`);

const uuidSchema = z.uuid('That identifier is not a valid id.');

export const createCustomerSchema = z
  .object({
    firstName: requiredName('First name'),
    lastName: requiredName('Last name'),
    email: emailSchema,
    phone: optionalPhone,
    companyName: optionalText(MAX_COMPANY, 'Company name'),
    status: editableCustomerStatusSchema.default('ACTIVE'),
    customerType: customerTypeSchema.default('INDIVIDUAL'),
    assignedUserId: uuidSchema.nullable().optional(),
    notes: optionalText(MAX_NOTES, 'Notes'),
  })
  .strict();

/**
 * Partial update. At least one field must be supplied so an accidental empty
 * PATCH is a 422 rather than a silent no-op.
 */
export const updateCustomerSchema = z
  .object({
    firstName: requiredName('First name').optional(),
    lastName: requiredName('Last name').optional(),
    email: emailSchema.optional(),
    phone: optionalPhone,
    companyName: optionalText(MAX_COMPANY, 'Company name'),
    status: editableCustomerStatusSchema.optional(),
    customerType: customerTypeSchema.optional(),
    notes: optionalText(MAX_NOTES, 'Notes'),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

/** Assignment is its own operation because it carries its own permission. */
export const assignCustomerSchema = z
  .object({
    // `null` unassigns; the key is required so clearing is an explicit choice.
    assignedUserId: uuidSchema.nullable(),
  })
  .strict();

export const customerNoteSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Note cannot be empty.')
      .max(2_000, 'Note must be at most 2000 characters.'),
  })
  .strict();

export const CUSTOMER_SORTS = ['name', 'createdAt', 'updatedAt', 'status'] as const;
export const CUSTOMER_ASSIGNEE_FILTERS = ['me', 'unassigned'] as const;

const booleanParam = z
  .union([z.boolean(), z.string()])
  .transform((value) => value === true || value === 'true' || value === '1' || value === '');

/** Allows `?status=ACTIVE,LEAD` as well as a single value. */
function commaSeparated<T extends z.ZodType<string>>(schema: T) {
  return z
    .preprocess(
      (input) =>
        typeof input === 'string'
          ? input
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : input,
      z.array(schema).optional(),
    )
    .transform((list) => (list && list.length > 0 ? list : undefined));
}

/**
 * List query parameters.
 *
 * Pagination and sorting are forgiving — a malformed value falls back to its
 * default rather than producing a 422, because a mistyped page number should not
 * become an error screen. Unknown keys are stripped rather than rejected, so
 * tracking parameters cannot reset the member's filters.
 *
 * `limit` is capped at 100 so a client cannot ask for the whole table in one
 * response.
 */
export const customerListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(MAX_SEARCH).optional(),
  status: commaSeparated(customerStatusSchema),
  type: commaSeparated(customerTypeSchema),
  assignedTo: z.string().trim().max(64).optional(),
  includeArchived: booleanParam.default(false),
  sort: z.enum(CUSTOMER_SORTS).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
});

export const customerActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
});

/**
 * The service contract uses Zod's *input* type: `status` and `customerType` have
 * schema defaults, so a caller that omits them passes a valid object. The parsed
 * *output* type would demand them explicitly, which reads as "required" at every
 * call site even though the service already falls back to the same defaults.
 */
export type CreateCustomerInput = z.input<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.input<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CustomerActivityQuery = z.infer<typeof customerActivityQuerySchema>;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];
export type CustomerStatusValue = z.infer<typeof customerStatusSchema>;
export type CustomerTypeValue = z.infer<typeof customerTypeSchema>;

/**
 * Validates a customer id taken from a route path.
 *
 * Rejecting a malformed id before the database is called keeps a bad path value
 * a 422 rather than a driver-level failure, and guarantees the value handed to
 * Prisma is a well-formed UUID.
 */
export function parseCustomerId(value: string): string {
  const result = uuidSchema.safeParse(value);

  if (!result.success) {
    throw new ValidationError([{ path: 'id', message: 'That customer id is not valid.' }]);
  }

  return result.data;
}

/**
 * Builds list params from raw `searchParams`, collapsing repeated values.
 *
 * Page components use this instead of `parseOrThrow`, so a hand-edited URL with
 * an unusable value still renders a usable page instead of an error screen.
 */
export function coerceCustomerListQuery(input: unknown): CustomerListQuery {
  const normalized = Object.fromEntries(
    Object.entries((input ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const result = customerListQuerySchema.safeParse(normalized);
  return result.success ? result.data : customerListQuerySchema.parse({});
}
