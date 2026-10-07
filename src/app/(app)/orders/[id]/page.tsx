import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OrderActivityTimeline } from '@/components/orders/order-activity-timeline';
import { OrderStatusBadge } from '@/components/orders/order-badges';
import { OrderAssignForm } from '@/components/orders/order-assign-form';
import { OrderNoteForm } from '@/components/orders/order-note-form';
import { OrderStatusActions } from '@/components/orders/order-status-actions';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import {
  formatDate,
  formatDateTime,
  formatItemCount,
  formatMoney,
  formatTaxRate,
} from '@/lib/orders/presentation';
import { orderActivityQuerySchema, parseOrderId } from '@/lib/orders/validation';
import { isTerminalOrderStatus, isOrderStatus } from '@/lib/orders/status';
import { hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import {
  getOrder,
  listOrderActivities,
  listOrderAssignableMembers,
} from '@/lib/services/order.service';

export const metadata = { title: 'Order' };

/** A definition row with a muted placeholder when the field is empty. */
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-fg-muted text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-fg mt-1 text-sm break-words">{value}</dd>
    </div>
  );
}

function Missing({ children }: { children: React.ReactNode }) {
  return <span className="text-fg-muted/70">{children}</span>;
}

/**
 * `GET /orders/[id]`
 *
 * The order is loaded through the service, which scopes the lookup to the
 * caller's organization. A member who guesses another tenant's id lands on the
 * same 404 page as for a deleted order — the page never confirms that the id
 * exists elsewhere.
 *
 * Permissions decide which actions are *rendered*. Hiding a button is not
 * enforcement: each action's endpoint independently checks its own permission, so
 * a member without `orders:cancel` cannot cancel by calling the API directly.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthorizationContext();
  if (!context) notFound();

  let order;
  try {
    order = await getOrder(context, parseOrderId((await params).id));
  } catch {
    // Covers both "no such order" and "not yours" without distinguishing them.
    notFound();
  }

  const activities = await listOrderActivities(
    context,
    order.id,
    orderActivityQuerySchema.parse({}),
  );

  const canUpdate = hasPermission(context, PERMISSIONS.ORDERS_UPDATE);
  const canCancel = hasPermission(context, PERMISSIONS.ORDERS_CANCEL);
  const canAssign = hasPermission(context, PERMISSIONS.ORDERS_ASSIGN);

  const terminal = isOrderStatus(order.status) && isTerminalOrderStatus(order.status);
  const editable = !terminal && (order.status === 'PENDING' || order.status === 'CONFIRMED');

  const members = canAssign && !terminal ? await listOrderAssignableMembers(context) : [];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-fg-muted text-sm">
        <Link href="/orders" className="hover:text-fg">
          Orders
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-fg">{order.orderNumber}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">{order.orderNumber}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="text-fg-muted mt-1 text-sm">
            <Link href={`/customers/${order.customer.id}`} className="hover:text-fg">
              {order.customer.fullName}
            </Link>
            {order.customer.companyName ? ` · ${order.customer.companyName}` : ''} · Created{' '}
            {formatDate(order.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canUpdate && editable ? (
            <Link href={`/orders/${order.id}/edit`}>
              <Button variant="secondary">Edit order</Button>
            </Link>
          ) : null}
        </div>
      </header>

      {terminal ? (
        <Alert
          tone="info"
          title={`This order is ${order.status === 'CANCELLED' ? 'cancelled' : 'delivered'}`}
        >
          Its line items, totals and history are retained as a record. Nothing on it can be changed
          further.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Order" description="Who it is for and where it stands." />
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2">
                <Detail
                  label="Customer"
                  value={
                    <Link href={`/customers/${order.customer.id}`} className="hover:text-brand">
                      {order.customer.fullName}
                    </Link>
                  }
                />
                <Detail
                  label="Email"
                  value={
                    <a href={`mailto:${order.customer.email}`} className="hover:text-brand">
                      {order.customer.email}
                    </a>
                  }
                />
                <Detail
                  label="Assigned to"
                  value={order.assignedUser?.name ?? <Missing>Unassigned</Missing>}
                />
                <Detail label="Tax rate" value={formatTaxRate(order.taxRate)} />
                <Detail label="Created" value={formatDateTime(order.createdAt)} />
                <Detail label="Last updated" value={formatDateTime(order.updatedAt)} />
                {order.cancelledAt ? (
                  <Detail label="Cancelled" value={formatDateTime(order.cancelledAt)} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Line items"
              description={`${formatItemCount(order.items.length)} on this order.`}
            />
            <CardBody className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-md border-collapse text-sm">
                  <thead className="border-border-subtle border-b">
                    <tr>
                      <th
                        scope="col"
                        className="px-2 py-2 text-left text-xs font-semibold tracking-wide uppercase"
                      >
                        Item
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right text-xs font-semibold tracking-wide uppercase"
                      >
                        Qty
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right text-xs font-semibold tracking-wide uppercase"
                      >
                        Unit price
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right text-xs font-semibold tracking-wide uppercase"
                      >
                        Discount
                      </th>
                      <th
                        scope="col"
                        className="px-2 py-2 text-right text-xs font-semibold tracking-wide uppercase"
                      >
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.items.map((item) => (
                      <tr key={item.id} className="border-border-subtle border-b last:border-0">
                        <td className="px-2 py-2">{item.productName}</td>
                        <td className="text-fg-muted px-2 py-2 text-right">{item.quantity}</td>
                        <td className="text-fg-muted px-2 py-2 text-right">
                          {formatMoney(item.unitPrice)}
                        </td>
                        <td className="text-fg-muted px-2 py-2 text-right">
                          {formatMoney(item.discount)}
                        </td>
                        <td className="px-2 py-2 text-right font-medium">
                          {formatMoney(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Subtotal</dt>
                  <dd>{formatMoney(order.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Discount</dt>
                  <dd>− {formatMoney(order.discount)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-fg-muted">Tax</dt>
                  <dd>{formatMoney(order.tax)}</dd>
                </div>
                <div className="border-border-subtle flex justify-between border-t pt-1 font-semibold">
                  <dt>Total</dt>
                  <dd>{formatMoney(order.total)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Notes"
              description="Visible to everyone in your organization with order access."
            />
            <CardBody className="space-y-5">
              {order.notes ? (
                <p className="text-fg text-sm whitespace-pre-wrap">{order.notes}</p>
              ) : (
                <p className="text-fg-muted text-sm">No notes recorded yet.</p>
              )}

              {canUpdate && !terminal ? <OrderNoteForm orderId={order.id} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" description="Every change to this order, newest first." />
            <CardBody>
              <OrderActivityTimeline activities={activities.activities} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Workflow"
              description={
                terminal ? 'This order has reached a final state.' : 'Move the order along.'
              }
            />
            <CardBody>
              <OrderStatusActions
                orderId={order.id}
                status={order.status}
                canUpdate={canUpdate}
                allowCancel={canCancel}
              />
            </CardBody>
          </Card>

          {canAssign && !terminal ? (
            <Card>
              <CardHeader title="Assignment" />
              <CardBody>
                <OrderAssignForm
                  orderId={order.id}
                  assignedUserId={order.assignedUserId}
                  members={members}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-3">
              <div>
                <p className="text-fg font-medium">{order.customer.fullName}</p>
                <p className="text-fg-muted text-sm">{order.customer.email}</p>
                {order.customer.companyName ? (
                  <p className="text-fg-muted text-sm">{order.customer.companyName}</p>
                ) : null}
              </div>
              <Link href={`/customers/${order.customer.id}`}>
                <Button variant="secondary" size="sm">
                  View customer
                </Button>
              </Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
