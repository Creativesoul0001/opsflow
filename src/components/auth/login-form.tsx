'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/ui/field';
import { ApiRequestError, formString, postJson } from '@/lib/client/api';

export function LoginForm() {
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
      await postJson<{ redirectTo: string }>('/api/auth/login', {
        email: formString(form, 'email'),
        password: formString(form, 'password'),
      });
      // Refresh so server components re-read the new session cookie.
      router.replace('/dashboard');
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

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="space-y-4">
      {formError ? <Alert tone="error">{formError}</Alert> : null}

      <TextField
        label="Email"
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
        autoComplete="current-password"
        required
        error={fieldErrors['password']}
      />

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
