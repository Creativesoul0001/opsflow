import { PERMISSIONS, type Permission } from '@/lib/rbac/permissions';

/**
 * The application module registry.
 *
 * This is the single source of truth for navigation, page metadata and feature
 * availability. Adding a module in a later phase means flipping its `status`
 * and building its page — the sidebar, breadcrumbs and coming-soon states pick
 * it up automatically.
 *
 * `status: 'planned'` modules render an explicit "coming in a future phase"
 * screen. We never render a partial or mock UI that implies a feature works.
 */
export const MODULES = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    permission: PERMISSIONS.DASHBOARD_READ,
    status: 'available',
    summary: 'At-a-glance view of your organization.',
  },
  {
    key: 'customers',
    label: 'Customers',
    href: '/customers',
    permission: PERMISSIONS.CUSTOMERS_READ,
    status: 'available',
    summary: 'Customer records, segments and contact history.',
  },
  {
    key: 'orders',
    label: 'Orders',
    href: '/orders',
    permission: PERMISSIONS.ORDERS_READ,
    status: 'available',
    summary: 'Order intake, fulfilment status and returns.',
  },
  {
    key: 'inventory',
    label: 'Inventory',
    href: '/inventory',
    permission: PERMISSIONS.INVENTORY_READ,
    status: 'available',
    summary: 'Products, stock levels and warehouses.',
  },
  {
    key: 'support',
    label: 'Support',
    href: '/support',
    permission: PERMISSIONS.SUPPORT_READ,
    status: 'planned',
    phase: 3,
    summary: 'Shared inbox, ticketing and SLA tracking.',
  },
  {
    key: 'finance',
    label: 'Finance',
    href: '/finance',
    permission: PERMISSIONS.FINANCE_READ,
    status: 'planned',
    phase: 4,
    summary: 'Invoices, payments and financial reporting.',
  },
  {
    key: 'automation',
    label: 'Automation',
    href: '/automation',
    permission: PERMISSIONS.AUTOMATION_READ,
    status: 'planned',
    phase: 4,
    summary: 'Trigger-based workflows to remove manual steps.',
  },
  {
    key: 'ai',
    label: 'AI Assistant',
    href: '/ai',
    permission: PERMISSIONS.AI_USE,
    status: 'planned',
    phase: 4,
    summary: 'Natural-language help across your operations data.',
  },
  {
    key: 'analytics',
    label: 'Analytics',
    href: '/analytics',
    permission: PERMISSIONS.ANALYTICS_READ,
    status: 'planned',
    phase: 3,
    summary: 'Custom reports, trends and scheduled exports.',
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    permission: PERMISSIONS.SETTINGS_READ,
    status: 'planned',
    phase: 2,
    summary: 'Organization profile, members, roles and integrations.',
  },
] as const satisfies readonly ModuleDefinition[];

export type ModuleKey = (typeof MODULES)[number]['key'];
export type ModuleStatus = 'available' | 'planned';
export type ModulePhase = 2 | 3 | 4;

export interface ModuleDefinition {
  key: string;
  label: string;
  href: string;
  permission: Permission;
  status: ModuleStatus;
  summary: string;
  phase?: ModulePhase;
}

export function getModule(href: string): ModuleDefinition | undefined {
  return MODULES.find((module) => module.href === href);
}

/** Visible to a member holding `permissions`. */
export function visibleModules(permissions: ReadonlySet<Permission>): ModuleDefinition[] {
  return MODULES.filter((module) => permissions.has(module.permission));
}
