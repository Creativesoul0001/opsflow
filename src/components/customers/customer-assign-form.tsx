'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/field';
import { ApiRequestError, patchJson } from '@/lib/client/api';

export interface AssignOption {
  userId: string;
  name: string;
  email: string;
}

/**
 * Assign / unassign control.
 *
 * Options come from the server (this organization's ACTIVE members) and the
 * service independently verifies the target is an active member before writing,
 * so a tampered request cannot move a customer to another tenant's user.
 */
export function CustomerAssignForm({
  customerId,
  assignedUserId,
  members,
}: {
  customerId: string;
  assignedUserId: string | null;
  members: readonly AssignOption[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(assignedUserId ?? '');

  async function assign(nextUserId: string) {
    setPending(true);
    setError(null);

    try {
      await patchJson(`/api/customers/${customerId}/assignment`, {
        assignedUserId: nextUserId === '' ? null : nextUserId,
      });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiRequestError
          ? cause.message
          : 'The assignment could not be changed. Please try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void assign(selected);
        }}
      >
        <SelectField
          label="Assigned to"
          name="assignedUserId"
          value={selected}
          disabled={pending}
          onChange={(event) => setSelected(event.target.value)}
          options={[
            { value: '', label: 'Unassigned' },
            ...members.map((member) => ({
              value: member.userId,
              label: `${member.name} (${member.email})`,
            })),
          ]}
        />
        <div className="mt-3 flex gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save assignment'}
          </Button>
          {assignedUserId ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setSelected('');
                void assign('');
              }}
            >
              Unassign
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}