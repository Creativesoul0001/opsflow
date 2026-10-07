import type { Prisma } from '@/generated/prisma/client';
import { CUSTOMER_ASSIGNEE_FILTERS, type CustomerListQuery } from '@/lib/customers/validation';
import type { AuthorizationContext } from '@/lib/rbac/guard';

/**
 * Tenant-scoped query construction for the customer list.
 *
 * This module is deliberately free of `server-only` and of any database import so
 * the rules that decide *which rows a caller may see* can be unit tested without
 * a live Postgres. That is the highest-risk logic in the CRM module: it is the
 * only place where a mistake would leak one organization's customers to
 * another.
 *
 * `buildCustomerWhere` always starts from the verified organization on the
 * authorization context. Callers cannot pass an `organizationId`, so there is no
 * code path in which a client-chosen tenant reaches a customer query.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

export type CustomerSortDirection = 'asc' | 'desc';

/**
 * Resolves the `assignedTo` filter into a concrete assignee predicate.
 *
 * Accepts the literal `me`, the literal `unassigned`, or a user id. Anything
 * else is ignored rather than trusted: a user id is only ever a *filter* here,
 * and the rows it can match are still confined to the caller's organization.
 */
export function buildAssigneeFilter(
  context: AuthorizationContext,
  assignedTo: string | undefined,
): Prisma.CustomerWhereInput | undefined {
  if (!assignedTo) return undefined;

  if ((CUSTOMER_ASSIGNEE_FILTERS as readonly string[]).includes(assignedTo)) {
    return assignedTo === 'me' ? { assignedUserId: context.userId } : { assignedUserId: null };
  }

  return isUuid(assignedTo) ? { assignedUserId: assignedTo } : undefined;
}

/**
 * Builds the `where` clause for `GET /api/customers`.
 *
 * Search is a case-insensitive substring match across name, email and company.
 * It runs in Postgres with `skip`/`take` applied by the caller, so the table is
 * never pulled into memory to be filtered or paginated by the application.
 */
export function buildCustomerWhere(
  context: AuthorizationContext,
  query: CustomerListQuery,
): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {
    // The tenant boundary. Not optional, not overridable.
    organizationId: context.organizationId,
  };

  // Archived customers stay out of the default view.
  if (!query.includeArchived) {
    where.archivedAt = null;
  }

  if (query.status && query.status.length > 0) {
    where.status = { in: query.status };
  }

  if (query.type && query.type.length > 0) {
    where.customerType = { in: query.type };
  }

  const assignee = buildAssigneeFilter(context, query.assignedTo);
  if (assignee) Object.assign(where, assignee);

  const search = query.search?.trim();
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { companyName: { contains: search, mode: 'insensitive' } },
    ];
  }

  return where;
}

/**
 * Builds the `orderBy` clause, always appending `id` as a tiebreaker so paging
 * cannot show or skip a row when the sort column has duplicate values.
 */
export function buildCustomerOrderBy(
  sort: CustomerListQuery['sort'],
  order: CustomerSortDirection,
): Prisma.CustomerOrderByWithRelationInput[] {
  switch (sort) {
    case 'name':
      return [
        { lastName: order },
        { firstName: order },
        { id: order },
      ] satisfies Prisma.CustomerOrderByWithRelationInput[];
    case 'updatedAt':
    case 'status':
      return [{ [sort]: order }, { id: 'desc' }] as Prisma.CustomerOrderByWithRelationInput[];
    case 'createdAt':
    default:
      return [
        { createdAt: order },
        { id: order },
      ] satisfies Prisma.CustomerOrderByWithRelationInput[];
  }
}

/** `true` when sorting by a column, so the UI can flip the indicator. */
export function isCustomerSort(value: string): value is CustomerListQuery['sort'] {
  return ['name', 'createdAt', 'updatedAt', 'status'].includes(value);
}

// Pagination lives in its own module so Orders and later modules share one
// definition. Re-exported here to keep the existing import path stable.
export { buildPagination, type Pagination } from '@/lib/pagination';
