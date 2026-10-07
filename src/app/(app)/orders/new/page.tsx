import Link from 'next/link';

import type { CustomerOption } from '@/components/orders/customer-picker';
import { OrderForm } from '@/components/orders/order-form';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { customerListQuerySchema } from '@/lib/customers/validation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listCustomers } from '@/lib/services/customer.service';
import { listOrderAssignableMembers } from '@/lib/services/order.service';

export const metadata = { title: 'New order' };

/**
 * `GET /orders/new`
 *
 * The customer and assignee lists are built on the server, so neither can be
 * wider than this organization. The form's search box goes back through the
 * customer API, which re-applies the same tenant and permission checks.
 *
 * The initial customer list is capped at the page size the customer API allows,
 * sorted by name; searching reaches the rest.
 */
export default async function NewOrderPage() {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.ORDERS_CREATE);

  const customers = hasPermission(context!, PERMISSIONS.CUSTOMERS_READ)
    ? (
        await listCustomers(
          context!,
          customerListQuerySchema.parse({
            limit: 100,
            sort: 'name',
            order: 'asc',
            status: 'ACTIVE',
          }),
        )
      ).customers
    : [];

  const options: CustomerOption[] = customers.map((customer) => ({
    id: customer.id,
    label: customer.companyName ?? customer.fullName,
    detail: customer.companyName ? `${customer.fullName} · ${customer.email}` : customer.email,
  }));

  const members = hasPermission(context!, PERMISSIONS.ORDERS_ASSIGN)
    ? await listOrderAssignableMembers(context!)
    : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">New order</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Created in {context!.organizationName}. The order number, status and every total are
          assigned by the server.
        </p>
      </header>

      <Card>
        <CardBody className="p-6">
          <OrderForm mode="create" customers={options} members={members} />
        </CardBody>
      </Card>

      <p className="text-fg-muted text-sm">
        <Link href="/orders" className="hover:text-fg">
          Back to orders
        </Link>
      </p>
    </div>
  );
}
