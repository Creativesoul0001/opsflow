import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCount, formatMoney, formatStock } from '@/lib/inventory/presentation';
import type { ProductDto } from '@/lib/services/inventory.service';
import type { ProductListQuery, ProductSort } from '@/lib/inventory/validation';

const HEADING_CLASS = 'px-4 py-3 text-left text-xs font-semibold tracking-wide uppercase';

/**
 * Stock-health chip for one product.
 *
 * Colour is decided here from the numbers the server already returned, so the
 * list, the dashboard and the detail page agree: empty is dangerous, at or below
 * the threshold is a warning, otherwise fine.
 */
export function StockLevelBadge({
  totalStock,
  reorderThreshold,
  unit,
}: {
  totalStock: number;
  reorderThreshold: number;
  unit: string;
}) {
  if (totalStock === 0) {
    return <Badge tone="danger">Out of stock</Badge>;
  }

  if (reorderThreshold > 0 && totalStock <= reorderThreshold) {
    return <Badge tone="warning">Low · {formatStock(reorderThreshold - totalStock)} short</Badge>;
  }

  return (
    <Badge tone="success">
      {formatStock(totalStock)} {unit}
    </Badge>
  );
}

/** Query string that keeps every active filter and swaps only the sort. */
function sortHref(basePath: string, query: ProductListQuery, sortKey: string): string {
  const params = new URLSearchParams();

  if (query.search) params.set('search', query.search);
  if (query.categoryId) params.set('categoryId', query.categoryId);
  if (query.status && query.status !== 'ACTIVE') params.set('status', query.status);
  if (query.stock && query.stock !== 'all') params.set('stock', query.stock);

  const nextOrder = query.sort === sortKey && query.order === 'asc' ? 'desc' : 'asc';
  params.set('sort', sortKey);
  params.set('order', nextOrder);

  return `${basePath}?${params.toString()}`;
}

function SortHeader({
  label,
  sortKey,
  query,
  basePath,
}: {
  label: string;
  sortKey: ProductSort;
  query: ProductListQuery;
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
 * Product list table.
 *
 * Stock levels come from the same read as the products themselves, so the
 * table renders one page in one round trip rather than fetching per-row
 * quantities.
 */
export function ProductTable({
  products,
  query,
  basePath = '/inventory/products',
}: {
  products: readonly ProductDto[];
  query: ProductListQuery;
  basePath?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-4xl border-collapse text-sm">
        <thead className="border-border-subtle bg-surface-muted border-b">
          <tr>
            <SortHeader label="Product" sortKey="name" query={query} basePath={basePath} />
            <th scope="col" className={HEADING_CLASS}>
              SKU
            </th>
            <th scope="col" className={HEADING_CLASS}>
              Category
            </th>
            <SortHeader label="Price" sortKey="unitPrice" query={query} basePath={basePath} />
            <th scope="col" className={HEADING_CLASS}>
              Stock
            </th>
            <th scope="col" className={HEADING_CLASS}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-border-subtle border-b last:border-0">
              <td className="px-4 py-3">
                <Link
                  href={`${basePath}/${product.id}`}
                  className="text-fg hover:text-brand font-medium"
                >
                  {product.name}
                </Link>
                {product.description ? (
                  <div className="text-fg-muted/70 max-w-64 truncate text-xs">
                    {product.description}
                  </div>
                ) : null}
              </td>
              <td className="text-fg-muted px-4 py-3 font-mono text-xs">{product.sku}</td>
              <td className="text-fg-muted px-4 py-3">
                {product.categoryName ?? <span className="text-fg-muted/60">Uncategorised</span>}
              </td>
              <td className="px-4 py-3 whitespace-nowrap">
                <span className="text-fg font-medium">{formatMoney(product.unitPrice)}</span>
                {product.costPrice ? (
                  <div className="text-fg-muted/70 text-xs">
                    cost {formatMoney(product.costPrice)}
                  </div>
                ) : null}
              </td>
              <td className="px-4 py-3">
                <StockLevelBadge
                  totalStock={product.totalStock}
                  reorderThreshold={product.reorderThreshold}
                  unit={product.unit}
                />
              </td>
              <td className="px-4 py-3 text-right">
                <Link href={`${basePath}/${product.id}`}>
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

export { formatCount };
