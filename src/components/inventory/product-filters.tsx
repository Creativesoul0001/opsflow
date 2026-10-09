'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { STOCK_LEVEL_OPTIONS } from '@/lib/inventory/presentation';

/**
 * Search, filter and sort bar for the product list.
 *
 * State lives in the URL rather than in React: the server component re-queries
 * with the new parameters, so results are shareable, bookmarkable and work with
 * the back button. Nothing is fetched from the browser.
 */
export function ProductFilters({
  categories,
}: {
  categories: readonly { id: string; name: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  // Keep the input in step with the URL when navigation changes it (back
  // button, or clearing all filters).
  const urlSearch = searchParams.get('search') ?? '';
  useEffect(() => setSearch(urlSearch), [urlSearch]);

  /** Merges changes into the current query and resets to the first page. */
  function apply(changes: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (!value) params.delete(key);
      else params.set(key, value);
    }

    params.delete('page');

    const queryString = params.toString();
    router.replace(queryString ? `/inventory/products?${queryString}` : '/inventory/products');
  }

  const hasFilters =
    urlSearch.length > 0 ||
    searchParams.has('categoryId') ||
    (searchParams.get('stock') ?? 'all') !== 'all' ||
    (searchParams.get('status') ?? 'ACTIVE') !== 'ACTIVE';

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
          <TextField
            label="Search products"
            name="search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, SKU or description…"
          />
        </div>

        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField
          label="Category"
          name="categoryId"
          value={searchParams.get('categoryId') ?? ''}
          onChange={(event) => apply({ categoryId: event.target.value || undefined })}
          options={[
            { value: '', label: 'All categories' },
            { value: 'none', label: 'Uncategorised' },
            ...categories.map((category) => ({ value: category.id, label: category.name })),
          ]}
        />
        <SelectField
          label="Stock level"
          name="stock"
          value={searchParams.get('stock') ?? 'all'}
          onChange={(event) => apply({ stock: event.target.value })}
          options={STOCK_LEVEL_OPTIONS.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
        <SelectField
          label="Status"
          name="status"
          value={searchParams.get('status') ?? 'ACTIVE'}
          onChange={(event) => apply({ status: event.target.value })}
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'ARCHIVED', label: 'Archived' },
          ]}
        />
      </div>

      {hasFilters ? (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('');
              router.replace('/inventory/products');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
    </form>
  );
}
