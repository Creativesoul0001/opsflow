import Link from 'next/link';

import { TrendPanel } from '@/components/dashboard/trend-panel';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatCount } from '@/lib/customers/presentation';
import { formatMoney } from '@/lib/orders/presentation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getCustomerStats } from '@/lib/services/customer.service';
import { getOrderStats } from '@/lib/services/order.service';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const context = await getAuthorizationContext();

  // Defence in depth: the shell already hides modules the member cannot use,
  // but a direct URL must be rejected by the server too.
  assertPermission(context!, PERMISSIONS.DASHBOARD_READ);

  const firstName = context!.name.split(' ')[0] ?? context!.name;

  // Counts come from Postgres, scoped to this organization by the service. A
  // member without access to a module sees a placeholder rather than a number
  // they are not entitled to.
  const canReadCustomers = hasPermission(context!, PERMISSIONS.CUSTOMERS_READ);
  const stats = canReadCustomers ? await getCustomerStats(context!) : null;

  const canReadOrders = hasPermission(context!, PERMISSIONS.ORDERS_READ);
  const orderStats = canReadOrders ? await getOrderStats(context!) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">Welcome back, {firstName}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          {context!.organizationName} · signed in as {context!.roleName}
        </p>
      </header>

      <section aria-label="Key metrics">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats ? (
            <>
              <StatCard
                label="Total customers"
                description="Everyone in your organization."
                value={formatCount(stats.total)}
                isPlaceholder={false}
              />
              <StatCard
                label="Active customers"
                description="Currently ACTIVE."
                value={formatCount(stats.active)}
                isPlaceholder={false}
              />
              <StatCard
                label="New customers"
                description="Added in the last 30 days."
                value={formatCount(stats.newLast30Days)}
                isPlaceholder={false}
              />
              <StatCard
                label="Archived customers"
                description="Hidden from the default list."
                value={formatCount(stats.archived)}
                isPlaceholder={false}
              />
            </>
          ) : (
            <StatCard label="Customers" description="Requires the customers:read permission." />
          )}

          <StatCard label="Revenue" description="Requires the Finance module." />
          <StatCard label="Open tickets" description="Requires the Support module." />
        </div>
      </section>

      <section aria-label="Orders" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-fg text-lg font-semibold tracking-tight">Orders</h2>
          {orderStats ? (
            <Link href="/orders" className="text-brand hover:text-fg text-sm">
              View all orders
            </Link>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {orderStats ? (
            <>
              <StatCard
                label="Total orders"
                description="Everything your organization has taken."
                value={formatCount(orderStats.total)}
                isPlaceholder={false}
              />
              <StatCard
                label="Pending orders"
                description="Awaiting confirmation."
                value={formatCount(orderStats.pending)}
                isPlaceholder={false}
              />
              <StatCard
                label="Processing orders"
                description="Being fulfilled right now."
                value={formatCount(orderStats.processing)}
                isPlaceholder={false}
              />
              <StatCard
                label="Delivered orders"
                description="Completed and handed over."
                value={formatCount(orderStats.delivered)}
                isPlaceholder={false}
              />
              <StatCard
                label="Cancelled orders"
                description="Called off before delivery."
                value={formatCount(orderStats.cancelled)}
                isPlaceholder={false}
              />
              <StatCard
                label="Order value"
                description="Sum of every order that was not cancelled."
                value={formatMoney(orderStats.revenue)}
                isPlaceholder={false}
              />
            </>
          ) : (
            <StatCard label="Orders" description="Requires the orders:read permission." />
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendPanel />
        </div>

        <Card>
          <CardHeader title="Getting started" description="Phase 3 delivered order management." />
          <CardBody className="space-y-4 text-sm">
            <ul className="text-fg-muted space-y-2.5">
              {[
                'Your account, organization and role are set up.',
                'Customers are searchable, filterable and archived rather than deleted.',
                'Orders carry a number, a workflow, an owner and a full activity trail.',
                'Totals are recalculated on the server, so no figure can be typed in.',
                'Other modules report metrics as each phase ships.',
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className="bg-brand mt-1.5 size-1.5 shrink-0 rounded-full"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
