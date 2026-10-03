import 'server-only';

import { MembershipStatus, type Prisma } from '@/generated/prisma/client';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { generateUniqueSlug } from '@/lib/organization-slug';
import { logger } from '@/lib/logger';
import type { RoleKey } from '@/lib/rbac/roles';

const log = logger.child('organizations');

/**
 * Either the root client or an interactive-transaction client. Passing the
 * transaction client keeps multi-step writes (register -> create org -> grant
 * membership) inside a single atomic unit.
 */
type Db = Prisma.TransactionClient | typeof db;

async function requireRoleId(roleKey: RoleKey, client: Db = db): Promise<string> {
  const role = await client.role.findUnique({ where: { key: roleKey }, select: { id: true } });
  if (!role) {
    throw new NotFoundError(
      `Role "${roleKey}" is missing. Run "npm run db:seed" before creating organizations.`,
    );
  }
  return role.id;
}

/**
 * Creates an organization and grants `ownerUserId` the given role.
 *
 * Callers that must also create the user should pass their transaction client
 * via `client` so the whole registration commits or rolls back together.
 */
export async function createOrganizationWithOwner(
  params: { name: string; ownerUserId: string; ownerRoleKey: RoleKey },
  client: Db = db,
): Promise<{ organizationId: string; slug: string }> {
  const roleId = await requireRoleId(params.ownerRoleKey, client);

  const slug = await generateUniqueSlug(params.name, async (candidate) => {
    const existing = await client.organization.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    return existing !== null;
  });

  const organization = await client.organization.create({
    data: { name: params.name, slug },
    select: { id: true, slug: true },
  });

  await client.organizationMembership.create({
    data: {
      userId: params.ownerUserId,
      organizationId: organization.id,
      roleId,
      status: MembershipStatus.ACTIVE,
    },
  });

  log.info('Organization created', {
    organizationId: organization.id,
    ownerUserId: params.ownerUserId,
  });

  return { organizationId: organization.id, slug: organization.slug };
}

/** Adds a user to an organization under a specific role. */
export async function addMembership(params: {
  userId: string;
  organizationId: string;
  roleKey: RoleKey;
}): Promise<void> {
  const roleId = await requireRoleId(params.roleKey);

  const existing = await db.organizationMembership.findUnique({
    where: {
      userId_organizationId: { userId: params.userId, organizationId: params.organizationId },
    },
    select: { id: true },
  });

  if (existing) throw new ConflictError('That user is already a member of this organization.');

  await db.organizationMembership.create({
    data: {
      userId: params.userId,
      organizationId: params.organizationId,
      roleId,
      status: MembershipStatus.ACTIVE,
    },
  });

  log.info('Membership granted', {
    userId: params.userId,
    organizationId: params.organizationId,
    roleKey: params.roleKey,
  });
}

/**
 * Changes a member's role, refusing to demote the last active OWNER so an
 * organization can never be left without an administrator.
 */
export async function changeMembershipRole(params: {
  membershipId: string;
  roleKey: RoleKey;
}): Promise<void> {
  const roleId = await requireRoleId(params.roleKey);

  const membership = await db.organizationMembership.findUnique({
    where: { id: params.membershipId },
    select: { id: true, organizationId: true, role: { select: { key: true } } },
  });
  if (!membership) throw new NotFoundError('Membership not found.');

  if (membership.role.key === 'OWNER' && membership.role.key !== params.roleKey) {
    const activeOwners = await db.organizationMembership.count({
      where: {
        organizationId: membership.organizationId,
        role: { key: 'OWNER' },
        status: MembershipStatus.ACTIVE,
      },
    });
    if (activeOwners <= 1) {
      throw new ConflictError('An organization must always have at least one active owner.');
    }
  }

  await db.organizationMembership.update({
    where: { id: params.membershipId },
    data: { roleId },
  });
}
