import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ActivityTimeline } from '@/components/customers/activity-timeline';
import { CustomerArchiveAction } from '@/components/customers/customer-archive-action';
import { CustomerAssignForm } from '@/components/customers/customer-assign-form';
import { CustomerStatusBadge, CustomerTypeBadge } from '@/components/customers/customer-badges';
import { CustomerNoteForm } from '@/components/customers/customer-note-form';
import { OrderStatusBadge } from '@/components/orders/order-badges';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { getAuthorizationContext } from '@/lib/auth/session';
import { customerActivityQuerySchema } from '@/lib/customers/validation';
import { customerStatusLabel, formatDate, formatDateTime } from '@/lib/customers/presentation';
import { formatMoney } from '@/lib/orders/presentation';
import { orderListQuerySchema } from '@/lib/orders/validation';
import { hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import {
  getCustomer,
  listAssignableMembers,
  listCustomerActivities,
} from '@/lib/services/customer.service';
import { listOrders } from '@/lib/services/order.service';

export const metadata = { title: 'Customer' };

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
 * `GET /customers/[id]`
 *
 * The customer is loaded through the service, which scopes the lookup to the
 * caller's organization. A member who guesses another tenant's id lands on the
 * same 404 page as for a deleted record — the page never confirms that the id
 * exists elsewhere.
 *
 * Permissions decide which actions are *rendered*. Hiding a button is not
 * enforcement: each action's endpoint independently checks the permission, so a
 * member without `customers:archive` cannot archive by calling the API directly.
 */
export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await getAuthorizationContext();
  if (!context) notFound();

  let customer;
  try {
    customer = await getCustomer(context, (await params).id);
  } catch {
    // Covers both "no such customer" and "not yours" without distinguishing them.
    notFound();
  }

  const activities = await listCustomerActivities(
    context,
    customer.id,
    customerActivityQuerySchema.parse({}),
  );

  const canUpdate = hasPermission(context, PERMISSIONS.CUSTOMERS_UPDATE);
  const canArchive = hasPermission(context, PERMISSIONS.CUSTOMERS_ARCHIVE);
  const canAssign = hasPermission(context, PERMISSIONS.CUSTOMERS_ASSIGN);
  const isArchived = Boolean(customer.archivedAt);

  const members = canAssign && !isArchived ? await listAssignableMembers(context) : [];

  // Order history needs `orders:read` as well as customer access; a member who
  // can see the customer but not orders gets an explicit explanation rather than
  // a silent omission that would read as "this customer has never ordered".
  const customerOrders = hasPermission(context, PERMISSIONS.ORDERS_READ)
    ? await listOrders(
        context,
        orderListQuerySchema.parse({
          customerId: customer.id,
          limit: 10,
          sort: 'createdAt',
          order: 'desc',
        }),
      )
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-fg-muted text-sm">
        <Link href="/customers" className="hover:text-fg">
          Customers
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-fg">{customer.fullName}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">{customer.fullName}</h1>
            <CustomerStatusBadge status={customer.status} />
            <CustomerTypeBadge customerType={customer.customerType} />
          </div>
          <p className="text-fg-muted mt-1 text-sm">
            {customer.companyName ? `${customer.companyName} · ` : ''}
            Added {formatDate(customer.createdAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canUpdate && !isArchived ? (
            <Link href={`/customers/${customer.id}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
          ) : null}
          {canArchive && !isArchived ? (
            <CustomerArchiveAction
              customerId={customer.id}
              customerName={customer.fullName}
              archived={isArchived}
            />
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Profile" description="Contact and company details." />
            <CardBody>
              <dl className="grid gap-5 sm:grid-cols-2">
                <Detail
                  label="Email"
                  value={
                    <a href={`mailto:${customer.email}`} className="hover:text-brand">
                      {customer.email}
                    </a>
                  }
                />
                <Detail
                  label="Phone"
                  value={
                    customer.phone ? (
                      <a href={`tel:${customer.phone}`} className="hover:text-brand">
                        {customer.phone}
                      </a>
                    ) : (
                      <Missing>Not provided</Missing>
                    )
                  }
                />
                <Detail
                  label="Company"
                  value={customer.companyName ?? <Missing>Not provided</Missing>}
                />
                <Detail label="Status" value={customerStatusLabel(customer.status)} />
                <Detail
                  label="Assigned to"
                  value={customer.assignedUser?.name ?? <Missing>Unassigned</Missing>}
                />
                <Detail label="Created" value={formatDateTime(customer.createdAt)} />
                <Detail label="Last updated" value={formatDateTime(customer.updatedAt)} />
                {customer.archivedAt ? (
                  <Detail label="Archived" value={formatDateTime(customer.archivedAt)} />
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Notes"
              description="Visible to everyone in your organization with customer access."
            />
            <CardBody className="space-y-5">
              {customer.notes ? (
                <p className="text-fg text-sm whitespace-pre-wrap">{customer.notes}</p>
              ) : (
                <p className="text-fg-muted text-sm">No notes recorded yet.</p>
              )}

              {canUpdate && !isArchived ? <CustomerNoteForm customerId={customer.id} /> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Activity"
              description="Every change to this customer, newest first."
            />
            <CardBody>
              <ActivityTimeline activities={activities.activities} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {canAssign && !isArchived ? (
            <Card>
              <CardHeader title="Assignment" />
              <CardBody>
                <CustomerAssignForm
                  customerId={customer.id}
                  assignedUserId={customer.assignedUserId}
                  members={members}
                />
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Orders"
              description="Every order this customer has placed, newest first."
            />
            <CardBody className="space-y-4">
              {customerOrders ? (
                <>
                  {customerOrders.orders.length === 0 ? (
                    <p className="text-fg-muted text-sm">No orders from this customer yet.</p>
                  ) : (
                    <ul className="divide-border-subtle divide-y">
                      {customerOrders.orders.map((order) => (
                        <li key={order.id} className="py-2.5 first:pt-0 last:pb-0">
                          <Link
                            href={`/orders/${order.id}`}
                            className="hover:text-fg flex items-center justify-between gap-3"
                          >
                            <span className="min-w-0">
                              <span className="text-fg hover:text-brand font-medium">
                                {order.orderNumber}
                              </span>
                              <span className="text-fg-muted ml-2 text-sm">
                                {formatDate(order.createdAt)}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-3">
                              <OrderStatusBadge status={order.status} />
                              <span className="text-fg text-sm font-medium">
                                {formatMoney(order.total)}
                              </span>
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-fg-muted text-sm">
                      {customerOrders.pagination.total === 0
                        ? 'Nothing to show.'
                        : `${customerOrders.pagination.total} order${
                            customerOrders.pagination.total === 1 ? '' : 's'
                          } in total.`}
                    </p>
                    <Link href={`/orders?customerId=${customer.id}`}>
                      <Button variant="secondary" size="sm">
                        View all orders
                      </Button>
                    </Link>
                  </div>
                </>
              ) : (
                <Alert tone="info" title="Orders are not visible to you">
                  Your role does not include <code>orders:read</code>, so this customer&apos;s order
                  history is not shown.
                </Alert>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
