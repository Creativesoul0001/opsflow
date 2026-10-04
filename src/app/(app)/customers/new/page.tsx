import Link from 'next/link';

import { CustomerForm } from '@/components/customers/customer-form';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listAssignableMembers } from '@/lib/services/customer.service';

export const metadata = { title: 'New customer' };

/**
 * `GET /customers/new`
 *
 * The assignee dropdown is built from this organization's ACTIVE memberships on
 * the server, so the list of people a customer can be assigned to is never
 * wider than the tenant — and the service re-checks it on write regardless of
 * what the client sends.
 */
export default async function NewCustomerPage() {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.CUSTOMERS_CREATE);

  const members = hasPermission(context!, PERMISSIONS.CUSTOMERS_ASSIGN)
    ? await listAssignableMembers(context!)
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">Add customer</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Recorded in {context!.organizationName} and added to the customer timeline.
        </p>
      </header>

      <Card>
        <CardBody className="p-6">
          <CustomerForm mode="create" members={members} />
        </CardBody>
      </Card>

      <p className="text-fg-muted text-sm">
        <Link href="/customers" className="hover:text-fg">
          Back to customers
        </Link>
      </p>
    </div>
  );
}