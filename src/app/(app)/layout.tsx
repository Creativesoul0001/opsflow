import { redirect } from 'next/navigation';

import { AppShell } from '@/components/layout/app-shell';
import { getAuthorizationContext } from '@/lib/auth/session';
import { visibleModules } from '@/lib/modules';

/**
 * Everything under `(app)` requires a session. The redirect lives here rather
 * than in each page, and it runs on the server so an unauthenticated request
 * never receives protected markup.
 *
 * The authorization context is re-read from Postgres on every request instead
 * of being trusted from the session token, so a suspended membership or a role
 * change takes effect on the next page load.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const context = await getAuthorizationContext();
  if (!context) redirect('/login');

  return (
    <AppShell
      modules={visibleModules(context.permissions)}
      user={{ name: context.name, email: context.email }}
      organization={{ name: context.organizationName, roleName: context.roleName }}
    >
      {children}
    </AppShell>
  );
}
