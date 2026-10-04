import { describe, expect, it } from 'vitest';

import {
  buildAssigneeFilter,
  buildCustomerOrderBy,
  buildCustomerWhere,
  buildPagination,
} from '@/lib/customers/query';
import { coerceCustomerListQuery, type CustomerListQuery } from '@/lib/customers/validation';
import type { AuthorizationContext } from '@/lib/rbac/guard';

/**
 * Tenant scoping for the customer list.
 *
 * `buildCustomerWhere` is the single place that decides which customer rows a
 * caller may see, so these tests assert the invariant directly: whatever else a
 * query asks for, the `organizationId` predicate is always present and always
 * the one on the verified authorization context.
 */

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';
const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function contextIn(organizationId: string, userId = USER_A) {
  return {
    userId,
    email: 'ada@example.com',
    name: 'Ada',
    organizationId,
    organizationName: 'Analytical Engines',
    roleKey: 'OWNER',
    roleName: 'Owner',
    permissions: new Set<string>(),
  } as AuthorizationContext;
}

function query(overrides: Record<string, unknown> = {}): CustomerListQuery {
  return coerceCustomerListQuery(overrides);
}

describe('buildCustomerWhere tenant boundary', () => {
  it('always scopes to the caller organization, even with no filters', () => {
    expect(buildCustomerWhere(contextIn(ORG_A), query())).toMatchObject({
      organizationId: ORG_A,
      archivedAt: null,
    });
  });

  it('keeps org A and org B results disjoint no matter what else is filtered', () => {
    const busyQuery = query({
      search: 'a',
      status: 'ACTIVE,LEAD,INACTIVE',
      type: 'INDIVIDUAL,BUSINESS',
      assignedTo: 'me',
      includeArchived: true,
    });

    const whereA = buildCustomerWhere(contextIn(ORG_A), busyQuery);
    const whereB = buildCustomerWhere(contextIn(ORG_B), busyQuery);

    expect(whereA.organizationId).toBe(ORG_A);
    expect(whereB.organizationId).toBe(ORG_B);
    expect(whereA.organizationId).not.toBe(whereB.organizationId);
  });

  it('cannot be overridden by a client-supplied organizationId', () => {
    // The list query schema strips unknown keys, so a hostile `organizationId`
    // in the URL cannot reach the where clause at all.
    const hostile = query({ organizationId: ORG_B, archivedAt: null });
    const where = buildCustomerWhere(contextIn(ORG_A), hostile);

    expect(where.organizationId).toBe(ORG_A);
  });
});

describe('buildCustomerWhere archived handling', () => {
  it('hides archived customers by default', () => {
    expect(buildCustomerWhere(contextIn(ORG_A), query()).archivedAt).toBeNull();
  });

  it('includes them when explicitly requested', () => {
    expect(
      buildCustomerWhere(contextIn(ORG_A), query({ includeArchived: true })).archivedAt,
    ).toBeUndefined();
  });
});

describe('buildCustomerWhere search', () => {
  it('matches name, email and company case-insensitively in the database', () => {
    const where = buildCustomerWhere(contextIn(ORG_A), query({ search: 'lovel' }));

    expect(where.OR).toEqual([
      { firstName: { contains: 'lovel', mode: 'insensitive' } },
      { lastName: { contains: 'lovel', mode: 'insensitive' } },
      { email: { contains: 'lovel', mode: 'insensitive' } },
      { companyName: { contains: 'lovel', mode: 'insensitive' } },
    ]);
  });

  it('does not add a search clause for a whitespace-only term', () => {
    expect(buildCustomerWhere(contextIn(ORG_A), query({ search: '   ' })).OR).toBeUndefined();
  });
});

describe('buildAssigneeFilter', () => {
  it('maps "me" to the calling user', () => {
    expect(buildAssigneeFilter(contextIn(ORG_A), 'me')).toEqual({ assignedUserId: USER_A });
  });

  it('maps "unassigned" to a null assignee', () => {
    expect(buildAssigneeFilter(contextIn(ORG_A), 'unassigned')).toEqual({ assignedUserId: null });
  });

  it('accepts a uuid as a plain assignee filter', () => {
    expect(buildAssigneeFilter(contextIn(ORG_A), USER_B)).toEqual({ assignedUserId: USER_B });
  });

  it('ignores a value that is neither a keyword nor a uuid', () => {
    expect(buildAssigneeFilter(contextIn(ORG_A), 'user-1')).toBeUndefined();
    expect(buildAssigneeFilter(contextIn(ORG_A), undefined)).toBeUndefined();
  });

  it('treats an assignee id as a filter only, never as a tenant selector', () => {
    const where = buildCustomerWhere(contextIn(ORG_A), query({ assignedTo: USER_B }));

    // Filtering by another user still cannot widen the tenant.
    expect(where.organizationId).toBe(ORG_A);
    expect(where.assignedUserId).toBe(USER_B);
  });
});

describe('buildCustomerOrderBy', () => {
  it('sorts by name across last then first name', () => {
    expect(buildCustomerOrderBy('name', 'asc')).toEqual([
      { lastName: 'asc' },
      { firstName: 'asc' },
      { id: 'asc' },
    ]);
  });

  it('always appends a tiebreaker so paging cannot duplicate a row', () => {
    for (const sort of ['createdAt', 'updatedAt', 'status', 'name'] as const) {
      const order = buildCustomerOrderBy(sort, 'desc');

      expect(order.at(-1)).toHaveProperty('id');
    }
  });

  it('falls back to createdAt for an unrecognised sort', () => {
    expect(buildCustomerOrderBy('password' as never, 'desc')).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
  });
});

describe('buildPagination', () => {
  it('reports the first page of many', () => {
    expect(buildPagination(1, 20, 45)).toEqual({
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: false,
    });
  });

  it('reports the last page of many', () => {
    expect(buildPagination(3, 20, 45)).toMatchObject({
      hasNextPage: false,
      hasPreviousPage: true,
    });
  });

  it('handles an exact multiple without an empty trailing page', () => {
    expect(buildPagination(2, 20, 40)).toMatchObject({ totalPages: 2, hasNextPage: false });
  });

  it('handles an empty result set', () => {
    expect(buildPagination(1, 20, 0)).toEqual({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  });
});