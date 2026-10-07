import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import type { CustomerOption } from '@/components/orders/customer-picker';
import { OrderForm } from '@/components/orders/order-form';
import { Alert } from '@/components/ui/alert';
import { Card, CardBody } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { customerListQuerySchema } from '@/lib/customers/validation';
import { hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { parseOrderId } from '@/lib/orders/validation';
import { listCustomers } from '@/lib/services/customer.service';
import { getOrder } from '@/lib/services/order.service';

export const metadata = { title: 'Edit order' };

/**
 * `GET /orders/[id]/edit`
 *
 * Reuses the create form. Orders that are no longer editable are sent back to
 * their own page instead of showing a form, because the service refuses to edit
 * them — the redirect makes that rule visible before the member types anything.
 */
export default async function EditOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthorizationContext();
  if (!context) notFound();

  if (!hasPermission(context, PERMISSIONS.ORDERS_UPDATE)) {
    redirect('/orders');
  }

  let order;
  try {
    order = await getOrder(context, parseOrderId((await params).id));
  } catch {
    notFound();
  }

  if (order.status !== 'PENDING' && order.status !== 'CONFIRMED') {
    redirect(`/orders/${order.id}`);
  }

  const customers = hasPermission(context, PERMISSIONS.CUSTOMERS_READ)
    ? (
        await listCustomers(
          context,
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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold tracking-tight">Edit {order.orderNumber}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Only the customer and the money inputs are editable, and only while the order is pending
          or confirmed. Totals are recomputed on save.
        </p>
      </header>

      <Alert tone="info">
        Status, assignment and notes are managed on the order page so each keeps its own permission
        and audit entry.
      </Alert>

      <Card>
        <CardBody className="p-6">
          <OrderForm
            mode="edit"
            orderId={order.id}
            customers={options}
            members={[]}
            customerLabel={order.customer.companyName ?? order.customer.fullName}
            initialValues={{
              customerId: order.customerId,
              items: order.items.map((item) => ({
                productName: item.productName,
                quantity: String(item.quantity),
                unitPrice: item.unitPrice,
                discount: item.discount,
              })),
              discount: order.discount,
              taxRate: order.taxRate,
              notes: order.notes ?? '',
              assignedUserId: order.assignedUserId ?? '',
            }}
          />
        </CardBody>
      </Card>

      <p className="text-fg-muted text-sm">
        <Link href={`/orders/${order.id}`} className="hover:text-fg">
          Back to {order.orderNumber}
        </Link>
      </p>
    </div>
  );
}
