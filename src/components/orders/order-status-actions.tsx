'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextArea } from '@/components/ui/field';
import { ApiRequestError, deleteJson, postJson } from '@/lib/client/api';
import { ORDER_TRANSITION_LABELS } from '@/lib/orders/presentation';
import {
  allowedTransitions,
  canCancel,
  isOrderStatus,
  type OrderStatusValue,
} from '@/lib/orders/status';

/**
 * Workflow controls for one order.
 *
 * The service is the authority: it re-checks `orders:update`, re-reads the
 * current status inside the transaction and refuses any transition the policy
 * does not allow. These buttons only mirror that policy so a member is not
 * offered an action that will come back as a 409 — hiding them is presentation,
 * not enforcement.
 *
 * Cancellation is deliberately a separate, two-step control. It carries
 * `orders:cancel`, needs a reason field, and is destructive in a way "confirm"
 * is not, so it never sits in the same row of buttons as an ordinary status
 * change.
 */
export function OrderStatusActions({
  orderId,
  status,
  canUpdate,
  allowCancel,
}: {
  orderId: string;
  status: string;
  canUpdate: boolean;
  /** Rendered only; the endpoint still requires `orders:cancel`. */
  allowCancel: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState('');

  if (!isOrderStatus(status)) return null;

  const current: OrderStatusValue = status;
  const transitions = allowedTransitions(current);
  const offers = transitions.filter((target) => target !== 'CANCELLED');

  async function transition(target: OrderStatusValue) {
    setPending(target);
    setError(null);

    try {
      await postJson(`/api/orders/${orderId}/status`, { status: target });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The status could not be changed. Please try again.',
      );
      setPending(null);
    }
  }

  async function cancel() {
    setPending('CANCELLED');
    setError(null);

    try {
      await deleteJson(`/api/orders/${orderId}`, { reason: reason.trim() || null });
      setConfirmingCancel(false);
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The order could not be cancelled. Please try again.',
      );
      setPending(null);
      setConfirmingCancel(false);
    }
  }

  if (!canUpdate && !allowCancel) return null;

  if (confirmingCancel) {
    return (
      <div className="space-y-3">
        <Alert tone="warning" title="Cancel this order?">
          The order, its line items and its history are kept and marked cancelled. An order that is
          already shipped or delivered cannot be cancelled.
        </Alert>
        <TextArea
          label="Reason"
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={500}
          placeholder="Customer changed their mind."
          hint="Optional. Recorded on the activity timeline."
        />
        <div className="flex gap-2">
          <Button variant="danger" onClick={() => void cancel()} disabled={pending !== null}>
            {pending === 'CANCELLED' ? 'Cancelling…' : 'Confirm cancellation'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => setConfirmingCancel(false)}
            disabled={pending !== null}
          >
            Keep order
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="flex flex-wrap gap-2">
        {canUpdate
          ? offers.map((target) => (
              <Button
                key={target}
                size="sm"
                disabled={pending !== null}
                onClick={() => void transition(target)}
              >
                {pending === target ? 'Saving…' : (ORDER_TRANSITION_LABELS[target] ?? target)}
              </Button>
            ))
          : null}

        {allowCancel && canCancel(current) ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={pending !== null}
            onClick={() => {
              setError(null);
              setConfirmingCancel(true);
            }}
          >
            Cancel order
          </Button>
        ) : null}
      </div>

      {canUpdate && offers.length === 0 && !(allowCancel && canCancel(current)) ? (
        <p className="text-fg-muted text-sm">
          This order is in a final state. Nothing further can be changed.
        </p>
      ) : null}
    </div>
  );
}
