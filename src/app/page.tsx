import { redirect } from 'next/navigation';

import { getAuthorizationContext } from '@/lib/auth/session';

/** Entry point: send visitors to the dashboard or the sign-in screen. */
export default async function HomePage() {
  const context = await getAuthorizationContext();
  redirect(context ? '/dashboard' : '/login');
}
