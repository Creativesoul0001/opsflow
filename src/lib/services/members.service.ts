import 'server-only';

import type { Prisma } from '@/generated/prisma/client';
import { ValidationError } from '@/lib/api/errors';
import { db } from '@/lib/db';

/**
 * Shared membership helpers.
 *
 * `users` is a global table, so a foreign key on an `assignedUserId` column
 * would happily accept a user from a different organization. Every module that
 * can attribute work to a person must therefore confirm the target is an ACTIVE
 * member of the caller's organization first — the check lives here so CRM and
 * Orders cannot drift apart or be forgotten in one of them.
 */

export interface AssignableMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string;
  roleKey: string;
}

/**
 * Confirms a user is an ACTIVE member of `organizationId`.
 *
 * @throws {ValidationError} when the user does not exist in this organization.
 * The message is deliberately identical whether the id is unknown entirely or
 * merely belongs to someone else's tenant, so neither case confirms anything
 * about the other organization.
 */
export async function requireActiveMember(
  organizationId: string,
  userId: string,
  path: string = 'assignedUserId',
  client: Prisma.TransactionClient | typeof db = db,
): Promise<{ id: string; name: string }> {
  const membership = await client.organizationMembership.findFirst({
    where: { organizationId, userId, status: 'ACTIVE' },
    select: { user: { select: { id: true, name: true } } },
  });

  if (!membership) {
    throw new ValidationError([
      { path, message: 'That person is not an active member of this organization.' },
    ]);
  }

  return membership.user;
}

/** Active members of one organization, for assignment pickers. */
export async function listActiveMembers(organizationId: string): Promise<AssignableMember[]> {
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true } },
      role: { select: { key: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    roleName: membership.role.name,
    roleKey: membership.role.key,
  }));
}
