import { ALL_PERMISSIONS, PERMISSIONS, type Permission } from '@/lib/rbac/permissions';

export const ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
} as const;

export type RoleKey = (typeof ROLES)[keyof typeof ROLES];

export interface RoleDefinition {
  key: RoleKey;
  name: string;
  description: string;
  /** `true` when the role may administer the organization itself. */
  isAdministrative: boolean;
  permissions: readonly Permission[];
}

const { SETTINGS_READ } = PERMISSIONS;
const {
  CUSTOMERS_READ,
  CUSTOMERS_CREATE,
  CUSTOMERS_UPDATE,
  CUSTOMERS_ARCHIVE,
  CUSTOMERS_ASSIGN,
  ORDERS_READ,
  ORDERS_WRITE,
  INVENTORY_READ,
  INVENTORY_WRITE,
  SUPPORT_READ,
  SUPPORT_WRITE,
  MEMBERS_READ,
  ORGANIZATION_DELETE,
  FINANCE_READ,
  AI_USE,
  ANALYTICS_READ,
  DASHBOARD_READ,
} = PERMISSIONS;

/** Everything except permanently deleting the organization. */
const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (permission) => permission !== ORGANIZATION_DELETE,
);

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: ROLES.OWNER,
    name: 'Owner',
    description: 'Full control including permanent organization deletion.',
    isAdministrative: true,
    permissions: ALL_PERMISSIONS,
  },
  {
    key: ROLES.ADMIN,
    name: 'Administrator',
    description: 'Manages members, roles, settings and all business modules.',
    isAdministrative: true,
    permissions: ADMIN_PERMISSIONS,
  },
  {
    key: ROLES.MANAGER,
    name: 'Manager',
    description:
      'Runs day-to-day operations. Can work with customers, orders, inventory and support, but cannot manage members, roles, settings or finance.',
    isAdministrative: false,
    permissions: [
      DASHBOARD_READ,
      CUSTOMERS_READ,
      CUSTOMERS_CREATE,
      CUSTOMERS_UPDATE,
      CUSTOMERS_ARCHIVE,
      CUSTOMERS_ASSIGN,
      ORDERS_READ,
      ORDERS_WRITE,
      INVENTORY_READ,
      INVENTORY_WRITE,
      SUPPORT_READ,
      SUPPORT_WRITE,
      ANALYTICS_READ,
      AI_USE,
      FINANCE_READ,
      MEMBERS_READ,
      SETTINGS_READ,
    ],
  },
  {
    key: ROLES.EMPLOYEE,
    name: 'Employee',
    description:
      'Day-to-day access to customers, orders and support. Can create and edit customers but cannot archive them, reassign them, or touch anything administrative.',
    isAdministrative: false,
    permissions: [
      DASHBOARD_READ,
      CUSTOMERS_READ,
      CUSTOMERS_CREATE,
      CUSTOMERS_UPDATE,
      ORDERS_READ,
      INVENTORY_READ,
      SUPPORT_READ,
      SUPPORT_WRITE,
      AI_USE,
    ],
  },
];

const BY_KEY = new Map<string, RoleDefinition>(ROLE_DEFINITIONS.map((r) => [r.key, r]));

export function isRoleKey(value: string): value is RoleKey {
  return BY_KEY.has(value);
}

export function roleDefinition(key: string): RoleDefinition | undefined {
  return BY_KEY.get(key);
}

export function permissionsForRole(key: string): readonly Permission[] {
  return BY_KEY.get(key)?.permissions ?? [];
}

/** Fallback used when a membership's role is missing or custom. */
export function defaultRolePermissions(): readonly Permission[] {
  return BY_KEY.get(ROLES.EMPLOYEE)?.permissions ?? [];
}
