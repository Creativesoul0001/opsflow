'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SelectField, TextField } from '@/components/ui/field';
import { MOVEMENT_TYPE_OPTIONS } from '@/lib/inventory/presentation';
import { STOCK_MOVEMENT_TYPES } from '@/lib/inventory/validation';

/**
 * Search and filter bar for the stock ledger.
 *
 * State lives in the URL rather than in React, so a filtered ledger is
 * shareable, bookmarkable and works with the back button. The type filter
 * accepts a comma-separated list (`?type=RECEIPT,ADJUSTMENT`) because
 * narrowing to "everything except orders" is a common question.
 */
export function MovementFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') ?? '');

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

    const query = params.toString();
    router.replace(query ? `/inventory/movements?${query}` : '/inventory/movements');
  }

  const currentTypes = (searchParams.get('type') ?? '')
    .split(',')
    .filter((type) => (STOCK_MOVEMENT_TYPES as readonly string[]).includes(type));

  const hasFilters =
    urlSearch.length > 0 ||
    currentTypes.length > 0 ||
    searchParams.has('warehouseId') ||
    searchParams.has('orderId');

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
            label="Search movements"
            name="search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product, warehouse or reason…"
          />
        </div>

        <Button type="submit" variant="secondary">
          Search
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Type"
          name="type"
          value={currentTypes.length === 1 ? (currentTypes[0] ?? '') : ''}
          onChange={(event) => apply({ type: event.target.value || undefined })}
          options={MOVEMENT_TYPE_OPTIONS}
        />
        <SelectField
          label="Source"
          name="source"
          value={
            searchParams.has('orderId')
              ? 'order'
              : searchParams.has('warehouseId')
                ? 'warehouse'
                : ''
          }
          onChange={(event) =>
            apply({
              orderId: event.target.value === 'order' ? 'all' : undefined,
              warehouseId: event.target.value === 'warehouse' ? 'all' : undefined,
            })
          }
          options={[
            { value: '', label: 'Everything' },
            { value: 'order', label: 'Driven by orders' },
            { value: 'warehouse', label: 'At one warehouse' },
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
              router.replace('/inventory/movements');
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : null}
    </form>
  );
}
