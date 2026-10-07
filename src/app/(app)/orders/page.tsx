import Link from 'next/link';
import { Suspense } from 'react';

import { OrderFilters } from '@/components/orders/order-filters';
import { OrderPagination } from '@/components/orders/order-pagination';
import { OrderTable } from '@/components/orders/order-table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/spinner';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatCount } from '@/lib/orders/presentation';
import { coerceOrderListQuery } from '@/lib/orders/validation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listOrders } from '@/lib/services/order.service';

export const metadata = { title: 'Orders' };

/**
 * Order list.
 *
 * Reads its filters, search term, sort and page from the URL and queries through
 * the service, which re-checks `orders:read` and pins the organization. The
 * component therefore has no authorization logic of its own — hiding the "New
 * order" button is presentation, and the service is the enforcement point.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();

  // Defence in depth: the shell hides modules the member cannot use, but a
  // direct URL must be rejected by the server too.
  assertPermission(context!, PERMISSIONS.ORDERS_READ);

  const query = coerceOrderListQuery(await searchParams);
  const { orders, pagination } = await listOrders(context!, query);
  const canCreate = hasPermission(context!, PERMISSIONS.ORDERS_CREATE);

  const isFiltered =
    Boolean(query.search) ||
    Boolean(query.status?.length) ||
    Boolean(query.assignedTo) ||
    Boolean(query.customerId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {pagination.total === 0
              ? 'No orders yet'
              : `${formatCount(pagination.total)} order${pagination.total === 1 ? '' : 's'} in this organization`}
          </p>
        </div>

        {canCreate ? (
          <Link href="/orders/new">
            <Button>New order</Button>
          </Link>
        ) : null}
      </header>

      <Card className="p-5">
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <OrderFilters />
        </Suspense>
      </Card>

      <Card>
        {orders.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'No orders match these filters' : 'No orders yet'}
            description={
              isFiltered
                ? 'Try a different search term, or clear the filters to see every order.'
                : canCreate
                  ? 'Create your first order to start tracking fulfilment, assignment and activity.'
                  : 'Orders created by your team will appear here.'
            }
            action={
              isFiltered ? (
                <Link href="/orders">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : canCreate ? (
                <Link href="/orders/new">
                  <Button>New order</Button>
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <OrderTable orders={orders} query={query} />
            <Suspense fallback={null}>
              <OrderPagination pagination={pagination} />
            </Suspense>
          </>
        )}
      </Card>
    </div>
  );
}
