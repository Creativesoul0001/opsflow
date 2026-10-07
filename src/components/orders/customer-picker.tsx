'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ApiRequestError, getJson } from '@/lib/client/api';

export interface CustomerOption {
  id: string;
  /** `Acme Ltd` for a company, otherwise the person's name. */
  label: string;
  /** Shown under the label so two people with the same name are distinguishable. */
  detail: string;
}

interface CustomerRow {
  id: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  email: string;
}

function toOption(row: CustomerRow): CustomerOption {
  const person = `${row.firstName} ${row.lastName}`.trim();
  return {
    id: row.id,
    label: row.companyName ?? person,
    detail: row.companyName ? `${person} · ${row.email}` : row.email,
  };
}

/**
 * Customer picker for the order form.
 *
 * A `<select>` cannot search, and an order form must reach every customer an
 * organization has rather than the first page of a static list, so this fetches
 * matches from the existing customer endpoint as the member types. The endpoint
 * is the same one the customer list uses, so the tenant boundary and the
 * `customers:read` requirement are already enforced there — this component adds
 * no authority of its own.
 *
 * The current selection is always kept in the option list even when it would not
 * match the search, so re-rendering mid-typing can never silently clear it.
 */
export function CustomerPicker({
  value,
  onChange,
  initialOptions,
  currentLabel,
  disabled,
  error,
}: {
  value: string;
  onChange: (customerId: string) => void;
  initialOptions: readonly CustomerOption[];
  /** Label for the already-chosen customer, so an edit form shows it immediately. */
  currentLabel?: string;
  disabled?: boolean;
  error?: string;
}) {
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<readonly CustomerOption[]>(initialOptions);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0);

  // Discard any in-flight search when the component unmounts so a late response
  // cannot set state on a form that has gone away.
  useEffect(
    () => () => {
      if (debounce.current) clearTimeout(debounce.current);
      requestId.current += 1;
    },
    [],
  );

  function search(query: string) {
    const id = ++requestId.current;
    const trimmed = query.trim();

    if (trimmed.length === 0) {
      setSearching(false);
      setSearchError(null);
      setOptions(initialOptions);
      return;
    }

    const params = new URLSearchParams({
      search: trimmed,
      status: 'ACTIVE',
      limit: '20',
      sort: 'name',
      order: 'asc',
    });

    setSearching(true);

    void getJson<{ customers: CustomerRow[] }>(`/api/customers?${params.toString()}`)
      .then(({ data }) => {
        // A newer keystroke already superseded this response.
        if (id !== requestId.current) return;
        setOptions(data.customers.map(toOption));
        setSearchError(null);
      })
      .catch((cause: unknown) => {
        if (id !== requestId.current) return;
        setOptions(initialOptions);
        setSearchError(
          cause instanceof ApiRequestError
            ? cause.message
            : 'Customers could not be searched right now.',
        );
      })
      .finally(() => {
        if (id === requestId.current) setSearching(false);
      });
  }

  const current = currentLabel
    ? [{ id: value, label: currentLabel, detail: 'Currently selected' }]
    : [];
  const seen = new Set<string>();
  const merged = [...current, ...options, ...initialOptions].filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="customer-search" className="text-fg block text-sm font-medium">
          Find customer
        </label>
        <div className="flex gap-2">
          <input
            id="customer-search"
            type="search"
            value={term}
            disabled={disabled}
            placeholder="Search by name or email…"
            onChange={(event) => {
              const next = event.target.value;
              setTerm(next);
              if (debounce.current) clearTimeout(debounce.current);
              debounce.current = setTimeout(() => search(next), 250);
            }}
            className="bg-surface text-fg placeholder:text-fg-muted/60 ring-border-subtle focus:ring-brand disabled:bg-surface-muted w-full rounded-lg px-3 py-2 text-sm ring-1 disabled:cursor-not-allowed"
          />
          {searching ? <Spinner className="text-fg-muted size-5 self-center" /> : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="customerId" className="text-fg block text-sm font-medium">
          Customer <span className="text-danger">*</span>
        </label>
        <select
          id="customerId"
          name="customerId"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'customerId-error' : undefined}
          className={`text-fg disabled:bg-surface-muted w-full appearance-none rounded-lg bg-none px-3 py-2 text-sm ring-1 transition-colors disabled:cursor-not-allowed ${
            error ? 'bg-surface ring-danger' : 'bg-surface ring-border-subtle focus:ring-brand'
          }`}
        >
          <option value="">Select a customer</option>
          {merged.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.detail ? ` — ${option.detail}` : ''}
            </option>
          ))}
        </select>
        {error ? (
          <p id="customerId-error" className="text-danger text-xs">
            {error}
          </p>
        ) : (
          <p className="text-fg-muted text-xs">
            Only active customers of this organization can be ordered against.
          </p>
        )}
      </div>

      {searchError ? <Alert tone="error">{searchError}</Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-fg-muted text-xs">
          {term.trim().length === 0
            ? `${initialOptions.length} customer${initialOptions.length === 1 ? '' : 's'} listed.`
            : `${merged.length} match${merged.length === 1 ? '' : 'es'}.`}
        </p>
        <Link href="/customers/new">
          <Button variant="ghost" size="sm" disabled={disabled}>
            Add a customer
          </Button>
        </Link>
      </div>
    </div>
  );
}
