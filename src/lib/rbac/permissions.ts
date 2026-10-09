/**
 * Canonical permission keys.
 *
 * Permissions are declared here as the single source of truth and seeded into
 * the `permissions` table by `prisma/seed.ts`. A role resolves to a set of
 * these keys, and the backend checks keys — never role names — so role
 * assignments can change without touching feature code.
 *
 * Phase 1 shipped the full vocabulary for the planned modules, so building a
 * module in a later phase is mostly a matter of granting existing keys. Phase 2
 * (CRM) refined `customers` from a coarse read/write/delete trio into
 * `read`/`create`/`update`/`archive`/`assign` so archiving and assignment can be
 * withheld independently of ordinary editing, and Phase 4 (Inventory) did the
 * same thing for stock: a member who may correct a quantity is not necessarily
 * one who may move it between warehouses.
 */
export const PERMISSIONS = {
  DASHBOARD_READ: 'dashboard:read',

  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_CREATE: 'customers:create',
  CUSTOMERS_UPDATE: 'customers:update',
  CUSTOMERS_ARCHIVE: 'customers:archive',
  CUSTOMERS_ASSIGN: 'customers:assign',

  ORDERS_READ: 'orders:read',
  ORDERS_CREATE: 'orders:create',
  ORDERS_UPDATE: 'orders:update',
  ORDERS_CANCEL: 'orders:cancel',
  ORDERS_ASSIGN: 'orders:assign',

  INVENTORY_READ: 'inventory:read',
  INVENTORY_PRODUCT_CREATE: 'inventory:product:create',
  INVENTORY_PRODUCT_UPDATE: 'inventory:product:update',
  INVENTORY_PRODUCT_ARCHIVE: 'inventory:product:archive',
  INVENTORY_CATEGORY_MANAGE: 'inventory:category:manage',
  INVENTORY_WAREHOUSE_MANAGE: 'inventory:warehouse:manage',
  INVENTORY_STOCK_ADJUST: 'inventory:stock:adjust',
  INVENTORY_STOCK_TRANSFER: 'inventory:stock:transfer',

  SUPPORT_READ: 'support:read',
  SUPPORT_WRITE: 'support:write',

  FINANCE_READ: 'finance:read',
  FINANCE_WRITE: 'finance:write',

  AUTOMATION_READ: 'automation:read',
  AUTOMATION_WRITE: 'automation:write',

  AI_USE: 'ai:use',

  ANALYTICS_READ: 'analytics:read',

  MEMBERS_READ: 'members:read',
  MEMBERS_WRITE: 'members:write',
  MEMBERS_DELETE: 'members:delete',

  ROLES_READ: 'roles:read',
  ROLES_WRITE: 'roles:write',

  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',

  ORGANIZATION_DELETE: 'organization:delete',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Human-readable catalogue used to seed the `permissions` table. */
export const PERMISSION_CATALOG: readonly {
  key: Permission;
  resource: string;
  action: string;
  description: string;
}[] = [
  {
    key: PERMISSIONS.DASHBOARD_READ,
    resource: 'dashboard',
    action: 'read',
    description: 'View the organization dashboard',
  },

  {
    key: PERMISSIONS.CUSTOMERS_READ,
    resource: 'customers',
    action: 'read',
    description: 'View customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_CREATE,
    resource: 'customers',
    action: 'create',
    description: 'Create customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_UPDATE,
    resource: 'customers',
    action: 'update',
    description: 'Update customer information',
  },
  {
    key: PERMISSIONS.CUSTOMERS_ARCHIVE,
    resource: 'customers',
    action: 'archive',
    description: 'Archive customers',
  },
  {
    key: PERMISSIONS.CUSTOMERS_ASSIGN,
    resource: 'customers',
    action: 'assign',
    description: 'Assign customers to a team member',
  },

  {
    key: PERMISSIONS.ORDERS_READ,
    resource: 'orders',
    action: 'read',
    description: 'View orders',
  },
  {
    key: PERMISSIONS.ORDERS_CREATE,
    resource: 'orders',
    action: 'create',
    description: 'Create orders',
  },
  {
    key: PERMISSIONS.ORDERS_UPDATE,
    resource: 'orders',
    action: 'update',
    description: 'Update order details and status',
  },
  {
    key: PERMISSIONS.ORDERS_CANCEL,
    resource: 'orders',
    action: 'cancel',
    description: 'Cancel orders',
  },
  {
    key: PERMISSIONS.ORDERS_ASSIGN,
    resource: 'orders',
    action: 'assign',
    description: 'Assign orders to members',
  },

  {
    key: PERMISSIONS.INVENTORY_READ,
    resource: 'inventory',
    action: 'read',
    description: 'View products, stock levels, warehouses and stock movements',
  },
  {
    key: PERMISSIONS.INVENTORY_PRODUCT_CREATE,
    resource: 'inventory',
    action: 'product:create',
    description: 'Create products and categories',
  },
  {
    key: PERMISSIONS.INVENTORY_PRODUCT_UPDATE,
    resource: 'inventory',
    action: 'product:update',
    description: 'Edit products and categories',
  },
  {
    key: PERMISSIONS.INVENTORY_PRODUCT_ARCHIVE,
    resource: 'inventory',
    action: 'product:archive',
    description: 'Archive products and categories',
  },
  {
    key: PERMISSIONS.INVENTORY_CATEGORY_MANAGE,
    resource: 'inventory',
    action: 'category:manage',
    description: 'Create, rename and archive product categories',
  },
  {
    key: PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE,
    resource: 'inventory',
    action: 'warehouse:manage',
    description: 'Create, edit and archive warehouses',
  },
  {
    key: PERMISSIONS.INVENTORY_STOCK_ADJUST,
    resource: 'inventory',
    action: 'stock:adjust',
    description: 'Record receipts and stock adjustments',
  },
  {
    key: PERMISSIONS.INVENTORY_STOCK_TRANSFER,
    resource: 'inventory',
    action: 'stock:transfer',
    description: 'Move stock between warehouses',
  },

  {
    key: PERMISSIONS.SUPPORT_READ,
    resource: 'support',
    action: 'read',
    description: 'View support tickets',
  },
  {
    key: PERMISSIONS.SUPPORT_WRITE,
    resource: 'support',
    action: 'write',
    description: 'Respond to and update support tickets',
  },

  {
    key: PERMISSIONS.FINANCE_READ,
    resource: 'finance',
    action: 'read',
    description: 'View financial records',
  },
  {
    key: PERMISSIONS.FINANCE_WRITE,
    resource: 'finance',
    action: 'write',
    description: 'Manage financial records',
  },

  {
    key: PERMISSIONS.AUTOMATION_READ,
    resource: 'automation',
    action: 'read',
    description: 'View automation workflows',
  },
  {
    key: PERMISSIONS.AUTOMATION_WRITE,
    resource: 'automation',
    action: 'write',
    description: 'Create and edit automation workflows',
  },

  { key: PERMISSIONS.AI_USE, resource: 'ai', action: 'use', description: 'Use the AI assistant' },

  {
    key: PERMISSIONS.ANALYTICS_READ,
    resource: 'analytics',
    action: 'read',
    description: 'View analytics and reports',
  },

  {
    key: PERMISSIONS.MEMBERS_READ,
    resource: 'members',
    action: 'read',
    description: 'View organization members',
  },
  {
    key: PERMISSIONS.MEMBERS_WRITE,
    resource: 'members',
    action: 'write',
    description: 'Invite and update organization members',
  },
  {
    key: PERMISSIONS.MEMBERS_DELETE,
    resource: 'members',
    action: 'delete',
    description: 'Remove organization members',
  },

  {
    key: PERMISSIONS.ROLES_READ,
    resource: 'roles',
    action: 'read',
    description: 'View roles and permissions',
  },
  {
    key: PERMISSIONS.ROLES_WRITE,
    resource: 'roles',
    action: 'write',
    description: 'Change role assignments',
  },

  {
    key: PERMISSIONS.SETTINGS_READ,
    resource: 'settings',
    action: 'read',
    description: 'View organization settings',
  },
  {
    key: PERMISSIONS.SETTINGS_WRITE,
    resource: 'settings',
    action: 'write',
    description: 'Change organization settings',
  },

  {
    key: PERMISSIONS.ORGANIZATION_DELETE,
    resource: 'organization',
    action: 'delete',
    description: 'Permanently delete the organization',
  },
] as const;

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_CATALOG.map((p) => p.key);

export function isPermission(value: string): value is Permission {
  return (ALL_PERMISSIONS as readonly string[]).includes(value);
}
