'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet, SelectField, TextArea, TextField } from '@/components/ui/field';
import { ApiRequestError, patchJson, postJson } from '@/lib/client/api';

/** The only category fields the form actually needs. */
export interface CategoryOption {
  id: string;
  name: string;
}

/**
 * Product create/edit form.
 *
 * One component serves both operations so the fields and validation messages
 * cannot drift apart; the only difference is the endpoint. As with Orders, the
 * form never submits a computed value: totals, quantities and balances are
 * derived on the server, so there is nothing here a client could claim.
 *
 * Prices are major-unit decimal strings, matching the wire format the Orders
 * module already uses, so the same "never touch a float" rule covers both.
 */
export function ProductForm({
  mode,
  productId,
  categories,
  initialValues,
}: {
  mode: 'create' | 'edit';
  productId?: string;
  categories: readonly CategoryOption[];
  initialValues?: {
    sku: string;
    name: string;
    description: string;
    categoryId: string;
    unitPrice: string;
    costPrice: string;
    reorderThreshold: string;
    unit: string;
  };
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const [sku, setSku] = useState(initialValues?.sku ?? '');
  const [name, setName] = useState(initialValues?.name ?? '');
  const [description, setDescription] = useState(initialValues?.description ?? '');
  const [categoryId, setCategoryId] = useState(initialValues?.categoryId ?? '');
  const [unitPrice, setUnitPrice] = useState(initialValues?.unitPrice ?? '');
  const [costPrice, setCostPrice] = useState(initialValues?.costPrice ?? '');
  const [reorderThreshold, setReorderThreshold] = useState(initialValues?.reorderThreshold ?? '0');
  const [unit, setUnit] = useState(initialValues?.unit ?? 'pcs');

  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'Uncategorised' },
      ...categories.map((category) => ({ value: category.id, label: category.name })),
    ],
    [categories],
  );

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      sku: sku.trim(),
      name: name.trim(),
      description: description.trim() || null,
      categoryId: categoryId || null,
      unitPrice: unitPrice.trim(),
      costPrice: costPrice.trim() || null,
      reorderThreshold: reorderThreshold.trim(),
      unit: unit.trim(),
    };

    setPending(true);
    setFormError(null);
    setServerErrors({});

    try {
      if (mode === 'create') {
        const { data } = await postJson<{ product: { id: string } }>('/api/products', payload);
        router.replace(`/inventory/products/${data.product.id}`);
      } else {
        await patchJson(`/api/products/${productId}`, payload);
        router.replace(`/inventory/products/${productId}`);
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

      <FieldSet legend="Product">
        <TextField
          label="SKU"
          name="sku"
          required
          disabled={pending}
          placeholder="BEV-COLA-500"
          value={sku}
          onChange={(event) => setSku(event.target.value)}
          hint="Letters, numbers, dots, dashes or underscores. Unique within your organization."
          error={serverErrors['sku']}
        />
        <TextField
          label="Name"
          name="name"
          required
          disabled={pending}
          placeholder="Cola 500ml"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={serverErrors['name']}
        />
        <TextArea
          label="Description"
          name="description"
          disabled={pending}
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          hint="Optional. Internal notes about the product."
          error={serverErrors['description']}
        />
      </FieldSet>

      <FieldSet legend="Pricing">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Unit price"
            name="unitPrice"
            inputMode="decimal"
            required
            disabled={pending}
            placeholder="0.00"
            value={unitPrice}
            onChange={(event) => setUnitPrice(event.target.value)}
            hint="Selling price, in your organization's currency."
            error={serverErrors['unitPrice']}
          />
          <TextField
            label="Cost price"
            name="costPrice"
            inputMode="decimal"
            disabled={pending}
            placeholder="0.00"
            value={costPrice}
            onChange={(event) => setCostPrice(event.target.value)}
            hint="Optional. What this product costs you."
            error={serverErrors['costPrice']}
          />
        </div>
      </FieldSet>

      <FieldSet legend="Stock rules">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Reorder threshold"
            name="reorderThreshold"
            inputMode="numeric"
            disabled={pending}
            value={reorderThreshold}
            onChange={(event) => setReorderThreshold(event.target.value)}
            hint="Reported as low stock at or below this. Zero means never."
            error={serverErrors['reorderThreshold']}
          />
          <TextField
            label="Unit"
            name="unit"
            required
            maxLength={20}
            disabled={pending}
            placeholder="pcs"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            hint="What one unit is counted in, e.g. pcs, kg, box."
            error={serverErrors['unit']}
          />
        </div>
        <SelectField
          label="Category"
          name="categoryId"
          disabled={pending}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          options={categoryOptions}
          error={serverErrors['categoryId']}
        />
      </FieldSet>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : mode === 'create' ? 'Create product' : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>

      <p className="text-fg-muted text-sm">
        <Link href="/inventory/products" className="hover:text-fg">
          Back to products
        </Link>
      </p>
    </form>
  );
}
