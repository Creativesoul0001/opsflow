'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import {
  CUSTOMER_ASSIGNEE_OPTIONS,
  CUSTOMER_STATUS_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
} from '@/lib/customers/presentation';

/**
 * Search, filter and archive-toggle bar for the customer list.
 *
 * State lives in the URL rather than in React: the server component re-queries
 * with the new parameters, so results are shareable, bookmarkable and work with
 * the back button. Nothing is fetched from the browser.
 */
export function CustomerFilters() {
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
    router.replace(query ? `/customers?${query}` : '/customers');
  }

  const hasFilters =
    urlSearch.length > 0 ||
    searchParams.has('status') ||
    searchParams.has('type') ||
    searchParams.has('assignedTo') ||
    searchParams.has('includeArchived');

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
          <label htmlFor="customer-search" className="sr-only">
            Search customers
          </label>
          <input
            id="customer-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email or company…"
            className="bg-surface text-fg placeholder:text-fg-muted/60 ring-border-subtle focus:ring-brand w-full rounded-lg px-3 py-2 text-sm ring-1"
          />
        </div>

        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Status"
          name="status"
          value={searchParams.get('status') ?? ''}
          options={CUSTOMER_STATUS_OPTIONS}
          onChange={(event) => apply({ status: event.target.value || undefined })}
        />
        <SelectField
          label="Type"
          name="type"
          value={searchParams.get('type') ?? ''}
          options={CUSTOMER_TYPE_OPTIONS}
          onChange={(event) => apply({ type: event.target.value || undefined })}
        />
        <SelectField
          label="Assigned to"
          name="assignedTo"
          value={searchParams.get('assignedTo') ?? ''}
          options={CUSTOMER_ASSIGNEE_OPTIONS}
          onChange={(event) => apply({ assignedTo: event.target.value || undefined })}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-fg-muted flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={searchParams.get('includeArchived') === 'true'}
            onChange={(event) =>
              apply({ includeArchived: event.target.checked ? 'true' : undefined })
            }
            className="ring-border-subtle focus:ring-brand size-4 rounded ring-1"
          />
          Show archived customers
        </label>

        {hasFilters ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              router.replace('/customers');
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    </form>
  );
}
