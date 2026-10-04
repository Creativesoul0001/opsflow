'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiRequestError, deleteJson } from '@/lib/client/api';

/**
 * Archive control.
 *
 * Archiving is the only removal the CRM offers, so it is a deliberate two-step
 * action rather than a single click, and the copy states plainly that the record
 * is retained. The server remains the authority: it re-checks
 * `customers:archive` and the tenant regardless of what this button does.
 */
export function CustomerArchiveAction({
  customerId,
  customerName,
  archived,
}: {
  customerId: string;
  customerName: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (archived) {
    return (
      <Alert tone="info" title="Archived customer">
        This customer was archived. Their record and history are retained, and it is hidden from
        the default list.
      </Alert>
    );
  }

  async function archive() {
    setPending(true);
    setError(null);

    try {
      await deleteJson(`/api/customers/${customerId}`);
      setConfirming(false);
      router.refresh();
    } catch (cause) {
      setPending(false);
      setConfirming(false);
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The customer could not be archived. Please try again.',
      );
    }
  }

  if (!confirming) {
    return (
      <div className="space-y-2">
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Archive
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Alert tone="warning" title="Archive this customer?">
        {customerName} will be hidden from the customer list. The record, notes and activity history
        are kept, and the customer can be shown again with “Show archived customers”.
      </Alert>
      <div className="flex gap-2">
        <Button variant="danger" onClick={() => void archive()} disabled={pending}>
          {pending ? 'Archiving…' : 'Confirm archive'}
        </Button>
        <Button variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}