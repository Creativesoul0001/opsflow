import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MovementRow } from '@/components/inventory/movement-row';
import { ArchiveWarehouseButton } from '@/components/inventory/archive-warehouse-button';
import { PromoteWarehouseButton } from '@/components/inventory/promote-warehouse-button';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatCount, formatStock, formatDateTime } from '@/lib/inventory/presentation';
import { coerceStockMovementQuery, parseWarehouseId } from '@/lib/inventory/validation';
import { hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getWarehouse, listProducts } from '@/lib/services/inventory.service';
import { listWarehouseStockMovements } from '@/lib/services/stock.service';
import { productListQuerySchema } from '@/lib/inventory/validation';

export const metadata = { title: 'Warehouse' };

/** A definition row with a muted placeholder when the field is empty. */
function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-fg-muted text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-fg mt-1 text-sm break-words">{value}</dd>
    </div>
  );
}

export default async function WarehouseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();
  if (!context) notFound();

  let warehouse;
  try {
    warehouse = await getWarehouse(context, parseWarehouseId((await params).id));
  } catch {
    notFound();
  }

  // Every product row and every movement here is tenant-scoped by the service.
  const products = await listProducts(
    context,
    productListQuerySchema.parse({
      limit: 100,
      sort: 'name',
      order: 'asc',
      status: 'ACTIVE',
      stock: 'all',
    }),
  );
  const movementQuery = coerceStockMovementQuery(await searchParams);

  // Only products that actually hold stock here, so the table is a real stock
  // view rather than the whole catalogue.
  const held = products.products.filter((product) =>
    product.stocks.some((stock) => stock.warehouseId === warehouse.id && stock.quantity > 0),
  );

  const { movements } = await listWarehouseStockMovements(context, warehouse.id, movementQuery);

  const canManage = hasPermission(context, PERMISSIONS.INVENTORY_WAREHOUSE_MANAGE);
  const canArchive = canManage && !warehouse.archivedAt;
  const canPromote = canManage && !warehouse.archivedAt && !warehouse.isPrimary;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-fg-muted text-sm">
        <Link href="/inventory/warehouses" className="hover:text-fg">
          Warehouses
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-fg">{warehouse.name}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">{warehouse.name}</h1>
          <p className="text-fg-muted mt-1 font-mono text-sm">{warehouse.code}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canManage && !warehouse.archivedAt ? (
            <Link href={`/inventory/warehouses/${warehouse.id}/edit`}>
              <Button variant="secondary">Edit warehouse</Button>
            </Link>
          ) : null}
          {canPromote ? <PromoteWarehouseButton warehouseId={warehouse.id} /> : null}
          {canArchive ? (
            <ArchiveWarehouseButton warehouseId={warehouse.id} warehouseName={warehouse.name} />
          ) : null}
        </div>
      </header>

      {warehouse.archivedAt ? (
        <Alert tone="info" title="This warehouse is archived">
          It is retained with its stock and movement history so the ledger still balances. It simply
          stops accepting new movements.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Stock held here"
              description={`${formatCount(held.length)} product${held.length === 1 ? '' : 's'} with a balance in this warehouse.`}
            />
            {held.length === 0 ? (
              <EmptyState
                title="No stock recorded here yet"
                description="Receive stock into this warehouse to start tracking it."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-2xl border-collapse text-sm">
                  <thead className="border-border-subtle border-b">
                    <tr>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase"
                      >
                        Product
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase"
                      >
                        SKU
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right text-xs font-semibold tracking-wide uppercase"
                      >
                        On hand
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {held.map((product) => {
                      const level = product.stocks.find(
                        (stock) => stock.warehouseId === warehouse.id,
                      );
                      return (
                        <tr
                          key={product.id}
                          className="border-border-subtle border-b last:border-0"
                        >
                          <td className="px-4 py-3">
                            <Link
                              href={`/inventory/products/${product.id}`}
                              className="text-fg hover:text-brand font-medium"
                            >
                              {product.name}
                            </Link>
                          </td>
                          <td className="text-fg-muted px-4 py-3 font-mono text-xs">
                            {product.sku}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatStock(level?.quantity ?? 0)} {product.unit}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Movements at this warehouse"
              description="Every change recorded here, newest first."
            />
            {movements.length === 0 ? (
              <EmptyState
                title="No movements recorded here yet"
                description="Receiving, adjusting, transferring and order deductions all appear here."
              />
            ) : (
              <ul className="divide-border-subtle divide-y">
                {movements.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Warehouse" description="Location details." />
            <CardBody>
              <dl className="grid gap-5">
                <Detail label="Total units" value={formatStock(warehouse.totalUnits)} />
                <Detail label="Products held" value={formatStock(warehouse.productCount)} />
                <Detail
                  label="Primary"
                  value={warehouse.isPrimary ? 'Yes — default order source' : 'No'}
                />
                {warehouse.addressLine1 ? (
                  <Detail label="Address" value={warehouse.addressLine1} />
                ) : null}
                {warehouse.addressLine2 ? <Detail label="" value={warehouse.addressLine2} /> : null}
                {warehouse.city || warehouse.state || warehouse.postalCode ? (
                  <Detail
                    label="City"
                    value={[warehouse.city, warehouse.state, warehouse.postalCode]
                      .filter(Boolean)
                      .join(' ')}
                  />
                ) : null}
                {warehouse.country ? <Detail label="Country" value={warehouse.country} /> : null}
                <Detail label="Created" value={formatDateTime(warehouse.createdAt)} />
                <Detail label="Last updated" value={formatDateTime(warehouse.updatedAt)} />
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
