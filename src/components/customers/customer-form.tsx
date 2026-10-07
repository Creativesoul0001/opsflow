'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldSet, SelectField, TextArea, TextField } from '@/components/ui/field';
import { ApiRequestError, formString, patchJson, postJson } from '@/lib/client/api';

export interface CustomerFormMember {
  userId: string;
  name: string;
}

export interface CustomerFormValues {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  companyName: string;
  status: string;
  customerType: string;
  notes: string;
  assignedUserId: string;
}

/**
 * Create and edit form.
 *
 * One component serves both operations so the field set, validation messages and
 * layout cannot drift apart. The difference is the endpoint: create POSTs the
 * whole record, edit PATCHes it and then returns to the customer.
 *
 * Server-side Zod is the authority on validity; this form sends what the member
 * typed and renders the returned field errors inline rather than duplicating the
 * rules in the browser.
 */
export function CustomerForm({
  mode,
  customerId,
  members,
  initialValues,
}: {
  mode: 'create' | 'edit';
  customerId?: string;
  members: readonly CustomerFormMember[];
  initialValues?: CustomerFormValues;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const payload = {
      firstName: formString(form, 'firstName'),
      lastName: formString(form, 'lastName'),
      email: formString(form, 'email'),
      phone: formString(form, 'phone'),
      companyName: formString(form, 'companyName'),
      status: formString(form, 'status'),
      customerType: formString(form, 'customerType'),
      notes: formString(form, 'notes'),
      // Only create accepts an assignee; changing it later is its own action
      // with its own permission.
      ...(mode === 'create' && { assignedUserId: formString(form, 'assignedUserId') || null }),
    };

    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      if (mode === 'create') {
        const { data } = await postJson<{ customer: { id: string } }>('/api/customers', payload);
        router.replace(`/customers/${data.customer.id}`);
      } else {
        await patchJson(`/api/customers/${customerId}`, payload);
        router.replace(`/customers/${customerId}`);
      }

      // Refresh so the server component re-reads from Postgres rather than
      // rendering a cached tree.
      router.refresh();
    } catch (error) {
      setPending(false);

      if (error instanceof ApiRequestError) {
        setFieldErrors(error.fieldErrors);
        setFormError(error.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    }
  }

  const value = (key: keyof CustomerFormValues) => initialValues?.[key] ?? '';

  return (
    // `method="post"` keeps a pre-hydration native submit from exposing customer
    // details — including notes — as URL query parameters.
    <form method="post" onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-6">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <FieldSet legend="Customer">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="First name"
            name="firstName"
            required
            autoComplete="given-name"
            defaultValue={value('firstName')}
            error={fieldErrors['firstName']}
          />
          <TextField
            label="Last name"
            name="lastName"
            required
            autoComplete="family-name"
            defaultValue={value('lastName')}
            error={fieldErrors['lastName']}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={value('email')}
            error={fieldErrors['email']}
          />
          <TextField
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="+1 555 0100"
            defaultValue={value('phone')}
            error={fieldErrors['phone']}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Type"
            name="customerType"
            defaultValue={value('customerType') || 'INDIVIDUAL'}
            options={[
              { value: 'INDIVIDUAL', label: 'Individual' },
              { value: 'BUSINESS', label: 'Business' },
            ]}
            error={fieldErrors['customerType']}
          />
          <SelectField
            label="Status"
            name="status"
            defaultValue={value('status') || 'ACTIVE'}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'LEAD', label: 'Lead' },
              { value: 'INACTIVE', label: 'Inactive' },
            ]}
            hint="Archiving is a separate action on the customer page."
            error={fieldErrors['status']}
          />
        </div>
      </FieldSet>

      <FieldSet legend="Company">
        <TextField
          label="Company name"
          name="companyName"
          autoComplete="organization"
          defaultValue={value('companyName')}
          hint="Optional for individual customers."
          error={fieldErrors['companyName']}
        />

        {mode === 'create' ? (
          <SelectField
            label="Assign to"
            name="assignedUserId"
            defaultValue={value('assignedUserId')}
            options={[
              { value: '', label: 'Unassigned' },
              ...members.map((member) => ({ value: member.userId, label: member.name })),
            ]}
            hint="Only members of this organization can be assigned."
            error={fieldErrors['assignedUserId']}
          />
        ) : null}
      </FieldSet>

      <FieldSet legend="Notes">
        <TextArea
          label="Notes"
          name="notes"
          defaultValue={value('notes')}
          hint="Visible to everyone in your organization with access to customers."
          error={fieldErrors['notes']}
        />
      </FieldSet>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={pending}>
          {pending
            ? mode === 'create'
              ? 'Creating customer…'
              : 'Saving changes…'
            : mode === 'create'
              ? 'Create customer'
              : 'Save changes'}
        </Button>
        <Button variant="secondary" onClick={() => router.back()} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
