import { describe, expect, it } from 'vitest';

import { AuthorizationError } from '@/lib/api/errors';
import { ALL_PERMISSIONS, PERMISSIONS, isPermission } from '@/lib/rbac/permissions';
import {
  ROLE_DEFINITIONS,
  ROLES,
  isRoleKey,
  permissionsForRole,
  roleDefinition,
} from '@/lib/rbac/roles';
import {
  assertPermission,
  hasEveryPermission,
  hasPermission,
  hasSomePermission,
  type AuthorizationContext,
} from '@/lib/rbac/guard';

function contextFor(roleKey: string): AuthorizationContext {
  return {
    userId: 'user-1',
    email: 'ada@example.com',
    name: 'Ada',
    organizationId: 'org-1',
    organizationName: 'Analytical Engines',
    roleKey,
    roleName: roleDefinition(roleKey)?.name ?? roleKey,
    permissions: new Set(permissionsForRole(roleKey)),
  };
}

describe('permission catalogue', () => {
  it('uses unique resource:action keys', () => {
    const keys = ALL_PERMISSIONS;
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('recognises catalogue members and rejects anything else', () => {
    expect(isPermission(PERMISSIONS.ORDERS_WRITE)).toBe(true);
    expect(isPermission('orders:teleport')).toBe(false);
  });
});

describe('role definitions', () => {
  it('declares exactly the four Phase 1 roles', () => {
    expect(Object.values(ROLES).sort()).toEqual(['ADMIN', 'EMPLOYEE', 'MANAGER', 'OWNER']);
  });

  it('only ever references permissions that exist in the catalogue', () => {
    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(isPermission(permission), `${role.key} -> ${permission}`).toBe(true);
      }
    }
  });

  it('gives every role the dashboard read permission so the app is usable', () => {
    for (const role of ROLE_DEFINITIONS) {
      expect(role.permissions, role.key).toContain(PERMISSIONS.DASHBOARD_READ);
    }
  });
});

describe('privilege hierarchy', () => {
  it('grants OWNER every permission', () => {
    expect(new Set(permissionsForRole(ROLES.OWNER))).toEqual(new Set(ALL_PERMISSIONS));
  });

  it('reserves organization deletion for OWNER alone', () => {
    const holders = ROLE_DEFINITIONS.filter((role) =>
      role.permissions.includes(PERMISSIONS.ORGANIZATION_DELETE),
    ).map((role) => role.key);
    expect(holders).toEqual([ROLES.OWNER]);
  });

  it('keeps ADMIN strictly below OWNER', () => {
    const owner = new Set(permissionsForRole(ROLES.OWNER));
    const admin = new Set(permissionsForRole(ROLES.ADMIN));
    expect(owner.size).toBeGreaterThan(admin.size);
    expect(admin.has(PERMISSIONS.ORGANIZATION_DELETE)).toBe(false);
    expect(admin.has(PERMISSIONS.ROLES_WRITE)).toBe(true);
  });

  it('keeps MANAGER below ADMIN', () => {
    const manager = new Set(permissionsForRole(ROLES.MANAGER));
    const admin = new Set(permissionsForRole(ROLES.ADMIN));
    for (const permission of manager) {
      expect(admin.has(permission), `MANAGER has ${permission} that ADMIN lacks`).toBe(true);
    }
    expect(manager.has(PERMISSIONS.FINANCE_WRITE)).toBe(false);
    expect(manager.has(PERMISSIONS.MEMBERS_WRITE)).toBe(false);
    expect(manager.has(PERMISSIONS.SETTINGS_WRITE)).toBe(false);
  });

  it('restricts EMPLOYEE to read-only access outside support', () => {
    const employee = new Set(permissionsForRole(ROLES.EMPLOYEE));
    expect(employee.has(PERMISSIONS.CUSTOMERS_WRITE)).toBe(false);
    expect(employee.has(PERMISSIONS.ORDERS_WRITE)).toBe(false);
    expect(employee.has(PERMISSIONS.FINANCE_READ)).toBe(false);
    expect(employee.has(PERMISSIONS.CUSTOMERS_READ)).toBe(true);
  });

  it('marks only OWNER and ADMIN as administrative', () => {
    expect(
      ROLE_DEFINITIONS.filter((r) => r.isAdministrative)
        .map((r) => r.key)
        .sort(),
    ).toEqual(['ADMIN', 'OWNER']);
  });
});

describe('permission guards', () => {
  it('recognises known role keys', () => {
    expect(isRoleKey('OWNER')).toBe(true);
    expect(isRoleKey('SUPERUSER')).toBe(false);
  });

  it('returns an empty grant for an unknown role rather than defaulting wide', () => {
    expect(permissionsForRole('GHOST')).toEqual([]);
  });

  it('allows a permitted action and denies a forbidden one', () => {
    const manager = contextFor(ROLES.MANAGER);
    expect(hasPermission(manager, PERMISSIONS.ORDERS_WRITE)).toBe(true);
    expect(hasPermission(manager, PERMISSIONS.SETTINGS_WRITE)).toBe(false);
  });

  it('assertPermission throws only when the permission is absent', () => {
    const owner = contextFor(ROLES.OWNER);
    expect(() => assertPermission(owner, PERMISSIONS.ORGANIZATION_DELETE)).not.toThrow();

    const employee = contextFor(ROLES.EMPLOYEE);
    expect(() => assertPermission(employee, PERMISSIONS.CUSTOMERS_DELETE)).toThrow(
      AuthorizationError,
    );
  });

  it('evaluates every/some combinations correctly', () => {
    const employee = contextFor(ROLES.EMPLOYEE);
    expect(
      hasEveryPermission(employee, [PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.ORDERS_READ]),
    ).toBe(true);
    expect(
      hasEveryPermission(employee, [PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.CUSTOMERS_WRITE]),
    ).toBe(false);
    expect(
      hasSomePermission(employee, [PERMISSIONS.CUSTOMERS_WRITE, PERMISSIONS.CUSTOMERS_READ]),
    ).toBe(true);
    expect(hasSomePermission(employee, [PERMISSIONS.FINANCE_READ])).toBe(false);
  });

  it('never grants permissions for an unknown role', () => {
    const ghost = contextFor('GHOST');
    expect(() => assertPermission(ghost, PERMISSIONS.DASHBOARD_READ)).toThrow(AuthorizationError);
  });
});
