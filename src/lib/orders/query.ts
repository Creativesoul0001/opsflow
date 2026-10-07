import type { Prisma } from '@/generated/prisma/client';
import { ORDER_ASSIGNEE_FILTERS, type OrderListQuery } from '@/lib/orders/validation';
import type { AuthorizationContext } from '@/lib/rbac/guard';

/**
 * Tenant-scoped query construction for the order list.
 *
 * Like its CRM counterpart this module carries no `server-only` import and no
 * database handle, so the rules that decide *which rows a caller may see* can be
 * unit tested without a live Postgres. It is the highest-risk logic in the
 * Orders module: a mistake here would leak one organization's orders to another.
 *
 * `buildOrderWhere` always starts from the verified organization on the
 * authorization context. Callers cannot pass an `organizationId`, so there is no
 * code path in which a client-chosen tenant reaches an order query.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export type OrderSortDirection = 'asc' | 'desc';

/**
 * Resolves the `assignedTo` filter into a concrete assignee predicate.
 *
 * Accepts the literal `me`, the literal `unassigned`, or a user id. Anything
 * else is ignored rather than trusted: a user id is only ever a *filter* here,
 * and the rows it can match are still confined to the caller's organization.
 */
export function buildOrderAssigneeFilter(
  context: AuthorizationContext,
  assignedTo: string | undefined,
): Prisma.OrderWhereInput | undefined {
  if (!assignedTo) return undefined;

  if ((ORDER_ASSIGNEE_FILTERS as readonly string[]).includes(assignedTo)) {
    return assignedTo === 'me' ? { assignedUserId: context.userId } : { assignedUserId: null };
  }

  return isUuid(assignedTo) ? { assignedUserId: assignedTo } : undefined;
}

/**
 * Builds the `where` clause for `GET /api/orders`.
 *
 * Search runs in Postgres across the order number and the customer's name and
 * email, with `skip`/`take` applied by the caller, so the table is never pulled
 * into memory to be filtered or paginated by the application.
 *
 * A malformed `customerId` is ignored rather than used: it can only ever
 * *narrow* a result set that is already pinned to the caller's organization, and
 * an unparseable UUID would otherwise be handed straight to Postgres.
 */
export function buildOrderWhere(
  context: AuthorizationContext,
  query: OrderListQuery,
): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {
    // The tenant boundary. Not optional, not overridable.
    organizationId: context.organizationId,
  };

  if (query.status && query.status.length > 0) {
    where.status = { in: query.status };
  }

  if (query.customerId && isUuid(query.customerId)) {
    where.customerId = query.customerId;
  }

  const assignee = buildOrderAssigneeFilter(context, query.assignedTo);
  if (assignee) Object.assign(where, assignee);

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      {
        customer: {
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
    ];
  }

  return where;
}

/**
 * Builds the `orderBy` clause, always appending `id` as a tiebreaker so paging
 * cannot show or skip a row when the sort column has duplicate values.
 *
 * `orderNumber` sorts lexicographically, which matches numeric order because the
 * allocator pads to six digits (`ORD-000001`).
 */
export function buildOrderOrderBy(
  sort: OrderListQuery['sort'],
  order: OrderSortDirection,
): Prisma.OrderOrderByWithRelationInput[] {
  switch (sort) {
    case 'orderNumber':
    case 'total':
    case 'status':
    case 'updatedAt':
      return [{ [sort]: order }, { id: 'desc' }] as Prisma.OrderOrderByWithRelationInput[];
    case 'createdAt':
    default:
      return [{ createdAt: order }, { id: order }] satisfies Prisma.OrderOrderByWithRelationInput[];
  }
}

/** `true` when sorting by a column, so the UI can flip the indicator. */
export function isOrderSort(value: string): value is OrderListQuery['sort'] {
  return ['orderNumber', 'createdAt', 'updatedAt', 'total', 'status'].includes(value);
}

export { buildPagination, type Pagination } from '@/lib/pagination';
