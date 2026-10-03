'use client';

import { usePathname } from 'next/navigation';
import { useState } from 'react';

import { SidebarNav } from '@/components/layout/sidebar-nav';
import { UserMenu } from '@/components/layout/user-menu';
import type { ModuleDefinition } from '@/lib/modules';

export interface AppShellProps {
  modules: readonly ModuleDefinition[];
  user: { name: string; email: string };
  organization: { name: string; roleName: string };
  children: React.ReactNode;
}

/**
 * Responsive application chrome: a fixed sidebar on large screens and an
 * off-canvas drawer below `lg`.
 */
export function AppShell({ modules, user, organization, children }: AppShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      {navOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
          className="bg-fg/30 fixed inset-0 z-30 lg:hidden"
        />
      ) : null}

      <aside
        className={[
          'border-border-subtle bg-surface fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r',
          'transition-transform duration-200 lg:static lg:translate-x-0',
          navOpen ? 'translate-x-0' : '-translate-x-full',
        ].join(' ')}
      >
        <div className="border-border-subtle border-b px-4 py-4">
          <p className="text-fg text-base font-semibold tracking-tight">OpsFlow</p>
          <p className="text-fg-muted mt-1 truncate text-xs" title={organization.name}>
            {organization.name}
          </p>
        </div>

        <SidebarNav modules={modules} pathname={pathname} onNavigate={() => setNavOpen(false)} />

        <p className="border-border-subtle text-fg-muted border-t px-4 py-3 text-xs">
          Signed in as {organization.roleName}
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border-subtle bg-canvas/90 sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3 backdrop-blur">
          <button
            type="button"
            aria-label="Open navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
            className="text-fg-muted hover:bg-surface-muted hover:text-fg -ml-1 rounded-lg p-2 lg:hidden"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" aria-hidden="true">
              <path
                d="M4 6h16M4 12h16M4 18h16"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="min-w-0 flex-1">
            <p className="text-fg truncate text-sm font-medium">
              {modules.find((module) => pathname.startsWith(module.href))?.label ?? 'OpsFlow'}
            </p>
          </div>

          <UserMenu user={user} />
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
