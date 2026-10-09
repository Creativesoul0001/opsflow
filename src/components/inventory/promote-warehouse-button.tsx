'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiRequestError, patchJson } from '@/lib/client/api';

/**
 * Promote a warehouse to primary.
 *
 * The primary warehouse is the default source for order deductions, so changing
 * it changes where future confirmations take stock from. The database enforces a
 * single primary per organization, so the demotion of the previous holder happens
 * in the same transaction as the promotion.
 */
export function PromoteWarehouseButton({ warehouseId }: { warehouseId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function promote() {
    setPending(true);
    setError(null);

    try {
      await patchJson(`/api/warehouses/${warehouseId}`, { isPrimary: true });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The warehouse could not be promoted. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button variant="secondary" onClick={() => void promote()} disabled={pending}>
        {pending ? 'Promoting…' : 'Make primary'}
      </Button>
    </>
  );
}
