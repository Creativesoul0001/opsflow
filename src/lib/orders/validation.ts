import { z } from 'zod';

import { ValidationError } from '@/lib/api/errors';
import { MAX_ORDER_ITEMS, MAX_QUANTITY } from '@/lib/orders/calculation';
import { ORDER_STATUSES } from '@/lib/orders/status';

/**
 * Zod contracts for the Orders module.
 *
 * The same two rules the CRM follows apply here:
 *
 *  * write payloads are `.strict()`, so an unexpected key such as
 *    `organizationId`, `subtotal`, `total` or `orderNumber` is a 422 rather than
 *    a silently dropped field. Tenant ownership, order numbers and every money
 *    total are server-derived and are never accepted from a client;
 *  * money arrives as a decimal *string* (`"1250.50"`), because that is what a
 *    form can send without ever touching a float. Parsing to integer minor
 *    units happens in `@/lib/orders/money`.
 */

const MAX_NOTES = 5_000;
const MAX_SEARCH = 120;
const MAX_LINE_NAME = 160;
const MAX_REASON = 500;

const uuidSchema = z.uuid('That identifier is not a valid id.');

/**
 * Optional money field: absent and empty both mean "no value". The service
 * falls back to `0`, and the arithmetic module re-validates the range so the
 * limit is enforced in exactly one place regardless of who calls it.
 */
const optionalMoney = z
  .string()
  .trim()
  .max(32, 'That amount is not valid.')
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

/** Optional notes/label: `''` from a form means the field was cleared. */
function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();
}

export const orderStatusSchema = z.enum(ORDER_STATUSES);

/**
 * Initial status is intentionally absent from `createOrderSchema`: an order is
 * always born `PENDING` and may only reach another status through the
 * permission-checked transition endpoint, so creating an order cannot be used
 * to skip the workflow.
 */
export const orderLineSchema = z
  .object({
    productId: uuidSchema.nullable().optional(),
    productName: z
      .string()
      .trim()
      .min(1, 'Item name is required.')
      .max(MAX_LINE_NAME, `Item name must be at most ${MAX_LINE_NAME} characters.`),
    quantity: z.coerce
      .number()
      .int({ message: 'Quantity must be a whole number.' })
      .min(1, 'Quantity must be at least 1.')
      .max(MAX_QUANTITY, `Quantity must be at most ${MAX_QUANTITY}.`),
    unitPrice: z
      .string()
      .trim()
      .min(1, 'Unit price is required.')
      .max(32, 'That price is not valid.'),
    discount: optionalMoney,
  })
  .strict();

export const createOrderSchema = z
  .object({
    customerId: uuidSchema,
    items: z
      .array(orderLineSchema)
      .min(1, 'An order needs at least one line item.')
      .max(MAX_ORDER_ITEMS, `An order can hold at most ${MAX_ORDER_ITEMS} line items.`),
    discount: optionalMoney,
    taxRate: optionalMoney,
    notes: optionalText(MAX_NOTES, 'Notes'),
    assignedUserId: uuidSchema.nullable().optional(),
  })
  .strict();

/**
 * Partial update. Only the customer and the money inputs are editable — and
 * only while the order is still `PENDING` or `CONFIRMED`, which the service
 * enforces. Reaching `updateOrderSchema` with nothing supplied is a 422 rather
 * than a no-op, matching the customer module.
 */
export const updateOrderSchema = z
  .object({
    customerId: uuidSchema.optional(),
    items: z
      .array(orderLineSchema)
      .min(1, 'An order needs at least one line item.')
      .max(MAX_ORDER_ITEMS, `An order can hold at most ${MAX_ORDER_ITEMS} line items.`)
      .optional(),
    discount: optionalMoney,
    taxRate: optionalMoney,
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

/** Status change is its own operation because it carries its own permission. */
export const changeOrderStatusSchema = z
  .object({
    status: orderStatusSchema,
  })
  .strict();

/** Cancellation reason is optional, but the key must be present when sent. */
export const cancelOrderSchema = z
  .object({
    reason: optionalText(MAX_REASON, 'Reason'),
  })
  .strict();

/** Assignment is its own operation because it carries its own permission. */
export const assignOrderSchema = z
  .object({
    // `null` unassigns; the key is required so clearing is an explicit choice.
    assignedUserId: uuidSchema.nullable(),
  })
  .strict();

export const orderNoteSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Note cannot be empty.')
      .max(2_000, 'Note must be at most 2000 characters.'),
  })
  .strict();

export const ORDER_SORTS = ['orderNumber', 'createdAt', 'updatedAt', 'total', 'status'] as const;
export const ORDER_ASSIGNEE_FILTERS = ['me', 'unassigned'] as const;

/** Allows `?status=PENDING,CONFIRMED` as well as a single value. */
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
 */
export const orderListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(MAX_SEARCH).optional(),
  status: commaSeparated(orderStatusSchema),
  customerId: z.string().trim().max(64).optional(),
  assignedTo: z.string().trim().max(64).optional(),
  sort: z.enum(ORDER_SORTS).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
});

export const orderActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
});

/**
 * The service contract uses Zod's *output* type rather than its input type.
 *
 * Unlike the customer module, `quantity` is coerced (`z.coerce.number()`), so a
 * JSON body may send `"5"` and `z.input` would collapse to `unknown` and be
 * useless at every call site. Everything the service receives has already been
 * through `parseOrThrow`, which is what makes it a `number`.
 */
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type OrderLineInput = z.infer<typeof orderLineSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type OrderActivityQuery = z.infer<typeof orderActivityQuerySchema>;
export type OrderSort = (typeof ORDER_SORTS)[number];
export type OrderStatusValue = z.infer<typeof orderStatusSchema>;

/**
 * Validates an order id taken from a route path.
 *
 * Rejecting a malformed id before the database is called keeps a bad path value
 * a 422 rather than a driver-level failure, and guarantees the value handed to
 * Prisma is a well-formed UUID.
 */
export function parseOrderId(value: string): string {
  const result = uuidSchema.safeParse(value);

  if (!result.success) {
    throw new ValidationError([{ path: 'id', message: 'That order id is not valid.' }]);
  }

  return result.data;
}

/**
 * Builds list params from raw `searchParams`, collapsing repeated values.
 *
 * Page components use this instead of `parseOrThrow`, so a hand-edited URL with
 * an unusable value still renders a usable page instead of an error screen.
 */
export function coerceOrderListQuery(input: unknown): OrderListQuery {
  const normalized = Object.fromEntries(
    Object.entries((input ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const result = orderListQuerySchema.safeParse(normalized);
  return result.success ? result.data : orderListQuerySchema.parse({});
}
