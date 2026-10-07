'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { CustomerPicker, type CustomerOption } from '@/components/orders/customer-picker';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet, SelectField, TextArea, TextField } from '@/components/ui/field';
import { ApiRequestError, patchJson, postJson } from '@/lib/client/api';
import { computeOrderTotals, MAX_ORDER_ITEMS } from '@/lib/orders/calculation';
import { formatMinorUnits } from '@/lib/orders/money';
import { formatMoney, formatTaxRate } from '@/lib/orders/presentation';

export interface OrderFormMember {
  userId: string;
  name: string;
}

export interface OrderFormLine {
  productName: string;
  quantity: string;
  unitPrice: string;
  discount: string;
}

export interface OrderFormValues {
  customerId: string;
  items: OrderFormLine[];
  discount: string;
  taxRate: string;
  notes: string;
  assignedUserId: string;
}

interface LineRow extends OrderFormLine {
  /** Stable React key, so removing a middle row cannot shift another's state. */
  key: number;
}

let nextKey = 0;
function blankLine(): LineRow {
  nextKey += 1;
  return { key: nextKey, productName: '', quantity: '1', unitPrice: '', discount: '' };
}

function toRow(line: OrderFormLine): LineRow {
  nextKey += 1;
  return { ...line, key: nextKey };
}

/**
 * Mirrors the Zod `optionalMoney`/`optionalText` transforms: an empty input
 * means "no value", which the arithmetic module reads as zero. Doing this here
 * rather than passing `''` through is what makes the preview agree with what the
 * server will store.
 */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

interface Preview {
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

/**
 * Create and edit form.
 *
 * One component serves both operations so the field set, validation messages and
 * layout cannot drift apart. The difference is the endpoint: create POSTs the
 * whole order, edit PATCHes it and then returns to the order.
 *
 * Totals are previewed with the *same* `computeOrderTotals` the server runs —
 * the module is pure and database-free, so importing it here gives one
 * implementation of the arithmetic instead of a second copy that could disagree.
 * The preview is advisory: the server always recalculates, and any amount a
 * client sends as `subtotal` or `total` is rejected outright by the schema.
 */
export function OrderForm({
  mode,
  orderId,
  members,
  customers,
  customerLabel,
  initialValues,
}: {
  mode: 'create' | 'edit';
  orderId?: string;
  members: readonly OrderFormMember[];
  customers: readonly CustomerOption[];
  /** Label for the order's existing customer, so an edit form shows it at once. */
  customerLabel?: string;
  initialValues?: OrderFormValues;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const [customerId, setCustomerId] = useState(initialValues?.customerId ?? '');
  const [lines, setLines] = useState<LineRow[]>(
    initialValues ? initialValues.items.map(toRow) : [blankLine()],
  );
  const [discount, setDiscount] = useState(initialValues?.discount ?? '');
  const [taxRate, setTaxRate] = useState(initialValues?.taxRate ?? '');
  const [notes, setNotes] = useState(initialValues?.notes ?? '');
  const [assignedUserId, setAssignedUserId] = useState(initialValues?.assignedUserId ?? '');

  const preview = useMemo<Preview | null>(() => {
    try {
      const totals = computeOrderTotals({
        items: lines.map((line) => ({
          productName: line.productName,
          quantity: Number(line.quantity),
          unitPrice: line.unitPrice,
          discount: blankToNull(line.discount),
        })),
        discount: blankToNull(discount),
        taxRate: blankToNull(taxRate),
      });

      return {
        subtotal: formatMinorUnits(totals.subtotalMinor),
        discount: formatMinorUnits(totals.discountMinor),
        tax: formatMinorUnits(totals.taxMinor),
        total: formatMinorUnits(totals.totalMinor),
      };
    } catch {
      // Incomplete rows are the normal state while typing; the summary shows
      // placeholders rather than a half-computed figure.
      return null;
    }
  }, [lines, discount, taxRate]);

  /** Server issues split between line rows and single-value fields. */
  const { lineErrors, fieldErrors, itemsError } = useMemo(() => {
    const rows: Record<number, Record<string, string>> = {};
    const fields: Record<string, string> = {};
    let items: string | undefined;

    for (const [path, message] of Object.entries(serverErrors)) {
      const match = /^items\.(\d+)\.(.+)$/.exec(path);
      const index = match?.[1];
      const field = match?.[2];

      if (index !== undefined && field !== undefined) {
        (rows[Number(index)] ??= {})[field] = message;
      } else if (path === 'items') {
        items = message;
      } else {
        fields[path] = message;
      }
    }

    return { lineErrors: rows, fieldErrors: fields, itemsError: items };
  }, [serverErrors]);

  function updateLine(index: number, patch: Partial<OrderFormLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload = {
      customerId,
      items: lines.map((line) => ({
        productName: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: blankToNull(line.discount),
      })),
      discount: blankToNull(discount),
      taxRate: blankToNull(taxRate),
      notes: blankToNull(notes),
      // Only create accepts an assignee; changing it later is its own action
      // with its own permission.
      ...(mode === 'create' ? { assignedUserId: assignedUserId || null } : {}),
    };

    setPending(true);
    setFormError(null);
    setServerErrors({});

    try {
      if (mode === 'create') {
        const { data } = await postJson<{ order: { id: string } }>('/api/orders', payload);
        router.replace(`/orders/${data.order.id}`);
      } else {
        await patchJson(`/api/orders/${orderId}`, payload);
        router.replace(`/orders/${orderId}`);
      }

      // Refresh so the server component re-reads from Postgres rather than
      // rendering a cached tree.
      router.refresh();
    } catch (error) {
      setPending(false);

      if (error instanceof ApiRequestError) {
        setServerErrors(error.fieldErrors);
        // Inline messages replace the banner whenever there are any to show;
        // otherwise the banner carries the only explanation available.
        setFormError(Object.keys(error.fieldErrors).length > 0 ? null : error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    }
  }

  const headline = formError ?? itemsError;

  return (
    // `method="post"` keeps a pre-hydration native submit from exposing order
    // details as URL query parameters.
    <form method="post" onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-6">
      {headline ? <Alert tone="error">{headline}</Alert> : null}

      <FieldSet legend="Customer">
        <CustomerPicker
          value={customerId}
          onChange={setCustomerId}
          initialOptions={customers}
          currentLabel={customerLabel}
          disabled={pending}
          error={fieldErrors['customerId']}
        />
      </FieldSet>

      <FieldSet legend="Line items">
        <div className="space-y-3">
          {lines.map((line, index) => {
            const errors = lineErrors[index] ?? {};
            return (
              <div key={line.key} className="border-border-subtle space-y-3 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-fg-muted text-xs font-semibold tracking-wide uppercase">
                    Item {index + 1}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending || lines.length === 1}
                    onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    label="Item name"
                    name={`items.${index}.productName`}
                    required
                    disabled={pending}
                    placeholder="Consulting hours"
                    value={line.productName}
                    onChange={(event) => updateLine(index, { productName: event.target.value })}
                    error={errors['productName']}
                  />
                  <TextField
                    label="Quantity"
                    name={`items.${index}.quantity`}
                    inputMode="numeric"
                    required
                    disabled={pending}
                    value={line.quantity}
                    onChange={(event) => updateLine(index, { quantity: event.target.value })}
                    error={errors['quantity']}
                  />
                  <TextField
                    label="Unit price"
                    name={`items.${index}.unitPrice`}
                    inputMode="decimal"
                    required
                    disabled={pending}
                    placeholder="0.00"
                    value={line.unitPrice}
                    onChange={(event) => updateLine(index, { unitPrice: event.target.value })}
                    error={errors['unitPrice']}
                  />
                  <TextField
                    label="Line discount"
                    name={`items.${index}.discount`}
                    inputMode="decimal"
                    disabled={pending}
                    placeholder="0.00"
                    value={line.discount}
                    onChange={(event) => updateLine(index, { discount: event.target.value })}
                    hint="Optional. Off this line only."
                    error={errors['discount']}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="secondary"
            size="sm"
            disabled={pending || lines.length >= MAX_ORDER_ITEMS}
            onClick={() => setLines((current) => [...current, blankLine()])}
          >
            Add line
          </Button>
          {lines.length >= MAX_ORDER_ITEMS ? (
            <p className="text-fg-muted text-xs">
              An order can hold at most {MAX_ORDER_ITEMS} line items.
            </p>
          ) : null}
        </div>
      </FieldSet>

      <FieldSet legend="Adjustments">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Order discount"
            name="discount"
            inputMode="decimal"
            disabled={pending}
            placeholder="0.00"
            value={discount}
            onChange={(event) => setDiscount(event.target.value)}
            hint="Taken off the subtotal before tax."
            error={fieldErrors['discount']}
          />
          <TextField
            label="Tax rate (%)"
            name="taxRate"
            inputMode="decimal"
            disabled={pending}
            placeholder="0"
            value={taxRate}
            onChange={(event) => setTaxRate(event.target.value)}
            hint="Between 0 and 100, for example 18 or 18.5."
            error={fieldErrors['taxRate']}
          />
        </div>
      </FieldSet>

      <FieldSet legend="Summary">
        <div className="bg-surface-muted rounded-lg p-4">
          <dl className="text-sm">
            <div className="flex justify-between py-1">
              <dt className="text-fg-muted">Subtotal</dt>
              <dd className="text-fg font-medium">
                {preview ? formatMoney(preview.subtotal) : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-fg-muted">Discount</dt>
              <dd className="text-fg font-medium">
                {preview ? `− ${formatMoney(preview.discount)}` : '—'}
              </dd>
            </div>
            <div className="flex justify-between py-1">
              <dt className="text-fg-muted">Tax ({formatTaxRate(blankToNull(taxRate) ?? '0')})</dt>
              <dd className="text-fg font-medium">{preview ? formatMoney(preview.tax) : '—'}</dd>
            </div>
            <div className="border-border-subtle mt-2 flex justify-between border-t pt-2">
              <dt className="text-fg font-semibold">Total</dt>
              <dd className="text-fg text-base font-semibold">
                {preview ? formatMoney(preview.total) : '—'}
              </dd>
            </div>
          </dl>
          <p className="text-fg-muted mt-3 text-xs">
            {preview
              ? 'Calculated from the line items above. The order is recalculated on save.'
              : 'Fill in every line with a name, a whole quantity and a price to see totals.'}
          </p>
        </div>
      </FieldSet>

      <FieldSet legend="Details">
        <TextArea
          label="Notes"
          name="notes"
          disabled={pending}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          hint="Visible to everyone in your organization with order access."
          error={fieldErrors['notes']}
        />

        {mode === 'create' ? (
          <SelectField
            label="Assign to"
            name="assignedUserId"
            disabled={pending}
            value={assignedUserId}
            onChange={(event) => setAssignedUserId(event.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...members.map((member) => ({ value: member.userId, label: member.name })),
            ]}
            hint="Only active members of this organization can be assigned."
            error={fieldErrors['assignedUserId']}
          />
        ) : null}
      </FieldSet>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? mode === 'create'
              ? 'Creating order…'
              : 'Saving changes…'
            : mode === 'create'
              ? 'Create order'
              : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>

      {mode === 'create' ? (
        <p className="text-fg-muted text-xs">
          Need someone who is not listed?{' '}
          <Link href="/customers/new" className="text-brand hover:text-fg">
            Add the customer first
          </Link>
          .
        </p>
      ) : null}
    </form>
  );
}
