import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { MovementRow } from '@/components/inventory/movement-row';
import { ArchiveProductButton } from '@/components/inventory/archive-product-button';
import { StockLevelBadge } from '@/components/inventory/product-table';
import { ProductStockForms } from '@/components/inventory/product-stock-forms';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/spinner';
import { getAuthorizationContext } from '@/lib/auth/session';
import {
  formatCount,
  formatDateTime,
  formatMoney,
  formatStock,
} from '@/lib/inventory/presentation';
import { coerceStockMovementQuery, parseProductId } from '@/lib/inventory/validation';
import { warehouseListQuerySchema } from '@/lib/inventory/validation';
import { hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getProduct, listWarehouses } from '@/lib/services/inventory.service';
import { listProductStockMovements } from '@/lib/services/stock.service';

export const metadata = { title: 'Product' };

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
 * `GET /inventory/products/:id`
 *
 * Loaded through the service, which pins the organization: another tenant's
 * product id returns the same 404 as a missing one. The movement ledger is
 * filtered by product so the page can explain exactly how the current balance
 * came to be.
 */
export default async function ProductDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();
  if (!context) notFound();

  let product;
  try {
    product = await getProduct(context, parseProductId((await params).id));
  } catch {
    notFound();
  }

  const query = coerceStockMovementQuery(await searchParams);
  const { movements, pagination } = await listProductStockMovements(context, product.id, query);

  // The stock forms need the active warehouses, which the same permission that
  // lets the member see the product already grants. The list is capped at the
  // largest page the API allows so a picker never silently truncates.
  const { warehouses } = await listWarehouses(context, {
    ...warehouseListQuerySchema.parse({ limit: 100, status: 'ACTIVE', sort: 'name', order: 'asc' }),
  });

  const canAdjust = hasPermission(context, PERMISSIONS.INVENTORY_STOCK_ADJUST);
  const canTransfer = hasPermission(context, PERMISSIONS.INVENTORY_STOCK_TRANSFER);
  const canUpdate = hasPermission(context, PERMISSIONS.INVENTORY_PRODUCT_UPDATE);
  const canArchive = hasPermission(context, PERMISSIONS.INVENTORY_PRODUCT_ARCHIVE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-fg-muted text-sm">
        <Link href="/inventory/products" className="hover:text-fg">
          Products
        </Link>
        <span aria-hidden="true"> / </span>
        <span className="text-fg">{product.sku}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-fg text-2xl font-semibold tracking-tight">{product.name}</h1>
            <StockLevelBadge
              totalStock={product.totalStock}
              reorderThreshold={product.reorderThreshold}
              unit={product.unit}
            />
          </div>
          <p className="text-fg-muted mt-1 font-mono text-sm">{product.sku}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canUpdate && !product.archivedAt ? (
            <Link href={`/inventory/products/${product.id}/edit`}>
              <Button variant="secondary">Edit product</Button>
            </Link>
          ) : null}
          {canArchive && !product.archivedAt ? (
            <ArchiveProductButton productId={product.id} productName={product.name} />
          ) : null}
        </div>
      </header>

      {product.archivedAt ? (
        <Alert tone="info" title="This product is archived">
          It is retained because order lines and stock movements point at it. Its details are
          read-only, though its stock can still be counted and moved.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader
              title="Stock by warehouse"
              description={`${formatCount(product.stocks.length)} location${product.stocks.length === 1 ? '' : 's'} currently hold this product.`}
            />
            {product.stocks.length === 0 ? (
              <EmptyState
                title="No stock recorded yet"
                description="This product has never been received. Record an opening balance to start tracking it."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-md border-collapse text-sm">
                  <thead className="border-border-subtle border-b">
                    <tr>
                      <th
                        scope="col"
                        className="px-4 py-2 text-left text-xs font-semibold tracking-wide uppercase"
                      >
                        Warehouse
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-2 text-right text-xs font-semibold tracking-wide uppercase"
                      >
                        On hand
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.stocks.map((stock) => (
                      <tr
                        key={stock.warehouseId}
                        className="border-border-subtle border-b last:border-0"
                      >
                        <td className="px-4 py-2">
                          <Link
                            href={`/inventory/warehouses/${stock.warehouseId}`}
                            className="text-fg hover:text-brand"
                          >
                            {stock.warehouseName}
                          </Link>
                          <span className="text-fg-muted/70 ml-2 font-mono text-xs">
                            {stock.warehouseCode}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right font-medium">
                          {formatStock(stock.quantity)} {product.unit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-border-subtle border-t">
                    <tr>
                      <td className="px-4 py-2 text-sm font-semibold">Total</td>
                      <td className="px-4 py-2 text-right text-sm font-semibold">
                        {formatStock(product.totalStock)} {product.unit}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Stock movements"
              description="Every change to this product's quantity, newest first."
              action={
                <Link href="/inventory/movements" className="text-brand hover:text-fg text-sm">
                  All movements
                </Link>
              }
            />
            {movements.length === 0 ? (
              <EmptyState
                title="No movements recorded yet"
                description="Receiving, adjusting, transferring and confirming orders all appear here."
              />
            ) : (
              <>
                <ul className="divide-border-subtle divide-y">
                  {movements.map((movement) => (
                    <MovementRow key={movement.id} movement={movement} />
                  ))}
                </ul>
                {pagination.total > pagination.limit ? (
                  <div className="text-fg-muted border-border-subtle border-t px-5 py-3 text-sm">
                    Showing {formatCount(pagination.page * pagination.limit)} of{' '}
                    {formatCount(pagination.total)} movements.{' '}
                    <Link href="/inventory/movements" className="text-brand hover:text-fg">
                      See the full ledger
                    </Link>
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Product" description="Catalogue details." />
            <CardBody>
              <dl className="grid gap-5">
                <Detail
                  label="Category"
                  value={
                    product.categoryId ? (
                      <Link href={`/inventory/products?categoryId=${product.categoryId}`}>
                        {product.categoryName}
                      </Link>
                    ) : (
                      <Missing>Uncategorised</Missing>
                    )
                  }
                />
                <Detail label="Unit price" value={formatMoney(product.unitPrice)} />
                <Detail
                  label="Cost price"
                  value={
                    product.costPrice ? (
                      formatMoney(product.costPrice)
                    ) : (
                      <Missing>Not tracked</Missing>
                    )
                  }
                />
                <Detail
                  label="Reorder threshold"
                  value={
                    product.reorderThreshold === 0 ? (
                      <Missing>Not configured</Missing>
                    ) : (
                      `${formatStock(product.reorderThreshold)} ${product.unit}`
                    )
                  }
                />
                <Detail label="Unit" value={product.unit} />
                <Detail label="Created" value={formatDateTime(product.createdAt)} />
                <Detail label="Last updated" value={formatDateTime(product.updatedAt)} />
              </dl>

              {product.description ? (
                <div className="border-border-subtle mt-5 border-t pt-4">
                  <p className="text-fg-muted text-xs font-medium tracking-wide uppercase">
                    Description
                  </p>
                  <p className="text-fg mt-1 text-sm whitespace-pre-wrap">{product.description}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {!product.archivedAt ? (
            <Suspense fallback={<Skeleton className="h-64 w-full" />}>
              <ProductStockForms
                productId={product.id}
                unit={product.unit}
                totalStock={product.totalStock}
                canAdjust={canAdjust}
                canTransfer={canTransfer}
                warehouses={warehouses.map((warehouse) => ({
                  id: warehouse.id,
                  code: warehouse.code,
                  name: warehouse.name,
                  isPrimary: warehouse.isPrimary,
                }))}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
    </div>
  );
}
