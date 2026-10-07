import Link from 'next/link';

import { OrderStatusBadge } from '@/components/orders/order-badges';
import { Button } from '@/components/ui/button';
import { formatDate, formatItemCount, formatMoney, isZeroAmount } from '@/lib/orders/presentation';
import type { OrderListQuery } from '@/lib/orders/validation';
import type { OrderDto } from '@/lib/services/order.service';

const HEADING_CLASS = 'px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase';

/**
 * Query string that keeps every active filter and swaps only the sort.
 *
 * Sorting is a navigation, not a state change: keeping `status`, `assignedTo`
 * and `search` in the link is what stops a member from losing their filters the
 * moment they sort by total.
 */
function sortHref(basePath: string, query: OrderListQuery, sortKey: string): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.status && query.status.length > 0) params.set('status', query.status.join(','));
  if (query.assignedTo) params.set('assignedTo', query.assignedTo);
  if (query.customerId) params.set('customerId', query.customerId);

  const nextOrder = query.sort === sortKey && query.order === 'asc' ? 'desc' : 'asc';
  params.set('sort', sortKey);
  params.set('order', nextOrder);

  return `${basePath}?${params.toString()}`;
}

/** Sortable column header that toggles direction and keeps current filters. */
function SortHeader({
  label,
  sortKey,
  query,
  basePath,
}: {
  label: string;
  sortKey: string;
  query: OrderListQuery;
  basePath: string;
}) {
  const active = query.sort === sortKey;

  return (
    <th scope="col" className={HEADING_CLASS}>
      <Link
        href={sortHref(basePath, query, sortKey)}
        className="text-fg-muted hover:text-fg inline-flex items-center gap-1"
        aria-sort={active ? (query.order === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span aria-hidden="true" className="text-[10px]">
          {active ? (query.order === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </Link>
    </th>
  );
}

/**
 * Order list.
 *
 * Rendered on the server from the request's query parameters. The table scrolls
 * horizontally on narrow screens rather than hiding columns, so no data becomes
 * unreachable on a phone.
 */
export function OrderTable({
  orders,
  query,
  basePath = '/orders',
}: {
  orders: readonly OrderDto[];
  query: OrderListQuery;
  basePath?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-4xl border-collapse text-sm">
        <thead className="border-border-subtle bg-surface-muted border-b">
          <tr>
            <SortHeader label="Order" sortKey="orderNumber" query={query} basePath={basePath} />
            <th scope="col" className={HEADING_CLASS}>
              Customer
            </th>
            <SortHeader label="Status" sortKey="status" query={query} basePath={basePath} />
            <th scope="col" className={HEADING_CLASS}>
              Items
            </th>
            <SortHeader label="Total" sortKey="total" query={query} basePath={basePath} />
            <th scope="col" className={HEADING_CLASS}>
              Assigned to
            </th>
            <SortHeader label="Created" sortKey="createdAt" query={query} basePath={basePath} />
            <th scope="col" className={HEADING_CLASS}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-border-subtle border-b last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`${basePath}/${order.id}`}
                  className="text-fg hover:text-brand font-medium"
                >
                  {order.orderNumber}
                </Link>
              </td>
              <td className="text-fg-muted max-w-48 px-4 py-3">
                <Link href={`/customers/${order.customer.id}`} className="hover:text-fg">
                  {order.customer.fullName}
                </Link>
                {order.customer.companyName ? (
                  <div className="text-fg-muted/70 truncate text-xs">
                    {order.customer.companyName}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <OrderStatusBadge status={order.status} />
              </td>
              <td className="text-fg-muted px-4 py-3 whitespace-nowrap">
                {formatItemCount(order.items.length)}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-fg font-medium">{formatMoney(order.total)}</span>
                {!isZeroAmount(order.discount) ? (
                  <div className="text-fg-muted/70 text-xs">{formatMoney(order.discount)} off</div>
                ) : null}
              </td>
              <td className="text-fg-muted px-4 py-3">
                {order.assignedUser?.name ?? <span className="text-fg-muted/60">Unassigned</span>}
              </td>
              <td className="text-fg-muted px-4 py-3 whitespace-nowrap">
                {formatDate(order.createdAt)}
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`${basePath}/${order.id}`}>
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
