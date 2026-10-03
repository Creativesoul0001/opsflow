import type { ComponentPropsWithoutRef, ReactNode } from 'react';

export function Card({ className = '', ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={`bg-surface ring-border-subtle rounded-xl shadow-xs ring-1 ${className}`}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="border-border-subtle flex items-start justify-between gap-4 border-b px-5 py-4">
      <div>
        <h2 className="text-fg text-sm font-semibold">{title}</h2>
        {description ? <p className="text-fg-muted mt-0.5 text-sm">{description}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function CardBody({ className = '', ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={`px-5 py-4 ${className}`} {...props} />;
}
