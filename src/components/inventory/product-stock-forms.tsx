'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet, SelectField, TextArea, TextField } from '@/components/ui/field';
import { ApiRequestError, postJson } from '@/lib/client/api';

interface WarehouseOption {
  id: string;
  code: string;
  name: string;
  isPrimary: boolean;
}

/**
 * Stock forms for one product.
 *
 * Both operations post to their own endpoint, which does the real work inside a
 * transaction with a row lock. Nothing here is authoritative: the server
 * re-reads the balance under the lock, so a stale page or a second tab cannot
 * write a quantity that was computed from numbers that have since changed.
 */
export function ProductStockForms({
  productId,
  unit,
  totalStock,
  canAdjust,
  canTransfer,
  warehouses,
}: {
  productId: string;
  unit: string;
  totalStock: number;
  canAdjust: boolean;
  canTransfer: boolean;
  warehouses: readonly WarehouseOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [mode, setMode] = useState<'receipt' | 'adjustment' | 'transfer'>('receipt');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');

  // Default the warehouse to the primary one, which is where the product is most
  // likely to be counted, without overriding a choice the member already made.
  useEffect(() => {
    if (!warehouseId) {
      const primary = warehouses.find((warehouse) => warehouse.isPrimary) ?? warehouses[0];
      if (primary) setWarehouseId(primary.id);
    }
    if (!toWarehouseId) {
      const first = warehouses.find((warehouse) => warehouse.id !== warehouseId);
      if (first) setToWarehouseId(first.id);
    }
  }, [warehouses, warehouseId, toWarehouseId]);

  if (!canAdjust && !canTransfer) return null;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setPending(mode);
    setError(null);
    setFieldErrors({});

    const payload =
      mode === 'transfer'
        ? {
            productId,
            fromWarehouseId: warehouseId,
            toWarehouseId,
            quantity: Number(quantity),
            reason: reason.trim() || null,
          }
        : {
            productId,
            warehouseId,
            quantity:
              mode === 'adjustment'
                ? quantity.trim().startsWith('-')
                  ? Number(quantity)
                  : Math.abs(Number(quantity))
                : Math.abs(Number(quantity)),
            reason: reason.trim() || null,
          };

    try {
      if (mode === 'transfer') {
        await postJson('/api/stock/transfers', payload);
      } else if (mode === 'adjustment') {
        await postJson('/api/stock/adjustments', payload);
      } else {
        await postJson('/api/stock/receipts', payload);
      }

      setReason('');
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        setFieldErrors(cause.fieldErrors);
        setError(Object.keys(cause.fieldErrors).length > 0 ? null : cause.message);
      } else {
        setError('The stock could not be updated. Please try again.');
      }
    } finally {
      setPending(null);
    }
  }

  if (warehouses.length === 0) {
    return (
      <Alert tone="info" title="No active warehouses">
        Stock cannot be recorded until your organization has at least one active warehouse.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {canAdjust ? (
        <form
          method="post"
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="space-y-4"
        >
          <FieldSet legend="Record stock">
            <SelectField
              label="Movement type"
              name="mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
              disabled={pending !== null}
              options={[
                { value: 'receipt', label: 'Receive stock' },
                { value: 'adjustment', label: 'Adjust balance' },
                ...(canTransfer
                  ? [{ value: 'transfer', label: 'Transfer to another warehouse' }]
                  : []),
              ]}
            />

            <SelectField
              label={mode === 'transfer' ? 'From warehouse' : 'Warehouse'}
              name="warehouseId"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              disabled={pending !== null}
              options={warehouses.map((warehouse) => ({
                value: warehouse.id,
                label: `${warehouse.name} (${warehouse.code})`,
              }))}
            />

            {mode === 'transfer' ? (
              <SelectField
                label="To warehouse"
                name="toWarehouseId"
                value={toWarehouseId}
                onChange={(event) => setToWarehouseId(event.target.value)}
                disabled={pending !== null}
                error={fieldErrors['toWarehouseId']}
                options={warehouses
                  .filter((warehouse) => warehouse.id !== warehouseId)
                  .map((warehouse) => ({
                    value: warehouse.id,
                    label: `${warehouse.name} (${warehouse.code})`,
                  }))}
              />
            ) : null}

            <TextField
              label="Quantity"
              name="quantity"
              inputMode="numeric"
              required
              disabled={pending !== null}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              hint={
                mode === 'adjustment'
                  ? `Use a negative number to reduce the balance. Currently ${totalStock} ${unit}.`
                  : `How many ${unit} are being recorded.`
              }
              error={fieldErrors['quantity']}
            />

            <TextArea
              label={mode === 'adjustment' ? 'Reason' : 'Note'}
              name="reason"
              required={mode === 'adjustment'}
              maxLength={500}
              disabled={pending !== null}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              hint={
                mode === 'adjustment'
                  ? 'Required. Recorded on the movement so the ledger explains the gap.'
                  : 'Optional. Recorded on the movement.'
              }
              error={fieldErrors['reason']}
            />

            {error ? <Alert tone="error">{error}</Alert> : null}

            <Button type="submit" disabled={pending !== null}>
              {pending === mode ? 'Saving…' : 'Record movement'}
            </Button>
          </FieldSet>
        </form>
      ) : null}

      {!canAdjust && canTransfer ? (
        <Alert tone="info" title="Adjustments are restricted">
          Your role can move stock between warehouses but cannot record a receipt or an adjustment.
        </Alert>
      ) : null}
    </div>
  );
}
