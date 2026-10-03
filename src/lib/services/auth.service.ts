import 'server-only';

import { UserStatus } from '@/generated/prisma/enums';
import { ConflictError } from '@/lib/api/errors';
import { hashPassword } from '@/lib/auth/password';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ROLES } from '@/lib/rbac/roles';
import { createOrganizationWithOwner } from '@/lib/services/organization.service';
import type { RegisterInput } from '@/lib/validation';

const log = logger.child('auth-service');

export interface RegisteredAccount {
  userId: string;
  email: string;
  organizationId: string;
}

/**
 * Creates an account together with its first organization and OWNER
 * membership.
 *
 * Signing up for OpsFlow means standing up a tenant, so the user, organization
 * and membership must all commit or none of them may. That is why this runs in
 * one interactive transaction.
 *
 * The password hash is computed *before* the transaction opens: bcrypt at cost
 * 12 takes a few hundred milliseconds, and holding a pooled Postgres connection
 * open for that long would needlessly shrink the pool.
 */
export async function registerWithOrganization(input: RegisterInput): Promise<RegisteredAccount> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError('That email address cannot be used to create an account.');
  }

  const passwordHash = await hashPassword(input.password);

  const { user, organizationId } = await db.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        status: UserStatus.ACTIVE,
      },
      select: { id: true, email: true },
    });

    const { organizationId: orgId } = await createOrganizationWithOwner(
      { name: input.organizationName, ownerUserId: createdUser.id, ownerRoleKey: ROLES.OWNER },
      tx,
    );

    return { user: createdUser, organizationId: orgId };
  });

  log.info('Registered new account with organization', {
    userId: user.id,
    organizationId,
  });

  return { userId: user.id, email: user.email, organizationId };
}

export interface LoginCandidate {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}

/**
 * Loads the account record for the login flow.
 *
 * Returns `null` for unknown emails, suspended accounts and (via the caller's
 * verification) wrong passwords alike, so the HTTP response never reveals which
 * of the three occurred.
 */
export async function findAccountForLogin(email: string): Promise<LoginCandidate | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, passwordHash: true, status: true },
  });

  if (!user) return null;

  if (user.status !== UserStatus.ACTIVE) {
    log.warn('Login blocked for suspended account', { userId: user.id });
    return null;
  }

  return user;
}
