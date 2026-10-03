import Link from 'next/link';

import type { ModuleDefinition } from '@/lib/modules';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Numbered glyph per module — avoids an icon dependency in Phase 1. */
const GLYPHS: Record<string, string> = {
  dashboard: '01',
  customers: '02',
  orders: '03',
  inventory: '04',
  support: '05',
  finance: '06',
  automation: '07',
  ai: '08',
  analytics: '09',
  settings: '10',
};

export function SidebarNav({
  modules,
  pathname,
  onNavigate,
}: {
  modules: readonly ModuleDefinition[];
  pathname: string;
  onNavigate?: () => void;
}) {
  if (modules.length === 0) {
    return (
      <p className="text-fg-muted px-3 py-2 text-xs">
        Your role does not grant access to any module yet.
      </p>
    );
  }

  return (
    <nav aria-label="Main" className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {modules.map((module) => {
        const active = isActive(pathname, module.href);
        const planned = module.status === 'planned';

        return (
          <Link
            key={module.key}
            href={module.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-brand-soft text-brand font-medium'
                : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={`w-5 shrink-0 font-mono text-[10px] ${active ? 'text-brand' : 'text-fg-muted/60'}`}
            >
              {GLYPHS[module.key] ?? '--'}
            </span>
            <span className="flex-1 truncate">{module.label}</span>
            {planned ? (
              <span
                className="bg-surface-muted text-fg-muted shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase"
                title={`Planned for a future phase`}
              >
                Soon
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
