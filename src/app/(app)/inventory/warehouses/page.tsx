import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Badge } from '@/components/ui/badge';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatCount, formatStock } from '@/lib/inventory/presentation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listWarehouses } from '@/lib/services/inventory.service';
import { warehouseListQuerySchema } from '@/lib/inventory/validation';

export const metadata = { title: 'Warehouses' };

/**
 * `GET /inventory/warehouses` — where the stock physically lives.
 *
 * An organization may hold stock in several places, and every stock movement is
 * scoped to one of them. The primary warehouse is the default source for order
 * deductions, which is why it is called out rather than just flagged in a
 * column the member has to decode.
 */
export default async function WarehousesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_READ);

  const raw = await searchParams;
  const showArchived = raw['status'] === 'ARCHIVED';

  const { warehouses } = await listWarehouses(
    context!,
    warehouseListQuerySchema.parse({
      limit: 100,
      sort: 'name',
      order: 'asc',
      status: showArchived ? 'ARCHIVED' : 'ACTIVE',
    }),
  );

  const canManage = hasPermission(context!, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Warehouses</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {warehouses.length === 0
              ? 'No warehouses yet'
              : `${formatCount(warehouses.length)} location${warehouses.length === 1 ? '' : 's'} in this organization`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={showArchived ? '/inventory/warehouses' : '/inventory/warehouses?status=ARCHIVED'}
          >
            <Button variant="secondary">{showArchived ? 'Show active' : 'Show archived'}</Button>
          </Link>
          {canManage ? (
            <Link href="/inventory/warehouses/new">
              <Button>New warehouse</Button>
            </Link>
          ) : null}
        </div>
      </header>

      {warehouses.length === 0 ? (
        <Card>
          <EmptyState
            title={showArchived ? 'No archived warehouses' : 'No warehouses yet'}
            description={
              showArchived
                ? 'Warehouses you archive are retained here with their stock history.'
                : 'Create a warehouse to start recording where stock is held. Your first one becomes the primary.'
            }
            action={
              showArchived ? (
                <Link href="/inventory/warehouses">
                  <Button variant="secondary">Show active</Button>
                </Link>
              ) : canManage ? (
                <Link href="/inventory/warehouses/new">
                  <Button>New warehouse</Button>
                </Link>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {warehouses.map((warehouse) => (
            <Card key={warehouse.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-fg font-semibold">{warehouse.name}</h2>
                  <p className="text-fg-muted font-mono text-xs">{warehouse.code}</p>
                </div>
                {warehouse.isPrimary ? <Badge tone="brand">Primary</Badge> : null}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-fg-muted text-xs font-medium tracking-wide uppercase">
                    Products
                  </dt>
                  <dd className="text-fg mt-0.5 font-medium">
                    {formatStock(warehouse.productCount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted text-xs font-medium tracking-wide uppercase">
                    Units
                  </dt>
                  <dd className="text-fg mt-0.5 font-medium">
                    {formatStock(warehouse.totalUnits)}
                  </dd>
                </div>
              </dl>

              {warehouse.city || warehouse.country ? (
                <p className="text-fg-muted mt-3 text-sm">
                  {[warehouse.city, warehouse.country].filter(Boolean).join(', ')}
                </p>
              ) : null}

              <div className="border-border-subtle mt-4 flex gap-2 border-t pt-4">
                <Link
                  href={`/inventory/warehouses/${warehouse.id}`}
                  className="text-brand text-sm hover:underline"
                >
                  View stock
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
