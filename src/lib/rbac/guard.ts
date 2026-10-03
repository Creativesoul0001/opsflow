import { AuthorizationError, AuthenticationError } from '@/lib/api/errors';
import type { Permission } from '@/lib/rbac/permissions';

/**
 * A membership that has already been verified against the database.
 *
 * Nothing in here is read from a client request or trusted from a JWT claim
 * without a database lookup first — see `loadAuthorizationContext`.
 */
export interface AuthorizationContext {
  userId: string;
  email: string;
  name: string;
  organizationId: string;
  organizationName: string;
  roleKey: string;
  roleName: string;
  permissions: ReadonlySet<Permission>;
}

export function hasPermission(context: AuthorizationContext, permission: Permission): boolean {
  return context.permissions.has(permission);
}

export function hasEveryPermission(
  context: AuthorizationContext,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => context.permissions.has(permission));
}

export function hasSomePermission(
  context: AuthorizationContext,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => context.permissions.has(permission));
}

/** Throws `AuthorizationError` unless the permission is granted. */
export function assertPermission(context: AuthorizationContext, permission: Permission): void {
  if (!hasPermission(context, permission)) {
    throw new AuthorizationError(`Your role (${context.roleName}) does not allow this action.`);
  }
}

/** Throws unless the context is bound to the requested organization. */
export function assertOrganization(context: AuthorizationContext, organizationId: string): void {
  if (context.organizationId !== organizationId) {
    throw new AuthorizationError('You do not have access to this organization.');
  }
}

export function assertAuthenticated(user: { id: string } | null | undefined): asserts user {
  if (!user?.id) throw new AuthenticationError();
}
