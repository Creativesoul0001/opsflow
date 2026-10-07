import Link from 'next/link';

import { CustomerStatusBadge, CustomerTypeBadge } from '@/components/customers/customer-badges';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/customers/presentation';
import type { CustomerDto } from '@/lib/services/customer.service';

const HEADING_CLASS = 'px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase';

/** Sortable column header that toggles direction and keeps current filters. */
function SortHeader({
  label,
  sortKey,
  activeSort,
  order,
  search,
}: {
  label: string;
  sortKey: string;
  activeSort: string;
  order: string;
  search: string;
}) {
  const active = activeSort === sortKey;
  const nextOrder = active && order === 'asc' ? 'desc' : 'asc';

  const params = new URLSearchParams(search);
  params.set('sort', sortKey);
  params.set('order', nextOrder);
  params.delete('page');

  return (
    <th scope="col" className={HEADING_CLASS}>
      <Link
        href={`/customers?${params.toString()}`}
        className="text-fg-muted hover:text-fg inline-flex items-center gap-1"
        aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {active ? (order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  );
}

/**
 * Customer list.
 *
 * Rendered on the server from the request's query parameters. The table scrolls
 * horizontally on narrow screens rather than hiding columns, so no data becomes
 * unreachable on a phone.
 */
export function CustomerTable({
  customers,
  sort,
  order,
  search,
}: {
  customers: readonly CustomerDto[];
  sort: string;
  order: string;
  search: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-3xl border-collapse text-sm">
        <thead className="border-border-subtle bg-surface-muted border-b">
          <tr>
            <SortHeader
              label="Name"
              sortKey="name"
              activeSort={sort}
              order={order}
              search={search}
            />
            <th scope="col" className={HEADING_CLASS}>
              Email
            </th>
            <th scope="col" className={HEADING_CLASS}>
              Phone
            </th>
            <th scope="col" className={HEADING_CLASS}>
              Company
            </th>
            <SortHeader
              label="Status"
              sortKey="status"
              activeSort={sort}
              order={order}
              search={search}
            />
            <th scope="col" className={HEADING_CLASS}>
              Assigned to
            </th>
            <SortHeader
              label="Created"
              sortKey="createdAt"
              activeSort={sort}
              order={order}
              search={search}
            />
            <th scope="col" className={HEADING_CLASS}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {customers.map((customer) => (
            <tr key={customer.id} className="border-border-subtle border-b last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`/customers/${customer.id}`}
                  className="text-fg hover:text-brand font-medium"
                >
                  {customer.fullName}
                </Link>
                <div className="mt-0.5">
                  <CustomerTypeBadge customerType={customer.customerType} />
                </div>
              </td>
              <td className="text-fg-muted px-4 py-3">
                <a href={`mailto:${customer.email}`} className="hover:text-fg">
                  {customer.email}
                </a>
              </td>
              <td className="text-fg-muted px-4 py-3">{customer.phone ?? '—'}</td>
              <td className="text-fg-muted px-4 py-3">{customer.companyName ?? '—'}</td>
              <td className="px-4 py-3">
                <CustomerStatusBadge status={customer.status} />
              </td>
              <td className="text-fg-muted px-4 py-3">
                {customer.assignedUser?.name ?? (
                  <span className="text-fg-muted/60">Unassigned</span>
                )}
              </td>
              <td className="text-fg-muted px-4 py-3 whitespace-nowrap">
                {formatDate(customer.createdAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`/customers/${customer.id}`}>
                  <Button variant="secondary" size="sm">
                    View
                  </Button>
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
