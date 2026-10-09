import { z } from 'zod';

import { ValidationError } from '@/lib/api/errors';
import { formatMinorUnits, parseMinorUnits } from '@/lib/orders/money';
import { StockMovementType } from '@/generated/prisma/enums';

/**
 * Zod contracts for the Inventory module.
 *
 * Same three rules the CRM and Orders modules follow:
 *
 *  * write payloads are `.strict()`, so an unexpected key such as
 *    `organizationId`, `quantityBefore` or `quantityAfter` is a 422 rather than
 *    a silently dropped field. Tenant ownership and the resulting balance are
 *    server-derived and never accepted from a client;
 *  * money arrives as a decimal string (`"1250.50"`) exactly as Orders does,
 *    because that is what a form can send without ever touching a float;
 *  * list query parameters are forgiving — a malformed page number falls back to
 *    its default instead of becoming an error screen, and unknown keys are
 *    stripped rather than rejected so tracking parameters cannot reset a filter.
 *
 * Stock quantities are plain whole numbers. Every product is counted in a
 * labelled unit (`Product.unit`, e.g. "pcs" or "kg"), so there is no fractional
 * unit to round and the ledger's `quantityBefore`/`quantityAfter` pair stays
 * exact.
 */

const MAX_SEARCH = 120;
const MAX_NAME = 160;
const MAX_DESCRIPTION = 2_000;
const MAX_REASON = 500;
const MAX_SKU = 64;
const MAX_CODE = 32;
const MAX_UNIT = 20;
const MAX_ADDRESS_LINE = 160;
const MAX_CITY = 120;

/** Largest quantity a single movement may carry, matching `OrderItem.quantity`. */
export const MAX_QUANTITY = 1_000_000;

/** Transfer numbers are formatted as `TR-000001`. */
export const TRANSFER_NUMBER_PATTERN = /^TR-[0-9]{6,}$/;

export const PRODUCT_SORTS = ['name', 'sku', 'createdAt', 'updatedAt', 'unitPrice'] as const;
export const MOVEMENT_SORTS = ['createdAt', 'quantity'] as const;
export const WAREHOUSE_SORTS = ['name', 'code', 'createdAt'] as const;
export const STOCK_LEVEL_FILTERS = ['all', 'low', 'out'] as const;

export const STOCK_MOVEMENT_TYPES = [
  'RECEIPT',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ORDER_DEDUCTION',
  'ORDER_RELEASE',
] as const;

const uuidSchema = z.uuid('That identifier is not a valid id.');

/** SKU: printable, no whitespace, and unique only inside an organization. */
export const skuSchema = z
  .string()
  .trim()
  .min(1, 'SKU is required.')
  .max(MAX_SKU, `SKU must be at most ${MAX_SKU} characters.`)
  .regex(/^[A-Za-z0-9._-]{1,64}$/, 'Use letters, numbers, dots, dashes or underscores only.');

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters.`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

/** Optional money: absent and empty both mean "no value" (server stores 0). */
const optionalMoney = z
  .string()
  .trim()
  .max(32, 'That amount is not valid.')
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

/**
 * Required money as minor units. Reusing the Orders parser keeps one definition
 * of what a legal amount is, and the check below turns an out-of-range value
 * into a field-level message rather than a database constraint violation.
 */
function minorUnits(value: string, label: string): number {
  const parsed = parseMinorUnits(value);
  if (parsed === null) {
    throw new ValidationError([
      {
        path: '(root)',
        message: `${label} is not a valid amount: enter a number such as 1250.50.`,
      },
    ]);
  }
  return parsed;
}

const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(32, `${label} is not a valid amount.`)
    .transform((value) => minorUnits(value, label));

const unitSchema = z
  .string()
  .trim()
  .max(MAX_UNIT, `Unit must be at most ${MAX_UNIT} characters.`)
  .transform((value) => (value.length === 0 ? 'pcs' : value))
  .optional();

const quantity = (label: string) =>
  z.coerce
    .number()
    .int({ message: `${label} must be a whole number.` })
    .min(1, `${label} must be at least 1.`)
    .max(MAX_QUANTITY, `${label} must be at most ${MAX_QUANTITY}.`);

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const createProductCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Category name is required.')
      .max(MAX_NAME, `Category name must be at most ${MAX_NAME} characters.`),
    description: optionalText(MAX_DESCRIPTION, 'Description'),
  })
  .strict();

export const updateProductCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Category name is required.')
      .max(MAX_NAME, `Category name must be at most ${MAX_NAME} characters.`)
      .optional(),
    description: optionalText(MAX_DESCRIPTION, 'Description'),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const createProductSchema = z
  .object({
    sku: skuSchema,
    name: z
      .string()
      .trim()
      .min(1, 'Product name is required.')
      .max(MAX_NAME, `Product name must be at most ${MAX_NAME} characters.`),
    description: optionalText(MAX_DESCRIPTION, 'Description'),
    categoryId: uuidSchema.nullable().optional(),
    unitPrice: money('Unit price'),
    costPrice: z
      .string()
      .trim()
      .max(32, 'Cost price is not a valid amount.')
      .transform((value) => (value.length === 0 ? null : minorUnits(value, 'Cost price')))
      .nullable()
      .optional(),
    reorderThreshold: z.coerce
      .number()
      .int({ message: 'Reorder threshold must be a whole number.' })
      .min(0, 'Reorder threshold cannot be negative.')
      .max(MAX_QUANTITY, `Reorder threshold must be at most ${MAX_QUANTITY}.`)
      .optional(),
    unit: unitSchema,
  })
  .strict();

export const updateProductSchema = z
  .object({
    sku: skuSchema.optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Product name is required.')
      .max(MAX_NAME, `Product name must be at most ${MAX_NAME} characters.`)
      .optional(),
    description: optionalText(MAX_DESCRIPTION, 'Description'),
    categoryId: uuidSchema.nullable().optional(),
    unitPrice: optionalMoney.transform((value) =>
      value === null || value === undefined ? undefined : minorUnits(value, 'Unit price'),
    ),
    costPrice: z
      .string()
      .trim()
      .max(32, 'Cost price is not a valid amount.')
      .transform((value) => (value.length === 0 ? null : minorUnits(value, 'Cost price')))
      .nullable()
      .optional(),
    reorderThreshold: z.coerce
      .number()
      .int({ message: 'Reorder threshold must be a whole number.' })
      .min(0, 'Reorder threshold cannot be negative.')
      .max(MAX_QUANTITY, `Reorder threshold must be at most ${MAX_QUANTITY}.`)
      .optional(),
    unit: unitSchema,
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

export const createWarehouseSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Warehouse code is required.')
      .max(MAX_CODE, `Warehouse code must be at most ${MAX_CODE} characters.`)
      .regex(/^[A-Za-z0-9._-]{1,32}$/, 'Use letters, numbers, dots, dashes or underscores only.'),
    name: z
      .string()
      .trim()
      .min(1, 'Warehouse name is required.')
      .max(MAX_NAME, `Warehouse name must be at most ${MAX_NAME} characters.`),
    addressLine1: optionalText(MAX_ADDRESS_LINE, 'Address line 1'),
    addressLine2: optionalText(MAX_ADDRESS_LINE, 'Address line 2'),
    city: optionalText(MAX_CITY, 'City'),
    state: optionalText(MAX_CITY, 'State'),
    postalCode: optionalText(32, 'Postal code'),
    country: optionalText(MAX_CITY, 'Country'),
    isPrimary: z.boolean().optional(),
  })
  .strict();

export const updateWarehouseSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(1, 'Warehouse code is required.')
      .max(MAX_CODE, `Warehouse code must be at most ${MAX_CODE} characters.`)
      .regex(/^[A-Za-z0-9._-]{1,32}$/, 'Use letters, numbers, dots, dashes or underscores only.')
      .optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Warehouse name is required.')
      .max(MAX_NAME, `Warehouse name must be at most ${MAX_NAME} characters.`)
      .optional(),
    addressLine1: optionalText(MAX_ADDRESS_LINE, 'Address line 1'),
    addressLine2: optionalText(MAX_ADDRESS_LINE, 'Address line 2'),
    city: optionalText(MAX_CITY, 'City'),
    state: optionalText(MAX_CITY, 'State'),
    postalCode: optionalText(32, 'Postal code'),
    country: optionalText(MAX_CITY, 'Country'),
    isPrimary: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update.',
  });

// ---------------------------------------------------------------------------
// Stock operations
// ---------------------------------------------------------------------------

/**
 * Opening balance or a supplier delivery: always a positive quantity.
 *
 * `ADJUSTMENT` is the only type that accepts a negative delta, because "counted
 * 3 and found 0" is a legitimate correction. Receipts deliberately cannot be
 * negative so an accidental sign cannot silently destroy stock; a removal is an
 * adjustment with a reason.
 */
export const stockReceiptSchema = z
  .object({
    productId: uuidSchema,
    warehouseId: uuidSchema,
    quantity: quantity('Quantity'),
    reason: optionalText(MAX_REASON, 'Reason'),
  })
  .strict();

export const stockAdjustmentSchema = z
  .object({
    productId: uuidSchema,
    warehouseId: uuidSchema,
    quantity: z.coerce
      .number()
      .int({ message: 'Quantity must be a whole number.' })
      .min(-MAX_QUANTITY, `Quantity must be at least -${MAX_QUANTITY}.`)
      .max(MAX_QUANTITY, `Quantity must be at most ${MAX_QUANTITY}.`)
      .refine((value) => value !== 0, 'Quantity must change the stock; zero is not an adjustment.'),
    reason: z
      .string()
      .trim()
      .min(1, 'A reason is required for a stock adjustment.')
      .max(MAX_REASON, `Reason must be at most ${MAX_REASON} characters.`),
  })
  .strict();

export const stockTransferSchema = z
  .object({
    productId: uuidSchema,
    fromWarehouseId: uuidSchema,
    toWarehouseId: uuidSchema,
    quantity: quantity('Quantity'),
    reason: optionalText(MAX_REASON, 'Reason'),
  })
  .strict()
  .refine((value) => value.fromWarehouseId !== value.toWarehouseId, {
    message: 'Pick two different warehouses.',
    path: ['toWarehouseId'],
  });

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

/**
 * `?stock=low` / `?stock=out` is resolved in SQL rather than in the service, so
 * the low-stock report works on a database with millions of movements.
 */
export const productListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(MAX_SEARCH).optional(),
  categoryId: z.string().trim().max(64).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).catch('ACTIVE'),
  stock: z.enum(STOCK_LEVEL_FILTERS).catch('all'),
  sort: z.enum(PRODUCT_SORTS).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
});

export const warehouseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  search: z.string().trim().max(MAX_SEARCH).optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).catch('ACTIVE'),
  sort: z.enum(WAREHOUSE_SORTS).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
});

export const stockMovementQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(25),
  search: z.string().trim().max(MAX_SEARCH).optional(),
  productId: z.string().trim().max(64).optional(),
  warehouseId: z.string().trim().max(64).optional(),
  orderId: z.string().trim().max(64).optional(),
  transferId: z.string().trim().max(64).optional(),
  type: commaSeparated(z.enum(STOCK_MOVEMENT_TYPES)),
  sort: z.enum(MOVEMENT_SORTS).catch('createdAt'),
  order: z.enum(['asc', 'desc']).catch('desc'),
});

/** Allows `?type=RECEIPT,ADJUSTMENT` as well as a single value. */
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
 * The reorder report's parameters.
 *
 * `level=low` is the default and means "in stock but at or below the threshold";
 * `level=out` restricts the report to products with nothing anywhere. Both are
 * valid enum members, so an unrecognised value falls back to `low` rather than
 * producing an error screen.
 */
export const lowStockQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).catch(1),
  limit: z.coerce.number().int().min(1).max(100).catch(20),
  level: z.enum(['low', 'out']).catch('low'),
});

export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;
export type CreateWarehouseInput = z.infer<typeof createWarehouseSchema>;
export type UpdateWarehouseInput = z.infer<typeof updateWarehouseSchema>;
export type StockReceiptInput = z.infer<typeof stockReceiptSchema>;
export type StockAdjustmentInput = z.infer<typeof stockAdjustmentSchema>;
export type StockTransferInput = z.infer<typeof stockTransferSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type WarehouseListQuery = z.infer<typeof warehouseListQuerySchema>;
export type StockMovementQuery = z.infer<typeof stockMovementQuerySchema>;
export type ProductSort = (typeof PRODUCT_SORTS)[number];
export type StockLevelFilter = (typeof STOCK_LEVEL_FILTERS)[number];

/**
 * Validates an id taken from a route path.
 *
 * Rejecting a malformed id before the database is called keeps a bad path value
 * a 422 rather than a driver-level failure, and guarantees the value handed to
 * Prisma is a well-formed UUID.
 */
function parseId(value: string, label: string): string {
  const result = uuidSchema.safeParse(value);

  if (!result.success) {
    throw new ValidationError([{ path: 'id', message: `That ${label} id is not valid.` }]);
  }

  return result.data;
}

/**
 * Builds list params from raw `searchParams`, collapsing repeated values.
 *
 * Page components use this instead of `parseOrThrow`, so a hand-edited URL with
 * an unusable value still renders a usable page instead of an error screen —
 * the same contract the orders list satisfies.
 */
export function coerceProductListQuery(input: unknown): ProductListQuery {
  const normalized = Object.fromEntries(
    Object.entries((input ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const result = productListQuerySchema.safeParse(normalized);
  return result.success ? result.data : productListQuerySchema.parse({});
}

/** Same forgiving coercion for the movement ledger's parameters. */
export function coerceStockMovementQuery(input: unknown): StockMovementQuery {
  const normalized = Object.fromEntries(
    Object.entries((input ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const result = stockMovementQuerySchema.safeParse(normalized);
  return result.success ? result.data : stockMovementQuerySchema.parse({});
}

/** Same forgiving coercion for the warehouse list's parameters. */
export function coerceWarehouseListQuery(input: unknown): WarehouseListQuery {
  const normalized = Object.fromEntries(
    Object.entries((input ?? {}) as Record<string, unknown>).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );

  const result = warehouseListQuerySchema.safeParse(normalized);
  return result.success ? result.data : warehouseListQuerySchema.parse({});
}

export function parseProductId(value: string): string {
  return parseId(value, 'product');
}

export function parseWarehouseId(value: string): string {
  return parseId(value, 'warehouse');
}

export function parseProductCategoryId(value: string): string {
  return parseId(value, 'category');
}

/** True when a movement type exists in this build's enum. */
export function isStockMovementType(value: string): value is (typeof STOCK_MOVEMENT_TYPES)[number] {
  return (STOCK_MOVEMENT_TYPES as readonly string[]).includes(value);
}

export { StockMovementType };

/** `TR-000001` from a counter value, mirroring the order-number formatter. */
export function formatTransferNumber(value: number): string {
  return `TR-${String(value).padStart(6, '0')}`;
}

/** Parses a wire quantity change back to the ledger's signed integer. */
export function formatQuantityChange(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export { formatMinorUnits };
