import type { ReactNode } from 'react';

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full max-w-sm">
      <div className="bg-surface ring-border-subtle rounded-2xl p-6 shadow-sm ring-1 sm:p-8">
        <h1 className="text-fg text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-fg-muted mt-1 text-sm">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
      {footer ? <p className="text-fg-muted mt-4 text-center text-sm">{footer}</p> : null}
    </div>
  );
}
