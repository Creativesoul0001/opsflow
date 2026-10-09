import Link from 'next/link';
import { Suspense } from 'react';

import { MovementFilters } from '@/components/inventory/movement-filters';
import { MovementPagination } from '@/components/inventory/movement-pagination';
import { MovementRow } from '@/components/inventory/movement-row';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/spinner';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatCount } from '@/lib/inventory/presentation';
import { coerceStockMovementQuery } from '@/lib/inventory/validation';
import { assertPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listStockMovements } from '@/lib/services/stock.service';

export const metadata = { title: 'Stock movements' };

/**
 * `GET /inventory/movements` — the stock ledger.
 *
 * This is the module's answer to "why is this product's stock what it is?".
 * Every quantity change is on this list, including the writes the order workflow
 * performed, so an audit never has to reconstruct what happened from balances
 * alone.
 */
export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_READ);

  const query = coerceStockMovementQuery(await searchParams);
  const { movements, pagination } = await listStockMovements(context!, query);

  const isFiltered =
    Boolean(query.search) ||
    Boolean(query.type?.length) ||
    Boolean(query.productId) ||
    Boolean(query.warehouseId) ||
    Boolean(query.orderId) ||
    Boolean(query.transferId);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Stock movements</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {pagination.total === 0
              ? 'No movements yet'
              : `${formatCount(pagination.total)} movement${pagination.total === 1 ? '' : 's'} recorded`}
          </p>
        </div>

        <Link href="/inventory">
          <Button variant="secondary">Back to inventory</Button>
        </Link>
      </header>

      <Card className="p-5">
        <Suspense fallback={<Skeleton className="h-32 w-full" />}>
          <MovementFilters />
        </Suspense>
      </Card>

      <Card>
        {movements.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'No movements match these filters' : 'No movements yet'}
            description={
              isFiltered
                ? 'Try a different search term, or clear the filters to see every movement.'
                : 'Receiving stock, adjusting a balance, transferring between warehouses and confirming orders all appear here.'
            }
            action={
              isFiltered ? (
                <Link href="/inventory/movements">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <ul className="divide-border-subtle divide-y">
              {movements.map((movement) => (
                <MovementRow key={movement.id} movement={movement} />
              ))}
            </ul>
            <Suspense fallback={null}>
              <MovementPagination pagination={pagination} />
            </Suspense>
          </>
        )}
      </Card>
    </div>
  );
}
