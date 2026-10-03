import { requireSessionUser } from '@/lib/auth/session';
import { AuthorizationError } from '@/lib/api/errors';
import { ok, route } from '@/lib/api/responses';
import { listMemberships, requireMembership } from '@/lib/tenancy';

export const dynamic = 'force-dynamic';

const ORGANIZATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Returns the authenticated user with the organizations they may act in, plus
 * the resolved permissions of the active organization.
 *
 * Requires authentication. The optional `organizationId` query parameter is
 * treated purely as a *request*: it is validated for shape and then checked
 * against a real ACTIVE membership before any data is returned. An unknown or
 * unauthorized id yields 403 rather than silently falling back to a default
 * tenant.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const user = await requireSessionUser();

  const memberships = await listMemberships(user.id);
  const requested = new URL(request.url).searchParams.get('organizationId');

  if (requested !== null && !ORGANIZATION_ID.test(requested)) {
    throw new AuthorizationError('That organization id is not valid.');
  }

  const active = requested ? await requireMembership(user, requested) : memberships[0];

  if (!active) {
    return ok({
      user: { id: user.id, email: user.email, name: user.name },
      organizations: [],
      activeOrganization: null,
      permissions: [] as string[],
    });
  }

  return ok({
    user: { id: user.id, email: user.email, name: user.name },
    organizations: memberships.map((membership) => ({
      id: membership.organizationId,
      name: membership.organizationName,
      roleKey: membership.roleKey,
      roleName: membership.roleName,
    })),
    activeOrganization: {
      id: active.organizationId,
      name: active.organizationName,
      roleKey: active.roleKey,
      roleName: active.roleName,
    },
    permissions: active.permissions,
  });
});
