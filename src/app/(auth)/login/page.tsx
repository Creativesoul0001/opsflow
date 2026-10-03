import Link from 'next/link';

import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ registered?: string }>;
}) {
  const { registered } = await searchParams;

  return (
    <AuthCard
      title="Sign in to OpsFlow"
      subtitle="Use your work email and password."
      footer={
        <>
          Don&apos;t have an account?{' '}
          <Link href="/register" className="text-brand font-medium hover:underline">
            Create one
          </Link>
        </>
      }
    >
      {registered ? (
        <p role="status" className="bg-brand-soft text-fg mb-4 rounded-lg px-4 py-3 text-sm">
          Account created. Sign in to continue.
        </p>
      ) : null}
      <LoginForm />
    </AuthCard>
  );
}
