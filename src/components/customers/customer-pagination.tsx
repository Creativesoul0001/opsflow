'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { formatCount } from '@/lib/customers/presentation';
import type { Pagination } from '@/lib/customers/query';

/**
 * Result pagination.
 *
 * Every control rewrites only the `page` parameter, so the active search and
 * filters survive paging, and the browser's back button walks the history of
 * pages the member actually visited.
 */
export function CustomerPagination({ pagination }: { pagination: Pagination }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const { page, limit, total, totalPages, hasNextPage, hasPreviousPage } = pagination;

  if (total === 0) return null;

  function goTo(nextPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage <= 1) params.delete('page');
    else params.set('page', String(nextPage));

    const query = params.toString();
    router.replace(query ? `/customers?${query}` : '/customers');
  }

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <nav
      aria-label="Customers pagination"
      className="border-border-subtle flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3"
    >
      <p className="text-fg-muted text-sm">
        Showing <span className="text-fg font-medium">{formatCount(first)}</span>–
        <span className="text-fg font-medium">{formatCount(last)}</span> of{' '}
        <span className="text-fg font-medium">{formatCount(total)}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasPreviousPage}
          onClick={() => goTo(page - 1)}
        >
          Previous
        </Button>
        <span className="text-fg-muted text-sm">
          Page {formatCount(page)} of {formatCount(Math.max(totalPages, 1))}
        </span>
        <Button variant="secondary" size="sm" disabled={!hasNextPage} onClick={() => goTo(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}