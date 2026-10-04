import type { ReactNode } from 'react';

/**
 * Small status/label chip.
 *
 * Tones map to the existing design tokens so a badge never introduces a colour
 * outside the palette in `globals.css`.
 */
const TONES = {
  neutral: 'bg-surface-muted text-fg-muted ring-border-subtle',
  brand: 'bg-brand-soft text-brand ring-brand/20',
  success: 'bg-success/10 text-success ring-success/25',
  warning: 'bg-warning/10 text-fg ring-warning/30',
  danger: 'bg-danger-soft text-danger ring-danger/20',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}