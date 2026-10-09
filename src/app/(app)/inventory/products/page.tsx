import Link from 'next/link';
import { Suspense } from 'react';

import { ProductFilters } from '@/components/inventory/product-filters';
import { ProductPagination } from '@/components/inventory/product-pagination';
import { ProductTable } from '@/components/inventory/product-table';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/spinner';
import { getAuthorizationContext } from '@/lib/auth/session';
import { formatCount } from '@/lib/inventory/presentation';
import { coerceProductListQuery } from '@/lib/inventory/validation';
import { assertPermission, hasPermission } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { listProductCategories, listProducts } from '@/lib/services/inventory.service';

export const metadata = { title: 'Products' };

/**
 * `GET /inventory/products` — the product list.
 *
 * Reads its filters, search term, sort and page from the URL and queries through
 * the service, which re-checks `inventory:read` and pins the organization. The
 * component therefore has no authorization logic of its own — hiding the "New
 * product" button is presentation, and the service is the enforcement point.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthorizationContext();

  // Defence in depth: the shell hides modules the member cannot use, but a
  // direct URL must be rejected by the server too.
  assertPermission(context!, PERMISSIONS.INVENTORY_READ);

  const query = coerceProductListQuery(await searchParams);
  const { products, pagination } = await listProducts(context!, query);

  // The category picker is built on the server, so it can never be wider than
  // this organization and never offers a grouping the member has archived.
  const categories = await listProductCategories(context!);
  const canCreate = hasPermission(context!, PERMISSIONS.INVENTORY_PRODUCT_CREATE);

  const isFiltered =
    Boolean(query.search) ||
    Boolean(query.categoryId) ||
    query.stock !== 'all' ||
    query.status !== 'ACTIVE';

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">Products</h1>
          <p className="text-fg-muted mt-1 text-sm">
            {pagination.total === 0
              ? 'No products yet'
              : `${formatCount(pagination.total)} product${pagination.total === 1 ? '' : 's'} in this organization`}
          </p>
        </div>

        {canCreate ? (
          <Link href="/inventory/products/new">
            <Button>New product</Button>
          </Link>
        ) : null}
      </header>

      <Card className="p-5">
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <ProductFilters categories={categories} />
        </Suspense>
      </Card>

      <Card>
        {products.length === 0 ? (
          <EmptyState
            title={isFiltered ? 'No products match these filters' : 'No products yet'}
            description={
              isFiltered
                ? 'Try a different search term, or clear the filters to see every product.'
                : canCreate
                  ? 'Create your first product to start tracking stock, categories and movements.'
                  : 'Products created by your team will appear here.'
            }
            action={
              isFiltered ? (
                <Link href="/inventory/products">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              ) : canCreate ? (
                <Link href="/inventory/products/new">
                  <Button>New product</Button>
                </Link>
              ) : null
            }
          />
        ) : (
          <>
            <ProductTable products={products} query={query} />
            <Suspense fallback={null}>
              <ProductPagination pagination={pagination} />
            </Suspense>
          </>
        )}
      </Card>
    </div>
  );
}
