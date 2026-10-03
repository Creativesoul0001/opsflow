import 'server-only';

import { AuthorizationError, NotFoundError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { isPermission, type Permission } from '@/lib/rbac/permissions';
import type { AuthorizationContext } from '@/lib/rbac/guard';

const log = logger.child('tenancy');

const MEMBERSHIP_SELECT = {
  id: true,
  status: true,
  organization: { select: { id: true, name: true } },
  role: {
    select: {
      key: true,
      name: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
  },
} as const;

export interface Membership {
  id: string;
  status: string;
  organizationId: string;
  organizationName: string;
  roleKey: string;
  roleName: string;
  permissions: readonly Permission[];
}

/**
 * Loads every organization the user may act in. The user id always comes from
 * the verified session, never from a request body or query parameter.
 */
export async function listMemberships(userId: string): Promise<readonly Membership[]> {
  const rows = await db.organizationMembership.findMany({
    where: { userId, status: 'ACTIVE' },
    select: MEMBERSHIP_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  return rows.map(toMembership);
}

export async function getMembership(
  userId: string,
  organizationId: string,
): Promise<Membership | null> {
  const row = await db.organizationMembership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
    select: MEMBERSHIP_SELECT,
  });
  return row ? toMembership(row) : null;
}

/**
 * Resolves an organization id supplied by a client into a verified membership.
 *
 * This is the single trust boundary for tenant scoping. A caller may pass any
 * organization id; if the authenticated user has no ACTIVE membership it throws
 * rather than falling back to a default tenant, so a missing or stale
 * `organizationId` can never leak another organization's data.
 */
export async function requireMembership(
  user: { id: string; email?: string; name?: string },
  organizationId: string | null | undefined,
): Promise<Membership> {
  if (!organizationId) {
    throw new AuthorizationError('An organization must be selected.');
  }

  const membership = await getMembership(user.id, organizationId);
  if (!membership) {
    log.warn('Rejected cross-tenant organization access', {
      userId: user.id,
      requestedOrganizationId: organizationId,
    });
    throw new AuthorizationError('You do not have access to this organization.');
  }

  if (membership.status !== 'ACTIVE') {
    throw new AuthorizationError('Your access to this organization is not active.');
  }

  return membership;
}

/**
 * Builds a full authorization context for a verified user + organization pair.
 * Permissions come from the database role, never from the session token.
 */
export async function loadAuthorizationContext(
  user: { id: string; email: string; name: string },
  organizationId: string,
): Promise<AuthorizationContext> {
  const membership = await requireMembership(user, organizationId);

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    organizationId: membership.organizationId,
    organizationName: membership.organizationName,
    roleKey: membership.roleKey,
    roleName: membership.roleName,
    permissions: new Set(membership.permissions),
  };
}

/** Picks the tenant to use when a client did not specify one. */
export async function defaultOrganizationId(userId: string): Promise<string> {
  const [membership] = await listMemberships(userId);
  if (!membership) throw new NotFoundError('You are not a member of any organization.');
  return membership.organizationId;
}

function toMembership(row: {
  id: string;
  status: string;
  organization: { id: string; name: string };
  role: {
    key: string;
    name: string;
    permissions: { permission: { key: string } }[];
  };
}): Membership {
  return {
    id: row.id,
    status: row.status,
    organizationId: row.organization.id,
    organizationName: row.organization.name,
    roleKey: row.role.key,
    roleName: row.role.name,
    permissions: row.role.permissions.map(({ permission }) => permission.key).filter(isPermission),
  };
}
