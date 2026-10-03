import { TrendPanel } from '@/components/dashboard/trend-panel';
import { StatCard } from '@/components/dashboard/stat-card';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { assertPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  const context = await getAuthorizationContext();

  // Defence in depth: the shell already hides modules the member cannot use,
  // but a direct URL must be rejected by the server too.
  assertPermission(context!, PERMISSIONS.DASHBOARD_READ);

  const firstName = context!.name.split(' ')[0] ?? context!.name;

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
          <StatCard label="Revenue" description="Requires the Finance module." />
          <StatCard label="Orders" description="Requires the Orders module." />
          <StatCard label="Customers" description="Requires the Customers module." />
          <StatCard label="Open tickets" description="Requires the Support module." />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TrendPanel />
        </div>

        <Card>
          <CardHeader title="Getting started" description="Phase 1 is the platform foundation." />
          <CardBody className="space-y-4 text-sm">
            <ul className="text-fg-muted space-y-2.5">
              {[
                'Your account, organization and role are set up.',
                'Business metrics appear as each module ships.',
                'Access is scoped to this organization only.',
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
