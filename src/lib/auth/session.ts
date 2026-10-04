import 'server-only';

import { cache } from 'react';

import { auth } from '@/lib/auth/config';
import { AuthenticationError } from '@/lib/api/errors';
import {
  defaultOrganizationId,
  loadAuthorizationContext,
  requireMembership,
} from '@/lib/tenancy';
import type { AuthorizationContext } from '@/lib/rbac/guard';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Returns the authenticated user or `null`.
 *
 * Wrapped in React `cache` so the session cookie is verified once per render
 * pass even when several components ask for it.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth();
  const user = session?.user;

  if (!user?.id || !user.email) return null;

  return { id: user.id, email: user.email, name: user.name ?? user.email };
});

/** Same as `getSessionUser` but throws `AuthenticationError` when signed out. */
export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthenticationError();
  return user;
}

/**
 * The verified authorization context for the current request.
 *
 * Wrapped in `cache` so the layout and the page it renders share one session
 * verification and one membership query instead of issuing duplicates. The
 * data is still read from Postgres on every request — never from the token.
 */
export const getAuthorizationContext = cache(async (): Promise<AuthorizationContext | null> => {
  const user = await getSessionUser();
  if (!user) return null;

  const organizationId = await defaultOrganizationId(user.id);
  return loadAuthorizationContext(user, organizationId);
});

/**
 * The verified authorization context for a JSON endpoint.
 *
 * The tenant is derived from the caller's ACTIVE membership, never from the
 * request body. A client may pass `?organizationId=` to select among the
 * organizations it belongs to, but `requireMembership` re-checks that id against
 * Postgres, so an id for someone else's organization is rejected with 403 instead
 * of switching the request to that tenant.
 */
export async function requireApiContext(request: Request): Promise<AuthorizationContext> {
  const user = await requireSessionUser();

  const requested = new URL(request.url).searchParams.get('organizationId');
  if (requested) {
    const membership = await requireMembership(user, requested);
    return loadAuthorizationContext(user, membership.organizationId);
  }

  const organizationId = await defaultOrganizationId(user.id);
  return loadAuthorizationContext(user, organizationId);
}
