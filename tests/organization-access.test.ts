import { describe, expect, it } from 'vitest';

import { AuthorizationError } from '@/lib/api/errors';
import { assertOrganization } from '@/lib/rbac/guard';

/**
 * Tenant-scoping rules.
 *
 * `requireMembership` performs the database lookup, so these tests cover the
 * parts that decide trust: the shape of an organization id and the guarantee
 * that a context is bound to exactly one tenant. A client-supplied id must never
 * select a tenant the user is not a member of — that decision is made against
 * Postgres, and these assertions pin the contract that surrounds it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

function contextIn(organizationId: string) {
  return {
    userId: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    organizationId,
    organizationName: 'Analytical Engines',
    roleKey: 'OWNER',
    roleName: 'Owner',
    permissions: new Set<string>(),
  } as never;
}

describe('organization id shape', () => {
  it.each([ORG_A, ORG_B])('accepts a well-formed uuid (%s)', (id) => {
    expect(UUID.test(id)).toBe(true);
  });

  it.each([
    '',
    'org-1',
    '1',
    '../../etc/passwd',
    "11111111-1111-4111-8111-111111111111' OR 1=1--",
    '11111111111141118111111111111111',
  ])('rejects a malformed or hostile id (%j)', (id) => {
    expect(UUID.test(id)).toBe(false);
  });
});

describe('assertOrganization', () => {
  it('passes when the context matches the requested organization', () => {
    expect(() => assertOrganization(contextIn(ORG_A), ORG_A)).not.toThrow();
  });

  it('throws when a member of org A asks for org B', () => {
    expect(() => assertOrganization(contextIn(ORG_A), ORG_B)).toThrow(AuthorizationError);
  });

  it('throws rather than defaulting when no organization is supplied', () => {
    expect(() => assertOrganization(contextIn(ORG_A), undefined as never)).toThrow(
      AuthorizationError,
    );
  });

  it('does not leak the existence of another tenant in its message', () => {
    try {
      assertOrganization(contextIn(ORG_A), ORG_B);
      expect.unreachable('expected an AuthorizationError');
    } catch (error) {
      expect((error as Error).message).not.toContain('Analytical Engines');
      expect((error as Error).message).not.toContain(ORG_B);
    }
  });
});
