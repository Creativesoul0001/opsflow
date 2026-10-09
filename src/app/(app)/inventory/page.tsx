import Link from 'next/link';

import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatStock } from '@/lib/inventory/presentation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { getInventoryStats } from '@/lib/services/inventory.service';
import { listLowStock } from '@/lib/services/stock.service';
import { StatCard } from '@/components/dashboard/stat-card';

export const metadata = { title: 'Inventory' };

/**
 * `GET /inventory` — the module overview.
 *
 * The numbers are real database rows scoped to this organization: a member sees
 * their own stock, never another tenant's. A member without `inventory:read`
 * never reaches this page, because the shell hides the module and the page
 * itself asserts the permission.
 */
export default async function InventoryOverviewPage() {
  const context = await getAuthorizationContext();
  assertPermission(context!, PERMISSIONS.INVENTORY_READ);

  const [stats, reorder] = await Promise.all([
    getInventoryStats(context!),
    listLowStock(context!, { limit: 8 }),
  ]);

  const canReadProducts = hasPermission(context!, PERMISSIONS.INVENTORY_READ);
  const units = stats.totalStockUnits;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Inventory</h1>
          <p className="text-fg-muted mt-1 text-sm">
            Products, stock levels, warehouses and every movement between them.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canReadProducts && hasPermission(context!, PERMISSIONS.INVENTORY_PRODUCT_CREATE) ? (
            <Link href="/inventory/products/new">
              <Button>New product</Button>
            </Link>
          ) : null}
          {hasPermission(context!, PERMISSIONS.INVENTORY_STOCK_ADJUST) ? (
            <Link href="/inventory/movements">
              <Button variant="secondary">Stock movements</Button>
            </Link>
          ) : null}
        </div>
      </header>

      <section aria-label="Inventory metrics">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Total products"
            description="Active catalogue entries."
            value={formatStock(stats.totalProducts)}
            isPlaceholder={false}
          />
          <StatCard
            label="Total stock units"
            description="Across every warehouse."
            value={formatStock(units)}
            isPlaceholder={false}
          />
          <StatCard
            label="Low stock"
            description="At or below the reorder threshold."
            value={formatStock(stats.lowStock)}
            isPlaceholder={false}
          />
          <StatCard
            label="Out of stock"
            description="Nothing on hand anywhere."
            value={formatStock(stats.outOfStock)}
            isPlaceholder={false}
          />
          <StatCard
            label="Warehouses"
            description="Active locations."
            value={formatStock(stats.warehouses)}
            isPlaceholder={false}
          />
        </div>
      </section>

      <section aria-label="Reorder report" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-fg text-lg font-semibold tracking-tight">Needs attention</h2>
          <Link href="/inventory/products?stock=low" className="text-brand hover:text-fg text-sm">
            View all low-stock products
          </Link>
        </div>

        <Card>
          {reorder.rows.length === 0 ? (
            <EmptyState
              title="Nothing needs restocking"
              description="Every product with a reorder point is above its threshold. Products without a threshold are never reported."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-2xl border-collapse text-sm">
                <thead className="border-border-subtle bg-surface-muted border-b">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase"
                    >
                      Product
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-semibold tracking-wide uppercase"
                    >
                      On hand
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-semibold tracking-wide uppercase"
                    >
                      Threshold
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-right text-xs font-semibold tracking-wide uppercase"
                    >
                      Warehouses
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {reorder.rows.map((row) => (
                    <tr key={row.productId} className="border-border-subtle border-b last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/inventory/products/${row.productId}`}
                          className="text-fg hover:text-brand font-medium"
                        >
                          {row.name}
                        </Link>
                        <div className="text-fg-muted/70 text-xs">{row.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span
                          className={
                            row.totalQuantity === 0 ? 'text-danger font-medium' : 'text-fg'
                          }
                        >
                          {formatStock(row.totalQuantity)} {row.unit}
                        </span>
                      </td>
                      <td className="text-fg-muted px-4 py-3 text-right">
                        {formatStock(row.reorderThreshold)} {row.unit}
                      </td>
                      <td className="text-fg-muted px-4 py-3 text-right">
                        {row.warehouseCount === 0 ? 'None yet' : formatStock(row.warehouseCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Products" description="The catalogue, with live stock levels." />
          <CardBody className="space-y-3 text-sm">
            <p className="text-fg-muted">
              Every quantity change writes a movement, so a balance can always be traced back to the
              receipts, adjustments, transfers and orders that produced it.
            </p>
            <Link href="/inventory/products" className="text-brand hover:text-fg">
              Browse products
            </Link>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Warehouses" description="Where the stock physically lives." />
          <CardBody className="space-y-3 text-sm">
            <p className="text-fg-muted">
              Confirming an order takes stock from your primary warehouse first, then wherever the
              product is most plentiful.
            </p>
            <Link href="/inventory/warehouses" className="text-brand hover:text-fg">
              Manage warehouses
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
