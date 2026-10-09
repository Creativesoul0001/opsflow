'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet, TextField } from '@/components/ui/field';
import { ApiRequestError, patchJson, postJson } from '@/lib/client/api';

/**
 * Warehouse create/edit form.
 *
 * The address fields are optional because an organization may operate a single
 * facility and have nothing to distinguish but its code — the only required
 * identifiers are the short code and the name it is known by.
 */
export function WarehouseForm({
  mode,
  warehouseId,
  initialValues,
}: {
  mode: 'create' | 'edit';
  warehouseId?: string;
  initialValues?: {
    code: string;
    name: string;
    addressLine1: string;
    addressLine2: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const [code, setCode] = useState(initialValues?.code ?? '');
  const [name, setName] = useState(initialValues?.name ?? '');
  const [addressLine1, setAddressLine1] = useState(initialValues?.addressLine1 ?? '');
  const [addressLine2, setAddressLine2] = useState(initialValues?.addressLine2 ?? '');
  const [city, setCity] = useState(initialValues?.city ?? '');
  const [state, setState] = useState(initialValues?.state ?? '');
  const [postalCode, setPostalCode] = useState(initialValues?.postalCode ?? '');
  const [country, setCountry] = useState(initialValues?.country ?? '');

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      code: code.trim(),
      name: name.trim(),
      addressLine1: addressLine1.trim() || null,
      addressLine2: addressLine2.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      postalCode: postalCode.trim() || null,
      country: country.trim() || null,
    };

    setPending(true);
    setFormError(null);
    setServerErrors({});

    try {
      if (mode === 'create') {
        const { data } = await postJson<{ warehouse: { id: string } }>('/api/warehouses', payload);
        router.replace(`/inventory/warehouses/${data.warehouse.id}`);
      } else {
        await patchJson(`/api/warehouses/${warehouseId}`, payload);
        router.replace(`/inventory/warehouses/${warehouseId}`);
      }

      router.refresh();
    } catch (error) {
      setPending(false);

      if (error instanceof ApiRequestError) {
        setServerErrors(error.fieldErrors);
        setFormError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    }
  }

  return (
    <form method="post" onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-6">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <FieldSet legend="Warehouse">
        <TextField
          label="Code"
          name="code"
          required
          disabled={pending}
          placeholder="WH-1"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          hint="Short label used in stock tables. Unique within your organization."
          error={serverErrors['code']}
        />
        <TextField
          label="Name"
          name="name"
          required
          disabled={pending}
          placeholder="Main warehouse"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={serverErrors['name']}
        />
      </FieldSet>

      <FieldSet legend="Address">
        <TextField
          label="Address line 1"
          name="addressLine1"
          disabled={pending}
          value={addressLine1}
          onChange={(event) => setAddressLine1(event.target.value)}
          error={serverErrors['addressLine1']}
        />
        <TextField
          label="Address line 2"
          name="addressLine2"
          disabled={pending}
          value={addressLine2}
          onChange={(event) => setAddressLine2(event.target.value)}
          error={serverErrors['addressLine2']}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="City"
            name="city"
            disabled={pending}
            value={city}
            onChange={(event) => setCity(event.target.value)}
            error={serverErrors['city']}
          />
          <TextField
            label="State"
            name="state"
            disabled={pending}
            value={state}
            onChange={(event) => setState(event.target.value)}
            error={serverErrors['state']}
          />
          <TextField
            label="Postal code"
            name="postalCode"
            disabled={pending}
            value={postalCode}
            onChange={(event) => setPostalCode(event.target.value)}
            error={serverErrors['postalCode']}
          />
          <TextField
            label="Country"
            name="country"
            disabled={pending}
            value={country}
            onChange={(event) => setCountry(event.target.value)}
            error={serverErrors['country']}
          />
        </div>
      </FieldSet>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create warehouse' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>

      <p className="text-fg-muted text-sm">
        <Link href="/inventory/warehouses" className="hover:text-fg">
          Back to warehouses
        </Link>
      </p>
    </form>
  );
}
