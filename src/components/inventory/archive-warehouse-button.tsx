'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiRequestError, deleteJson } from '@/lib/client/api';

/**
 * Archive a warehouse, as a deliberate two-step action.
 *
 * The stock rows and movements are retained so the ledger still balances; an
 * archived warehouse simply stops accepting new movements. The primary flag is
 * released at the same time, because an archived warehouse must never remain the
 * default source for order deductions.
 */
export function ArchiveWarehouseButton({
  warehouseId,
  warehouseName,
}: {
  warehouseId: string;
  warehouseName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setPending(true);
    setError(null);

    try {
      await deleteJson(`/api/warehouses/${warehouseId}`);
      setConfirming(false);
      router.replace('/inventory/warehouses');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The warehouse could not be archived. Please try again.',
      );
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div className="space-y-3">
        <Alert tone="warning" title="Archive this warehouse?">
          It will stop accepting new movements. Its stock balances and movement history are
          retained, so the ledger still balances and past records keep resolving.
        </Alert>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => void archive()} disabled={pending}>
            {pending ? 'Archiving…' : 'Confirm archive'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            Keep warehouse
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Archive {warehouseName}
      </Button>
    </>
  );
}
