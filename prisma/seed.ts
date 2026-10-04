/**
 * Seeds the global RBAC reference data: permissions, then roles with their
 * permission grants.
 *
 * Idempotent — re-running converges the database onto the definitions in
 * `src/lib/rbac` without touching users, organizations or memberships.
 *
 *   npm run db:seed
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PERMISSION_CATALOG } from '../src/lib/rbac/permissions';
import { ROLE_DEFINITIONS } from '../src/lib/rbac/roles';

try {
  process.loadEnvFile();
} catch {
  // No .env present; rely on the ambient environment.
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run the seed script.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

async function main(): Promise<void> {
  console.log('Seeding permissions...');
  for (const permission of PERMISSION_CATALOG) {
    const data = {
      resource: permission.resource,
      action: permission.action,
      description: permission.description,
    };

    await prisma.permission.upsert({
      where: { key: permission.key },
      create: { key: permission.key, ...data },
      update: data,
    });
  }
  console.log(`  ${PERMISSION_CATALOG.length} permissions ensured.`);

  // Prune permissions that left the catalogue. Renaming or splitting a permission
  // (as Phase 2 did for `customers:write` / `customers:delete`) otherwise leaves
  // an orphan row behind forever. Grant rows cascade, so revoking the permission
  // also revokes it from every role.
  //
  // The catalogue is the source of truth for what this build can authorize, so a
  // key that is no longer in it can no longer be granted through any code path.
  const stale = await prisma.permission.deleteMany({
    where: { key: { notIn: PERMISSION_CATALOG.map((permission) => permission.key) } },
  });
  if (stale.count > 0) {
    console.log(`  ${stale.count} obsolete permissions removed.`);
  }

  // Resolve every referenced key to an id in one query instead of N lookups.
  const permissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const idByKey = new Map(permissions.map((p) => [p.key, p.id]));

  console.log('Seeding roles...');
  for (const role of ROLE_DEFINITIONS) {
    const roleRow = await prisma.role.upsert({
      where: { key: role.key },
      create: {
        key: role.key,
        name: role.name,
        description: role.description,
        isSystem: true,
      },
      update: { name: role.name, description: role.description, isSystem: true },
      select: { id: true },
    });

    const permissionIds = role.permissions
      .map((key) => idByKey.get(key))
      .filter((id): id is string => id !== undefined);

    const missing = role.permissions.filter((key) => !idByKey.has(key));
    if (missing.length > 0) {
      throw new Error(`Role ${role.key} references unknown permissions: ${missing.join(', ')}`);
    }

    // Roles are a closed set: reconcile rather than accumulate, so removing a
    // permission from a definition actually revokes it.
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({
        where: { roleId: roleRow.id, permissionId: { notIn: permissionIds } },
      }),
      ...permissionIds.map((permissionId) =>
        prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: roleRow.id, permissionId } },
          create: { roleId: roleRow.id, permissionId },
          update: {},
        }),
      ),
    ]);

    console.log(`  ${role.key}: ${permissionIds.length} permissions granted.`);
  }

  console.log('Seed complete.');
}

main()
  .catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
