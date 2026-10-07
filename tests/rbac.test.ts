import { describe, expect, it } from 'vitest';

import { AuthorizationError } from '@/lib/api/errors';
import {
  ALL_PERMISSIONS,
  PERMISSION_CATALOG,
  PERMISSIONS,
  isPermission,
} from '@/lib/rbac/permissions';
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
    expect(isPermission(PERMISSIONS.ORDERS_CREATE)).toBe(true);
    expect(isPermission(PERMISSIONS.ORDERS_UPDATE)).toBe(true);
    expect(isPermission(PERMISSIONS.ORDERS_CANCEL)).toBe(true);
    expect(isPermission(PERMISSIONS.ORDERS_ASSIGN)).toBe(true);
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

  it('restricts EMPLOYEE to read/create/update access outside support', () => {
    const employee = new Set(permissionsForRole(ROLES.EMPLOYEE));
    expect(employee.has(PERMISSIONS.FINANCE_READ)).toBe(false);
    expect(employee.has(PERMISSIONS.CUSTOMERS_READ)).toBe(true);
    expect(employee.has(PERMISSIONS.CUSTOMERS_CREATE)).toBe(true);
    expect(employee.has(PERMISSIONS.CUSTOMERS_UPDATE)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_READ)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_CREATE)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_UPDATE)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_CANCEL)).toBe(false);
    expect(employee.has(PERMISSIONS.ORDERS_ASSIGN)).toBe(false);
  });

  it('marks only OWNER and ADMIN as administrative', () => {
    expect(
      ROLE_DEFINITIONS.filter((r) => r.isAdministrative)
        .map((r) => r.key)
        .sort(),
    ).toEqual(['ADMIN', 'OWNER']);
  });
});

/**
 * Phase 2 replaced the coarse `customers:write` / `customers:delete` pair with
 * per-action permissions so archiving and assigning can be withheld without
 * blocking ordinary editing. These tests pin that split.
 */
describe('customer permission granularity', () => {
  const CUSTOMER_PERMISSIONS = [
    PERMISSIONS.CUSTOMERS_READ,
    PERMISSIONS.CUSTOMERS_CREATE,
    PERMISSIONS.CUSTOMERS_UPDATE,
    PERMISSIONS.CUSTOMERS_ARCHIVE,
    PERMISSIONS.CUSTOMERS_ASSIGN,
  ];

  it('no longer defines the coarse write/delete keys', () => {
    const keys = PERMISSION_CATALOG.map((permission) => permission.key);

    expect(keys).not.toContain('customers:write');
    expect(keys).not.toContain('customers:delete');
  });

  it('defines exactly the five customer permissions', () => {
    const keys = PERMISSION_CATALOG.filter((p) => p.resource === 'customers').map((p) => p.key);

    expect(keys.sort()).toEqual([...CUSTOMER_PERMISSIONS].sort());
  });

  it('gives OWNER, ADMIN and MANAGER every customer permission', () => {
    for (const role of [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER]) {
      const granted = new Set(permissionsForRole(role));

      for (const permission of CUSTOMER_PERMISSIONS) {
        expect(granted.has(permission), `${role} lacks ${permission}`).toBe(true);
      }
    }
  });

  it('lets EMPLOYEE manage customers but not archive or assign them', () => {
    const employee = new Set(permissionsForRole(ROLES.EMPLOYEE));

    expect(employee.has(PERMISSIONS.CUSTOMERS_READ)).toBe(true);
    expect(employee.has(PERMISSIONS.CUSTOMERS_CREATE)).toBe(true);
    expect(employee.has(PERMISSIONS.CUSTOMERS_UPDATE)).toBe(true);
    expect(employee.has(PERMISSIONS.CUSTOMERS_ARCHIVE)).toBe(false);
    expect(employee.has(PERMISSIONS.CUSTOMERS_ASSIGN)).toBe(false);
  });
});

/**
 * Phase 3 replaced the coarse `orders:write` / `orders:delete` pair with
 * per-action permissions so cancelling and assigning an order can be withheld
 * without blocking day-to-day editing.
 */
describe('order permission granularity', () => {
  const ORDER_PERMISSIONS = [
    PERMISSIONS.ORDERS_READ,
    PERMISSIONS.ORDERS_CREATE,
    PERMISSIONS.ORDERS_UPDATE,
    PERMISSIONS.ORDERS_CANCEL,
    PERMISSIONS.ORDERS_ASSIGN,
  ];

  it('no longer defines the coarse write/delete keys', () => {
    const keys = PERMISSION_CATALOG.map((permission) => permission.key);

    expect(keys).not.toContain('orders:write');
    expect(keys).not.toContain('orders:delete');
  });

  it('defines exactly the five order permissions', () => {
    const keys = PERMISSION_CATALOG.filter((p) => p.resource === 'orders').map((p) => p.key);

    expect(keys.sort()).toEqual([...ORDER_PERMISSIONS].sort());
  });

  it('gives OWNER, ADMIN and MANAGER every order permission', () => {
    for (const role of [ROLES.OWNER, ROLES.ADMIN, ROLES.MANAGER]) {
      const granted = new Set(permissionsForRole(role));

      for (const permission of ORDER_PERMISSIONS) {
        expect(granted.has(permission), `${role} lacks ${permission}`).toBe(true);
      }
    }
  });

  it('lets EMPLOYEE manage orders but not cancel or assign them', () => {
    const employee = new Set(permissionsForRole(ROLES.EMPLOYEE));

    expect(employee.has(PERMISSIONS.ORDERS_READ)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_CREATE)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_UPDATE)).toBe(true);
    expect(employee.has(PERMISSIONS.ORDERS_CANCEL)).toBe(false);
    expect(employee.has(PERMISSIONS.ORDERS_ASSIGN)).toBe(false);
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
    expect(hasPermission(manager, PERMISSIONS.ORDERS_UPDATE)).toBe(true);
    expect(hasPermission(manager, PERMISSIONS.SETTINGS_WRITE)).toBe(false);
  });

  it('assertPermission throws only when the permission is absent', () => {
    const owner = contextFor(ROLES.OWNER);
    expect(() => assertPermission(owner, PERMISSIONS.ORGANIZATION_DELETE)).not.toThrow();

    const employee = contextFor(ROLES.EMPLOYEE);
    expect(() => assertPermission(employee, PERMISSIONS.CUSTOMERS_ARCHIVE)).toThrow(
      AuthorizationError,
    );
  });

  it('evaluates every/some combinations correctly', () => {
    const employee = contextFor(ROLES.EMPLOYEE);
    expect(
      hasEveryPermission(employee, [PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.ORDERS_READ]),
    ).toBe(true);
    expect(
      hasEveryPermission(employee, [PERMISSIONS.CUSTOMERS_READ, PERMISSIONS.CUSTOMERS_ARCHIVE]),
    ).toBe(false);
    expect(
      hasSomePermission(employee, [PERMISSIONS.CUSTOMERS_ARCHIVE, PERMISSIONS.CUSTOMERS_READ]),
    ).toBe(true);
    expect(hasSomePermission(employee, [PERMISSIONS.FINANCE_READ])).toBe(false);
  });

  it('never grants permissions for an unknown role', () => {
    const ghost = contextFor('GHOST');
    expect(() => assertPermission(ghost, PERMISSIONS.DASHBOARD_READ)).toThrow(AuthorizationError);
  });
});
