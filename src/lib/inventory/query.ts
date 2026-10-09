import type { Prisma } from '@/generated/prisma/client';

import type { AuthorizationContext } from '@/lib/rbac/guard';
import type {
  ProductListQuery,
  StockMovementQuery,
  WarehouseListQuery,
} from '@/lib/inventory/validation';

/**
 * Tenant-scoped query construction for the Inventory module.
 *
 * Like its CRM and Orders counterparts this module carries no `server-only`
 * import and no database handle, so the rules that decide *which rows a caller
 * may see* can be unit tested without a live Postgres. It is the highest-risk
 * code in the module: a mistake here would leak one organization's stock to
 * another.
 *
 * `buildProductWhere`, `buildWarehouseWhere` and `buildStockMovementWhere` all
 * start from the verified organization on the authorization context. Callers
 * cannot pass an `organizationId`, so there is no code path in which a
 * client-chosen tenant reaches an inventory query.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Builds the `where` clause for the product list. */
export function buildProductWhere(
  context: AuthorizationContext,
  query: ProductListQuery,
): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {
    // The tenant boundary. Not optional, not overridable.
    organizationId: context.organizationId,
  };

  if (query.status === 'ARCHIVED') {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
  }

  // A malformed category id is ignored rather than used: it can only ever
  // *narrow* a result set that is already pinned to the caller's organization.
  if (query.categoryId && isUuid(query.categoryId)) {
    where.categoryId = query.categoryId;
  } else if (query.categoryId === 'none') {
    where.categoryId = null;
  }

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { sku: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Builds the product `orderBy`, always appending `id` as a tiebreaker so paging
 * cannot show or skip a row when the sort column has duplicate values.
 */
export function buildProductOrderBy(
  sort: ProductListQuery['sort'],
  order: 'asc' | 'desc',
): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
    case 'sku':
    case 'unitPrice':
    case 'updatedAt':
      return [{ [sort]: order }, { id: order }] as Prisma.ProductOrderByWithRelationInput[];
    case 'createdAt':
    default:
      return [{ createdAt: order }, { id: order }];
  }
}

/** Builds the `where` clause for the warehouse list. */
export function buildWarehouseWhere(
  context: AuthorizationContext,
  query: WarehouseListQuery,
): Prisma.WarehouseWhereInput {
  const where: Prisma.WarehouseWhereInput = {
    organizationId: context.organizationId,
    archivedAt: query.status === 'ARCHIVED' ? { not: null } : null,
  };

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
      { city: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

export function buildWarehouseOrderBy(
  sort: WarehouseListQuery['sort'],
  order: 'asc' | 'desc',
): Prisma.WarehouseOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
    case 'code':
      return [{ [sort]: order }, { id: order }] as Prisma.WarehouseOrderByWithRelationInput[];
    case 'createdAt':
    default:
      return [{ createdAt: order }, { id: order }];
  }
}

/**
 * Builds the `where` clause for the stock-movement ledger.
 *
 * The ledger is the audit trail for the whole module, so it is also the place
 * where a tenant leak would be least visible: an outsider seeing another
 * organization's movements learns their suppliers and their order volume. The
 * organization predicate is therefore applied here, and every filter below can
 * only narrow it further.
 */
export function buildStockMovementWhere(
  context: AuthorizationContext,
  query: StockMovementQuery,
): Prisma.StockMovementWhereInput {
  const where: Prisma.StockMovementWhereInput = {
    organizationId: context.organizationId,
  };

  if (query.type && query.type.length > 0) {
    where.type = { in: query.type };
  }

  if (query.productId && isUuid(query.productId)) where.productId = query.productId;
  if (query.warehouseId && isUuid(query.warehouseId)) where.warehouseId = query.warehouseId;
  if (query.orderId && isUuid(query.orderId)) where.orderId = query.orderId;
  if (query.transferId && isUuid(query.transferId)) where.transferId = query.transferId;

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { reason: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
      { product: { sku: { contains: search, mode: 'insensitive' } } },
      { warehouse: { name: { contains: search, mode: 'insensitive' } } },
      { warehouse: { code: { contains: search, mode: 'insensitive' } } },
    ];
  }

  return where;
}

export function buildStockMovementOrderBy(
  sort: StockMovementQuery['sort'],
  order: 'asc' | 'desc',
): Prisma.StockMovementOrderByWithRelationInput[] {
  switch (sort) {
    case 'quantity':
      return [{ quantity: order }, { id: order }] as Prisma.StockMovementOrderByWithRelationInput[];
    case 'createdAt':
    default:
      return [{ createdAt: order }, { id: order }];
  }
}

export { buildPagination, type Pagination } from '@/lib/pagination';
