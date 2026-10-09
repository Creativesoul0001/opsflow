'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiRequestError, deleteJson } from '@/lib/client/api';

/**
 * Archive a product, as a deliberate two-step action.
 *
 * Archiving is the removal mechanism: the row, its stock balances and its
 * movements are kept, because order lines and the stock ledger both point at it.
 * Cancelling is offered before the request is sent, so a mis-click cannot retire
 * a catalogue entry.
 */
export function ArchiveProductButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function archive() {
    setPending(true);
    setError(null);

    try {
      await deleteJson(`/api/products/${productId}`);
      setConfirming(false);
      router.replace('/inventory/products');
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The product could not be archived. Please try again.',
      );
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div className="space-y-3">
        <Alert tone="warning" title="Archive this product?">
          It will be removed from the active catalogue and from every picker. Its stock, its
          movements and the order lines that reference it are all retained, so history keeps reading
          correctly.
        </Alert>
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => void archive()} disabled={pending}>
            {pending ? 'Archiving…' : 'Confirm archive'}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
            Keep product
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button variant="secondary" onClick={() => setConfirming(true)}>
        Archive {productName}
      </Button>
    </>
  );
}
