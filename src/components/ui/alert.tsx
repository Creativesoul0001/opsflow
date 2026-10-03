import type { ReactNode } from 'react';

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'error' | 'success' | 'warning';
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    info: 'bg-brand-soft text-fg ring-brand/20',
    error: 'bg-danger-soft text-danger ring-danger/20',
    success: 'bg-success/10 text-fg ring-success/25',
    warning: 'bg-warning/10 text-fg ring-warning/30',
  } as const;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`rounded-lg px-4 py-3 text-sm ring-1 ${tones[tone]}`}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-1' : undefined}>{children}</div> : null}
    </div>
  );
}
