'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { ORDER_ASSIGNEE_OPTIONS, ORDER_STATUS_OPTIONS } from '@/lib/orders/presentation';

/**
 * Search, filter and sort bar for the order list.
 *
 * State lives in the URL rather than in React: the server component re-queries
 * with the new parameters, so results are shareable, bookmarkable and work with
 * the back button. Nothing is fetched from the browser.
 */
export function OrderFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  // Keep the input in step with the URL when navigation changes it (back button,
  // or clearing all filters).
  const urlSearch = searchParams.get('search') ?? '';
  useEffect(() => setSearch(urlSearch), [urlSearch]);

  /** Merges changes into the current query and resets to the first page. */
  function apply(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }

    // Any change to the filter set invalidates the current page offset.
    params.delete('page');

    const query = params.toString();
    router.replace(query ? `/orders?${query}` : '/orders');
  }

  const hasFilters =
    urlSearch.length > 0 ||
    searchParams.has('status') ||
    searchParams.has('assignedTo') ||
    searchParams.has('customerId');

  return (
    <form
      method="post"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        apply({ search: search.trim() || undefined });
      }}
      role="search"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="order-search" className="sr-only">
            Search orders
          </label>
          <input
            id="order-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search order number, customer name or email…"
            className="bg-surface text-fg placeholder:text-fg-muted/60 ring-border-subtle focus:ring-brand w-full rounded-lg px-3 py-2 text-sm ring-1"
          />
        </div>

        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Status"
          name="status"
          value={searchParams.get('status') ?? ''}
          options={ORDER_STATUS_OPTIONS}
          onChange={(event) => apply({ status: event.target.value || undefined })}
        />
        <SelectField
          label="Assigned to"
          name="assignedTo"
          value={searchParams.get('assignedTo') ?? ''}
          options={ORDER_ASSIGNEE_OPTIONS}
          onChange={(event) => apply({ assignedTo: event.target.value || undefined })}
        />
      </div>

      {hasFilters ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              router.replace('/orders');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
    </form>
  );
}
