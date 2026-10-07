import Link from 'next/link';
import { Suspense } from 'react';

import { CustomerFilters } from '@/components/customers/customer-filters';
import { CustomerPagination } from '@/components/customers/customer-pagination';
import { CustomerTable } from '@/components/customers/customer-table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/spinner';
import { getAuthorizationContext } from '@/lib/auth/session';
import { coerceCustomerListQuery } from '@/lib/customers/validation';
import { formatCount } from '@/lib/customers/presentation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listCustomers } from '@/lib/services/customer.service';

export const metadata = { title: 'Customers' };

/**
 * Customer list.
 *
 * Reads its filters, search term, sort and page from the URL and queries through
 * the service, which re-checks `customers:read` and pins the organization. The
 * component therefore has no authorization logic of its own — hiding the "Add
 * customer" button is presentation, and the service is the enforcement point.
 */
export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();

  // Defence in depth: the shell hides modules the member cannot use, but a
  // direct URL must be rejected by the server too.
  assertPermission(context!, PERMISSIONS.CUSTOMERS_READ);

  const query = coerceCustomerListQuery(await searchParams);
  const { customers, pagination } = await listCustomers(context!, query);
  const canCreate = hasPermission(context!, PERMISSIONS.CUSTOMERS_CREATE);

  const isFiltered =
    Boolean(query.search) ||
    Boolean(query.status) ||
    Boolean(query.type) ||
    Boolean(query.assignedTo);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {pagination.total === 0
              ? 'No customers yet'
              : `${formatCount(pagination.total)} customer${pagination.total === 1 ? '' : 's'} in this organization`}
          </p>
        </div>

        {canCreate ? (
          <Link href="/customers/new">
            <Button>Add customer</Button>
          </Link>
        ) : null}
      </header>

      <Card className="p-5">
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <CustomerFilters />
        </Suspense>
      </Card>

      <Card>
        {customers.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'No customers match these filters' : 'No customers yet'}
            description={
              isFiltered
                ? 'Try a different search term, or clear the filters to see everyone.'
                : canCreate
                  ? 'Add your first customer to start tracking contacts, notes and activity.'
                  : 'Customers created by your team will appear here.'
            }
            action={
              isFiltered ? (
                <Link href="/customers">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : canCreate ? (
                <Link href="/customers/new">
                  <Button>Add customer</Button>
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <CustomerTable
              customers={customers}
              sort={query.sort}
              order={query.order}
              search={query.search ?? ''}
            />
            <Suspense fallback={null}>
              <CustomerPagination pagination={pagination} />
            </Suspense>
          </>
        )}
      </Card>
    </div>
  );
}
