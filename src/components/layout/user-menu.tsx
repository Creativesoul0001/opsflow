'use client';

import { signOut } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Account menu with sign-out.
 *
 * Sign-out posts to Auth.js and then navigates so the server components (and
 * the session cookie) are re-evaluated from scratch.
 */
export function UserMenu({ user }: { user: { name: string; email: string } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  async function handleSignOut() {
    setSigningOut(true);
    await signOut({ redirect: false });
    // `router.replace` clears the protected route; `refresh` forces server
    // components to re-read state now that the session cookie is gone.
    router.replace('/login');
    router.refresh();
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hover:bg-surface-muted flex items-center gap-2 rounded-lg p-1 pr-2 text-sm"
      >
        <span
          aria-hidden="true"
          className="bg-brand-soft text-brand grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
        >
          {initials || '?'}
        </span>
        <span className="text-fg hidden max-w-32 truncate sm:inline">{user.name}</span>
      </button>

      {open ? (
        <div
          role="menu"
          className="bg-surface ring-border-subtle absolute right-0 z-50 mt-2 w-56 rounded-xl p-1 shadow-lg ring-1"
        >
          <div className="border-border-subtle border-b px-3 py-2">
            <p className="text-fg truncate text-sm font-medium">{user.name}</p>
            <p className="text-fg-muted truncate text-xs">{user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            onClick={() => void handleSignOut()}
            className="text-fg hover:bg-surface-muted mt-1 w-full rounded-lg px-3 py-2 text-left text-sm disabled:opacity-60"
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
