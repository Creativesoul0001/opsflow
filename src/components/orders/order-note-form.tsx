'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextArea } from '@/components/ui/field';
import { ApiRequestError, formString, postJson } from '@/lib/client/api';

/**
 * Append a note to an order.
 *
 * Notes accumulate on the record and each one writes a `NOTE_ADDED` activity, so
 * the timeline explains where the text came from. The textarea is cleared only
 * after the server confirms the write, and a delivered or cancelled order
 * refuses the note rather than accepting it silently.
 */
export function OrderNoteForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setPending(true);
    setError(null);
    setFieldErrors({});

    try {
      await postJson(`/api/orders/${orderId}/notes`, {
        body: formString(form, 'body'),
      });

      formRef.current?.reset();
      router.refresh();
    } catch (cause) {
      if (cause instanceof ApiRequestError) {
        setFieldErrors(cause.fieldErrors);
        setError(cause.message);
      } else {
        setError('The note could not be saved. Please try again.');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={(event) => void onSubmit(event)}
      noValidate
      className="space-y-3"
    >
      {error ? <Alert tone="error">{error}</Alert> : null}

      <TextArea
        label="Add a note"
        name="body"
        required
        maxLength={2000}
        placeholder="Customer asked for delivery after the 15th."
        error={fieldErrors['body']}
      />

      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving note…' : 'Add note'}
      </Button>
    </form>
  );
}
