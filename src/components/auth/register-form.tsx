'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { ApiRequestError, formString, postJson } from '@/lib/client/api';

export function RegisterForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setPending(true);
    setFormError(null);
    setFieldErrors({});

    try {
      await postJson('/api/auth/register', {
        name: formString(form, 'name'),
        email: formString(form, 'email'),
        password: formString(form, 'password'),
        organizationName: formString(form, 'organizationName'),
      });
      router.replace('/login?registered=1');
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

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <TextField
        label="Your name"
        name="name"
        autoComplete="name"
        required
        error={fieldErrors['name']}
      />
      <TextField
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fieldErrors['email']}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        hint="At least 12 characters, with upper case, lower case and a number."
        error={fieldErrors['password']}
      />
      <TextField
        label="Organization name"
        name="organizationName"
        required
        error={fieldErrors['organizationName']}
      />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
