import 'server-only';

import { ProductStatus, WarehouseStatus } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';

import { ConflictError, NotFoundError, isPrismaLikeError, ValidationError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { formatMinorUnits } from '@/lib/orders/money';
import {
  buildProductOrderBy,
  buildProductWhere,
  buildWarehouseOrderBy,
  buildWarehouseWhere,
  buildPagination,
  type Pagination,
} from '@/lib/inventory/query';
import {
  findStockLevels,
  countStockLevels,
  type LowStockProductRow,
} from '@/lib/inventory/stock-levels';
import type {
  CreateProductCategoryInput,
  CreateProductInput,
  CreateWarehouseInput,
  ProductListQuery,
  UpdateProductCategoryInput,
  UpdateProductInput,
  UpdateWarehouseInput,
  WarehouseListQuery,
} from '@/lib/inventory/validation';
import { assertPermission, type AuthorizationContext } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';

const log = logger.child('inventory');

/**
 * Product, category and warehouse service.
 *
 * The two rules the CRM and Orders services establish hold here unchanged:
 *
 *  1. Every read filters on `organizationId: context.organizationId`, which comes
 *     from a verified membership — never from the request.
 *  2. Single-record lookups use `findFirst({ where: { id, organizationId } })`,
 *     so a caller who knows another tenant's product id gets the same 404 as for
 *     an id that does not exist, which confirms nothing about that tenant.
 *
 * Inventory adds a third rule the other modules did not need: **nothing is ever
 * deleted**. Products, categories and warehouses are archived. A product that
 * was once on an order must stay addressable forever, because stock movements
 * reference it and the order ledger must keep explaining itself.
 */

// ---------------------------------------------------------------------------
// DTO shapes
// ---------------------------------------------------------------------------

const PRODUCT_SELECT = {
  id: true,
  sku: true,
  name: true,
  description: true,
  unitPrice: true,
  costPrice: true,
  reorderThreshold: true,
  unit: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, archivedAt: true } },
} as const;

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  country: true,
  isPrimary: true,
  status: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const CATEGORY_SELECT = {
  id: true,
  name: true,
  description: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const STOCK_SELECT = {
  id: true,
  warehouseId: true,
  quantity: true,
  warehouse: { select: { code: true, name: true, isPrimary: true } },
} as const;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;
type WarehouseRow = Prisma.WarehouseGetPayload<{ select: typeof WAREHOUSE_SELECT }>;
type CategoryRow = Prisma.ProductCategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;

export interface StockLevelDto {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  isPrimary: boolean;
  quantity: number;
}

export interface ProductDto {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  /** Selling price in major units, e.g. `"1250.50"`. */
  unitPrice: string;
  /** Purchase cost in major units, when tracked. */
  costPrice: string | null;
  reorderThreshold: number;
  unit: string;
  status: string;
  /** Sum of the product's quantity across every warehouse. */
  totalStock: number;
  stocks: StockLevelDto[];
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarehouseDto {
  id: string;
  code: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  isPrimary: boolean;
  status: string;
  /** Distinct products held here. */
  productCount: number;
  /** Sum of every product's quantity here. */
  totalUnits: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductCategoryDto {
  id: string;
  name: string;
  description: string | null;
  /** Products currently grouped in this category (archived ones included). */
  productCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryStats {
  /** Active products. */
  totalProducts: number;
  /** Sum of every product's quantity across every warehouse. */
  totalStockUnits: number;
  lowStock: number;
  outOfStock: number;
  /** Active warehouses. */
  warehouses: number;
}

function toStockDto(row: {
  warehouseId: string;
  quantity: number;
  warehouse: { code: string; name: string; isPrimary: boolean };
}): StockLevelDto {
  return {
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    warehouseName: row.warehouse.name,
    isPrimary: row.warehouse.isPrimary,
    quantity: row.quantity,
  };
}

/** Products do not carry a stock row per warehouse until stock is received. */
function toProductDto(row: ProductRow & { stocks?: unknown[] }): ProductDto {
  const stocks = (row.stocks ?? []).map((stock) =>
    toStockDto(
      stock as {
        warehouseId: string;
        quantity: number;
        warehouse: { code: string; name: string; isPrimary: boolean };
      },
    ),
  );

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    categoryId: row.category?.id ?? null,
    categoryName: row.category?.name ?? null,
    unitPrice: formatMinorUnits(row.unitPrice),
    costPrice: row.costPrice === null ? null : formatMinorUnits(row.costPrice),
    reorderThreshold: row.reorderThreshold,
    unit: row.unit,
    status: row.status,
    totalStock: stocks.reduce((sum, stock) => sum + stock.quantity, 0),
    stocks,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toWarehouseDto(row: WarehouseRow): WarehouseDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    addressLine1: row.addressLine1,
    addressLine2: row.addressLine2,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    isPrimary: row.isPrimary,
    status: row.status,
    productCount: 0,
    totalUnits: 0,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireProduct(
  context: AuthorizationContext,
  productId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<ProductRow> {
  const product = await client.product.findFirst({
    where: { id: productId, organizationId: context.organizationId },
    select: PRODUCT_SELECT,
  });

  if (!product) throw new NotFoundError('Product not found.');
  return product;
}

async function requireWarehouse(
  context: AuthorizationContext,
  warehouseId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<WarehouseRow> {
  const warehouse = await client.warehouse.findFirst({
    where: { id: warehouseId, organizationId: context.organizationId },
    select: WAREHOUSE_SELECT,
  });

  if (!warehouse) throw new NotFoundError('Warehouse not found.');
  return warehouse;
}

async function requireCategory(
  context: AuthorizationContext,
  categoryId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<CategoryRow> {
  const category = await client.productCategory.findFirst({
    where: { id: categoryId, organizationId: context.organizationId },
    select: CATEGORY_SELECT,
  });

  if (!category) throw new NotFoundError('Category not found.');
  return category;
}

/**
 * Resolves the category a product is being placed in.
 *
 * The lookup is tenant-scoped, so a category id from another organization is
 * indistinguishable from one that does not exist. Archiving a grouping must not
 * silently detach every product in it, so it is a rejection instead.
 */
async function resolveCategory(
  context: AuthorizationContext,
  categoryId: string | null | undefined,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<string | null> {
  if (categoryId === undefined || categoryId === null) return null;

  const category = await client.productCategory.findFirst({
    where: { id: categoryId, organizationId: context.organizationId },
    select: { id: true, archivedAt: true },
  });

  if (!category) {
    throw new ValidationError([
      { path: 'categoryId', message: 'That category does not exist in this organization.' },
    ]);
  }

  if (category.archivedAt) {
    throw new ValidationError([
      { path: 'categoryId', message: 'That category is archived. Choose another one.' },
    ]);
  }

  return category.id;
}

/**
 * Makes `organizationId` own exactly one primary warehouse.
 *
 * The database already enforces uniqueness with a partial unique index, so this
 * only has to demote the previous holder. Doing it in the same transaction is
 * what stops two concurrent updates from both failing on the index.
 */
async function setPrimaryWarehouse(
  tx: Prisma.TransactionClient,
  organizationId: string,
  warehouseId: string,
): Promise<void> {
  await tx.warehouse.updateMany({
    where: { organizationId, isPrimary: true, id: { not: warehouseId } },
    data: { isPrimary: false },
  });

  await tx.warehouse.update({
    where: { id: warehouseId },
    data: { isPrimary: true },
    select: { id: true },
  });
}

/**
 * Turns a unique-constraint violation into a field-level message.
 *
 * The database is the authority (a pre-flight check would still race), and the
 * raw constraint name says nothing useful to the member who just typed a SKU.
 */
function withDuplicateGuard<T>(path: string, message: string, operation: () => Promise<T>) {
  return operation().catch((error: unknown) => {
    if (isPrismaLikeError(error) && error.code === 'P2002') {
      throw new ValidationError([{ path, message }]);
    }
    throw error;
  });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/** Every category of the organization, for the pickers and the manager. */
export async function listProductCategories(
  context: AuthorizationContext,
  options: { includeArchived?: boolean } = {},
): Promise<ProductCategoryDto[]> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const rows = await db.$transaction([
    db.productCategory.findMany({
      where: {
        organizationId: context.organizationId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      select: { ...CATEGORY_SELECT, _count: { select: { products: true } } },
      orderBy: [{ name: 'asc' }],
    }),
    db.productCategory.count({ where: { organizationId: context.organizationId } }),
  ]);

  const [categories] = rows;

  return categories.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    productCount: row._count.products,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createProductCategory(
  context: AuthorizationContext,
  input: CreateProductCategoryInput,
): Promise<ProductCategoryDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

  const row = await withDuplicateGuard(
    'name',
    'A category with that name already exists in this organization.',
    () =>
      db.$transaction(async (tx) => {
        const created = await tx.productCategory.create({
          data: {
            organizationId: context.organizationId,
            name: input.name,
            description: input.description ?? null,
          },
          select: { ...CATEGORY_SELECT, _count: { select: { products: true } } },
        });

        return created;
      }),
  );

  log.info('Product category created', {
    organizationId: context.organizationId,
    categoryId: row.id,
    userId: context.userId,
  });

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    productCount: row._count.products,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateProductCategory(
  context: AuthorizationContext,
  categoryId: string,
  input: UpdateProductCategoryInput,
): Promise<ProductCategoryDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

  const row = await withDuplicateGuard(
    'name',
    'A category with that name already exists in this organization.',
    () =>
      db.$transaction(async (tx) => {
        const existing = await requireCategory(context, categoryId, tx);

        if (existing.archivedAt && input.name !== undefined) {
          // Renaming an archived grouping would let it be quietly reused; the
          // member is told to restore it first if that is what they meant.
          throw new ConflictError('Archived categories cannot be renamed.');
        }

        const updated = await tx.productCategory.update({
          where: { id: existing.id },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
          },
          select: { ...CATEGORY_SELECT, _count: { select: { products: true } } },
        });

        return updated;
      }),
  );

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    productCount: row._count.products,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Archives a category. The products inside it are kept and become uncategorised,
 * because `Product.categoryId` is `onDelete: SetNull`-equivalent here — the
 * grouping is retired, the catalogue is not.
 */
export async function archiveProductCategory(
  context: AuthorizationContext,
  categoryId: string,
): Promise<ProductCategoryDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_CATEGORY_MANAGE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireCategory(context, categoryId, tx);

    if (existing.archivedAt) {
      throw new ConflictError('That category is already archived.');
    }

    await tx.product.updateMany({
      where: { organizationId: context.organizationId, categoryId: existing.id },
      data: { categoryId: null },
    });

    return tx.productCategory.update({
      where: { id: existing.id },
      data: { archivedAt: new Date() },
      select: { ...CATEGORY_SELECT, _count: { select: { products: true } } },
    });
  });

  log.info('Product category archived', {
    organizationId: context.organizationId,
    categoryId: row.id,
    userId: context.userId,
  });

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    productCount: row._count.products,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/**
 * Lists products for the caller's organization.
 *
 * `stock=low` / `stock=out` is resolved by the SQL helper in
 * `inventory/stock-levels`, because the comparison it performs (the summed
 * quantity against the product's own threshold) is between two columns and has
 * to happen in the database. The ids it returns are then intersected into the
 * ordinary `where`, so search, category filtering, sorting and pagination keep
 * working exactly as they do for the unfiltered list.
 */
export async function listProducts(
  context: AuthorizationContext,
  query: ProductListQuery,
): Promise<{ products: ProductDto[]; pagination: Pagination }> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const where = buildProductWhere(context, query);

  if (query.stock !== 'all') {
    const flags = await findStockLevels(context.organizationId, query.stock);
    where.id = { in: flags.map((flag) => flag.productId) };
  }

  const [rows, total] = await db.$transaction([
    db.product.findMany({
      where,
      select: { ...PRODUCT_SELECT, stocks: { select: STOCK_SELECT } },
      orderBy: buildProductOrderBy(query.sort, query.order),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.product.count({ where }),
  ]);

  return {
    products: rows.map(toProductDto),
    pagination: buildPagination(query.page, query.limit, total),
  };
}

/** One product with its per-warehouse balances and its total. */
export async function getProduct(
  context: AuthorizationContext,
  productId: string,
): Promise<ProductDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const row = await db.product.findFirst({
    where: { id: productId, organizationId: context.organizationId },
    select: { ...PRODUCT_SELECT, stocks: { select: STOCK_SELECT, orderBy: { quantity: 'desc' } } },
  });

  if (!row) throw new NotFoundError('Product not found.');
  return toProductDto(row);
}

/**
 * Creates a product. Stock is deliberately not part of this operation: an empty
 * product that has never been received is a valid catalogue entry, and the first
 * quantity arrives through a receipt which writes its own movement.
 */
export async function createProduct(
  context: AuthorizationContext,
  input: CreateProductInput,
): Promise<ProductDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_PRODUCT_CREATE);

  const categoryId = await resolveCategory(context, input.categoryId);

  const row = await withDuplicateGuard(
    'sku',
    'That SKU is already used by another product in this organization.',
    () =>
      db.$transaction(async (tx) =>
        tx.product.create({
          data: {
            organizationId: context.organizationId,
            categoryId,
            sku: input.sku,
            name: input.name,
            description: input.description ?? null,
            unitPrice: input.unitPrice,
            costPrice: input.costPrice ?? null,
            reorderThreshold: input.reorderThreshold ?? 0,
            unit: input.unit ?? 'pcs',
          },
          select: { ...PRODUCT_SELECT, stocks: { select: STOCK_SELECT } },
        }),
      ),
  );

  log.info('Product created', {
    organizationId: context.organizationId,
    productId: row.id,
    userId: context.userId,
  });

  return toProductDto(row);
}

export async function updateProduct(
  context: AuthorizationContext,
  productId: string,
  input: UpdateProductInput,
): Promise<ProductDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_PRODUCT_UPDATE);

  const categoryId =
    input.categoryId === undefined ? undefined : await resolveCategory(context, input.categoryId);

  const row = await withDuplicateGuard(
    'sku',
    'That SKU is already used by another product in this organization.',
    () =>
      db.$transaction(async (tx) => {
        const existing = await requireProduct(context, productId, tx);

        const updated = await tx.product.update({
          where: { id: existing.id },
          data: {
            ...(input.sku !== undefined && { sku: input.sku }),
            ...(input.name !== undefined && { name: input.name }),
            ...(input.description !== undefined && { description: input.description }),
            // `undefined` leaves a column untouched, which is what a partial
            // PATCH needs; `null` is an explicit move to "uncategorised".
            ...(categoryId !== undefined && { categoryId }),
            ...(input.unitPrice !== undefined && { unitPrice: input.unitPrice }),
            ...(input.costPrice !== undefined && { costPrice: input.costPrice }),
            ...(input.reorderThreshold !== undefined && {
              reorderThreshold: input.reorderThreshold,
            }),
            ...(input.unit !== undefined && { unit: input.unit }),
          },
          select: { ...PRODUCT_SELECT, stocks: { select: STOCK_SELECT } },
        });

        return updated;
      }),
  );

  log.info('Product updated', {
    organizationId: context.organizationId,
    productId: row.id,
    userId: context.userId,
  });

  return toProductDto(row);
}

/**
 * Archives a product, never deletes it.
 *
 * Order lines and stock movements both reference the product, and a permanent
 * deletion would either break order history or cascade it away. Archiving keeps
 * the row addressable and simply removes it from the active catalogue and from
 * every picker, which is the same bargain the CRM makes for customers.
 */
export async function archiveProduct(
  context: AuthorizationContext,
  productId: string,
): Promise<ProductDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_PRODUCT_ARCHIVE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireProduct(context, productId, tx);

    if (existing.archivedAt) {
      throw new ConflictError('That product is already archived.');
    }

    const updated = await tx.product.update({
      where: { id: existing.id },
      data: { status: ProductStatus.ARCHIVED, archivedAt: new Date() },
      select: { ...PRODUCT_SELECT, stocks: { select: STOCK_SELECT } },
    });

    return updated;
  });

  log.info('Product archived', {
    organizationId: context.organizationId,
    productId: row.id,
    userId: context.userId,
  });

  return toProductDto(row);
}

/** Restores an archived product to the active catalogue. */
export async function restoreProduct(
  context: AuthorizationContext,
  productId: string,
): Promise<ProductDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_PRODUCT_UPDATE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireProduct(context, productId, tx);

    if (!existing.archivedAt) {
      throw new ConflictError('That product is not archived.');
    }

    const updated = await tx.product.update({
      where: { id: existing.id },
      data: { status: ProductStatus.ACTIVE, archivedAt: null },
      select: { ...PRODUCT_SELECT, stocks: { select: STOCK_SELECT } },
    });

    return updated;
  });

  return toProductDto(row);
}

// ---------------------------------------------------------------------------
// Warehouses
// ---------------------------------------------------------------------------

/** Lists warehouses, each with how much it holds. */
export async function listWarehouses(
  context: AuthorizationContext,
  query: WarehouseListQuery,
): Promise<{ warehouses: WarehouseDto[]; pagination: Pagination }> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const where = buildWarehouseWhere(context, query);

  const [rows, total] = await db.$transaction([
    db.warehouse.findMany({
      where,
      select: {
        ...WAREHOUSE_SELECT,
        _count: { select: { stocks: true } },
      },
      orderBy: buildWarehouseOrderBy(query.sort, query.order),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.warehouse.count({ where }),
  ]);

  // The unit totals come from one grouped query rather than a per-warehouse
  // aggregate, so a page of fifty warehouses is still a single round trip.
  const totals = await db.inventoryStock.groupBy({
    by: ['warehouseId'],
    where: { organizationId: context.organizationId },
    _sum: { quantity: true },
  });

  const totalsById = new Map(totals.map((row) => [row.warehouseId, row._sum.quantity ?? 0]));

  return {
    warehouses: rows.map((row) => ({
      ...toWarehouseDto(row),
      productCount: row._count.stocks,
      totalUnits: totalsById.get(row.id) ?? 0,
    })),
    pagination: buildPagination(query.page, query.limit, total),
  };
}

/** One warehouse with the product balances it holds. */
export async function getWarehouse(
  context: AuthorizationContext,
  warehouseId: string,
): Promise<WarehouseDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const row = await db.warehouse.findFirst({
    where: { id: warehouseId, organizationId: context.organizationId },
    select: {
      ...WAREHOUSE_SELECT,
      _count: { select: { stocks: true } },
    },
  });

  if (!row) throw new NotFoundError('Warehouse not found.');

  const sums = await db.inventoryStock.aggregate({
    where: { organizationId: context.organizationId, warehouseId: row.id },
    _sum: { quantity: true },
  });

  return {
    ...toWarehouseDto(row),
    productCount: row._count.stocks,
    totalUnits: sums._sum.quantity ?? 0,
  };
}

export async function createWarehouse(
  context: AuthorizationContext,
  input: CreateWarehouseInput,
): Promise<WarehouseDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  const row = await withDuplicateGuard(
    'code',
    'That warehouse code is already used in this organization.',
    () =>
      db.$transaction(async (tx) => {
        const existing = await tx.warehouse.findFirst({
          where: { organizationId: context.organizationId, archivedAt: null },
          select: { id: true },
        });

        const created = await tx.warehouse.create({
          data: {
            organizationId: context.organizationId,
            code: input.code,
            name: input.name,
            addressLine1: input.addressLine1 ?? null,
            addressLine2: input.addressLine2 ?? null,
            city: input.city ?? null,
            state: input.state ?? null,
            postalCode: input.postalCode ?? null,
            country: input.country ?? null,
            // The first warehouse becomes the primary automatically; after that
            // it is an explicit choice, because it decides where order stock
            // is taken from.
            isPrimary: input.isPrimary ?? existing === null,
          },
          select: WAREHOUSE_SELECT,
        });

        if (created.isPrimary) {
          await setPrimaryWarehouse(tx, context.organizationId, created.id);
        }

        return created;
      }),
  );

  log.info('Warehouse created', {
    organizationId: context.organizationId,
    warehouseId: row.id,
    isPrimary: row.isPrimary,
    userId: context.userId,
  });

  return toWarehouseDto(row);
}

export async function updateWarehouse(
  context: AuthorizationContext,
  warehouseId: string,
  input: UpdateWarehouseInput,
): Promise<WarehouseDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  const row = await withDuplicateGuard(
    'code',
    'That warehouse code is already used in this organization.',
    () =>
      db.$transaction(async (tx) => {
        const existing = await requireWarehouse(context, warehouseId, tx);

        const updated = await tx.warehouse.update({
          where: { id: existing.id },
          data: {
            ...(input.code !== undefined && { code: input.code }),
            ...(input.name !== undefined && { name: input.name }),
            ...(input.addressLine1 !== undefined && { addressLine1: input.addressLine1 }),
            ...(input.addressLine2 !== undefined && { addressLine2: input.addressLine2 }),
            ...(input.city !== undefined && { city: input.city }),
            ...(input.state !== undefined && { state: input.state }),
            ...(input.postalCode !== undefined && { postalCode: input.postalCode }),
            ...(input.country !== undefined && { country: input.country }),
          },
          select: WAREHOUSE_SELECT,
        });

        // Promoting a warehouse demotes whoever held the flag. Demoting the
        // last primary is refused rather than silently leaving the
        // organization with no default source for order deductions.
        if (input.isPrimary !== undefined) {
          if (input.isPrimary) {
            await setPrimaryWarehouse(tx, context.organizationId, updated.id);
            return { ...updated, isPrimary: true };
          }

          if (existing.isPrimary) {
            throw new ValidationError([
              {
                path: 'isPrimary',
                message: 'Promote another warehouse before removing this one as primary.',
              },
            ]);
          }
        }

        return updated;
      }),
  );

  return toWarehouseDto(row);
}

/**
 * Archives a warehouse. Its stock rows and movements are retained, so the ledger
 * still balances against the retained quantities; an archived warehouse simply
 * stops accepting new movements.
 */
export async function archiveWarehouse(
  context: AuthorizationContext,
  warehouseId: string,
): Promise<WarehouseDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireWarehouse(context, warehouseId, tx);

    if (existing.archivedAt) {
      throw new ConflictError('That warehouse is already archived.');
    }

    if (existing.isPrimary) {
      throw new ValidationError([
        {
          path: '(root)',
          message: 'Promote another warehouse to primary before archiving this one.',
        },
      ]);
    }

    const archived = await tx.warehouse.update({
      where: { id: existing.id },
      data: { status: WarehouseStatus.ARCHIVED, archivedAt: new Date(), isPrimary: false },
      select: WAREHOUSE_SELECT,
    });

    return archived;
  });

  log.info('Warehouse archived', {
    organizationId: context.organizationId,
    warehouseId: row.id,
    userId: context.userId,
  });

  return toWarehouseDto(row);
}

/** Restores an archived warehouse. */
export async function restoreWarehouse(
  context: AuthorizationContext,
  warehouseId: string,
): Promise<WarehouseDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireWarehouse(context, warehouseId, tx);

    if (!existing.archivedAt) {
      throw new ConflictError('That warehouse is not archived.');
    }

    const restored = await tx.warehouse.update({
      where: { id: existing.id },
      data: { status: WarehouseStatus.ACTIVE, archivedAt: null },
      select: WAREHOUSE_SELECT,
    });

    return restored;
  });

  return toWarehouseDto(row);
}

/**
 * Real inventory statistics for the dashboard.
 *
 * Every figure comes from the caller's organization: two tenants never see each
 * other's stock or their warehouse count.
 */
export async function getInventoryStats(context: AuthorizationContext): Promise<InventoryStats> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const organizationId = context.organizationId;

  const [totalProducts, totalUnits, warehouses, stockLevels] = await Promise.all([
    db.product.count({ where: { organizationId, archivedAt: null } }),
    db.inventoryStock.aggregate({ where: { organizationId }, _sum: { quantity: true } }),
    db.warehouse.count({ where: { organizationId, archivedAt: null } }),
    countStockLevels(organizationId),
  ]);

  return {
    totalProducts,
    totalStockUnits: totalUnits._sum.quantity ?? 0,
    lowStock: stockLevels.low,
    outOfStock: stockLevels.out,
    warehouses,
  };
}

export type { LowStockProductRow };
