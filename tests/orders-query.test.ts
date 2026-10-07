import { describe, expect, it } from 'vitest';

import {
  buildOrderAssigneeFilter,
  buildOrderOrderBy,
  buildOrderWhere,
  isOrderSort,
  isUuid,
} from '@/lib/orders/query';
import { coerceOrderListQuery, type OrderListQuery } from '@/lib/orders/validation';
import type { AuthorizationContext } from '@/lib/rbac/guard';

/**
 * Tenant scoping for the order list.
 *
 * `buildOrderWhere` decides which rows a caller may see, so these tests assert
 * the invariant directly: whatever else a query asks for, the `organizationId`
 * predicate is always present and always taken from the verified authorization
 * context — never from the request.
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

function query(overrides: Record<string, unknown> = {}): OrderListQuery {
  return coerceOrderListQuery(overrides);
}

describe('buildOrderWhere tenant boundary', () => {
  it('always scopes to the caller organization, even with no filters', () => {
    expect(buildOrderWhere(contextIn(ORG_A), query())).toEqual({ organizationId: ORG_A });
  });

  it('keeps org A and org B results disjoint no matter what else is filtered', () => {
    const busyQuery = query({
      search: 'a',
      status: 'PENDING,CONFIRMED,PROCESSING,SHIPPED,DELIVERED,CANCELLED',
      assignedTo: 'me',
      customerId: '33333333-3333-4333-8333-333333333333',
    });

    const whereA = buildOrderWhere(contextIn(ORG_A), busyQuery);
    const whereB = buildOrderWhere(contextIn(ORG_B), busyQuery);

    expect(whereA.organizationId).toBe(ORG_A);
    expect(whereB.organizationId).toBe(ORG_B);
    expect(whereA.organizationId).not.toBe(whereB.organizationId);
  });

  it('cannot be overridden by a client-supplied organizationId', () => {
    // The list schema strips unknown keys, so a hostile `organizationId` in the
    // URL never reaches the where clause at all.
    const parsed = coerceOrderListQuery({ organizationId: ORG_B, search: 'ada' });
    expect('organizationId' in parsed).toBe(false);

    const where = buildOrderWhere(contextIn(ORG_A), parsed);
    expect(where.organizationId).toBe(ORG_A);
    expect(JSON.stringify(where)).not.toContain(ORG_B);
  });

  it('scopes an assigned-to-me filter inside the tenant as well', () => {
    const where = buildOrderWhere(contextIn(ORG_A), query({ assignedTo: 'me' }));

    expect(where).toMatchObject({
      organizationId: ORG_A,
      assignedUserId: USER_A,
    });
  });
});

describe('buildOrderWhere filters', () => {
  it('filters by one status or many', () => {
    expect(buildOrderWhere(contextIn(ORG_A), query({ status: 'PENDING' })).status).toEqual({
      in: ['PENDING'],
    });
    expect(
      buildOrderWhere(contextIn(ORG_A), query({ status: 'SHIPPED,DELIVERED' })).status,
    ).toEqual({ in: ['SHIPPED', 'DELIVERED'] });
  });

  it('ignores a malformed customerId instead of sending it to Postgres', () => {
    const where = buildOrderWhere(contextIn(ORG_A), query({ customerId: 'not-a-uuid' }));

    expect(where.customerId).toBeUndefined();
    expect(where.organizationId).toBe(ORG_A);
  });

  it('uses a well-formed customerId as an extra narrowing filter', () => {
    const customerId = '33333333-3333-4333-8333-333333333333';
    expect(buildOrderWhere(contextIn(ORG_A), query({ customerId })).customerId).toBe(customerId);
  });

  it('searches the order number and the customer together, case-insensitively', () => {
    const where = buildOrderWhere(contextIn(ORG_A), query({ search: 'Ada' }));

    expect(where.OR).toEqual([
      { orderNumber: { contains: 'Ada', mode: 'insensitive' } },
      {
        customer: {
          OR: [
            { firstName: { contains: 'Ada', mode: 'insensitive' } },
            { lastName: { contains: 'Ada', mode: 'insensitive' } },
            { email: { contains: 'Ada', mode: 'insensitive' } },
          ],
        },
      },
    ]);
    expect(where.organizationId).toBe(ORG_A);
  });

  it('ignores a blank search rather than matching everything twice', () => {
    expect(buildOrderWhere(contextIn(ORG_A), query({ search: '   ' })).OR).toBeUndefined();
  });
});

describe('buildOrderAssigneeFilter', () => {
  const context = contextIn(ORG_A);

  it('resolves `me` to the caller, never to a client-chosen id', () => {
    expect(buildOrderAssigneeFilter(context, 'me')).toEqual({ assignedUserId: USER_A });
    expect(buildOrderAssigneeFilter(contextIn(ORG_A, USER_B), 'me')).toEqual({
      assignedUserId: USER_B,
    });
  });

  it('resolves `unassigned` to a null assignee', () => {
    expect(buildOrderAssigneeFilter(context, 'unassigned')).toEqual({ assignedUserId: null });
  });

  it('accepts a specific user id as a narrowing filter', () => {
    expect(buildOrderAssigneeFilter(context, USER_B)).toEqual({ assignedUserId: USER_B });
  });

  it('drops anything else rather than trusting it', () => {
    for (const junk of ['', undefined, '   ', 'admin', `${USER_A}-drop`, "'; DROP TABLE orders"]) {
      expect(buildOrderAssigneeFilter(context, junk), String(junk)).toBeUndefined();
    }
  });

  it('never widens a result set past the tenant in any form', () => {
    const where = buildOrderWhere(
      context,
      query({ assignedTo: USER_B, status: 'PENDING,CONFIRMED' }),
    );

    expect(where.organizationId).toBe(ORG_A);
    expect(where.assignedUserId).toBe(USER_B);
  });
});

describe('buildOrderOrderBy', () => {
  it('always appends an id tiebreaker so paging cannot skip a row', () => {
    for (const sort of ['orderNumber', 'createdAt', 'updatedAt', 'total', 'status'] as const) {
      for (const order of ['asc', 'desc'] as const) {
        const clause = buildOrderOrderBy(sort, order);

        expect(clause, sort).toHaveLength(2);
        expect(clause[0]).toEqual({ [sort]: order });
        expect(clause[1]).toHaveProperty('id');
      }
    }
  });

  it('keeps createdAt ordering fully deterministic', () => {
    expect(buildOrderOrderBy('createdAt', 'desc')).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('recognises exactly the sortable columns', () => {
    for (const sort of ['orderNumber', 'createdAt', 'updatedAt', 'total', 'status']) {
      expect(isOrderSort(sort), sort).toBe(true);
    }
    for (const other of ['customerId', 'secret', '', 'organizationId']) {
      expect(isOrderSort(other), other).toBe(false);
    }
  });
});

describe('isUuid', () => {
  it('accepts the ids the API produces', () => {
    expect(isUuid(ORG_A)).toBe(true);
    expect(isUuid('33333333-3333-4333-8333-333333333333')).toBe(true);
  });

  it('matches hex ids case-insensitively, as Postgres does', () => {
    expect(isUuid(ORG_A.toUpperCase())).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['', 'nope', `${ORG_A}-x`, '111111111111411181111111111111111']) {
      expect(isUuid(value), value).toBe(false);
    }
  });
});
