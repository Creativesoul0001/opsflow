import type { ComponentPropsWithoutRef } from 'react';

export interface FieldProps {
  label: string;
  name: string;
  error?: string;
  hint?: string;
}

function inputClasses(invalid: boolean): string {
  return [
    'w-full rounded-lg px-3 py-2 text-sm text-fg bg-surface ring-1 transition-colors',
    'placeholder:text-fg-muted/60',
    invalid ? 'ring-danger' : 'ring-border-subtle focus:ring-brand',
    'disabled:cursor-not-allowed disabled:bg-surface-muted',
  ].join(' ');
}

function describedBy(name: string, error: string | undefined, hint: string | undefined) {
  const ids = [error ? `${name}-error` : null, hint ? `${name}-hint` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

export function TextField({
  label,
  name,
  error,
  hint,
  ...props
}: FieldProps & ComponentPropsWithoutRef<'input'>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-fg block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, hint)}
        className={inputClasses(Boolean(error))}
        {...props}
      />
      {hint && !error ? (
        <p id={`${name}-hint`} className="text-fg-muted text-xs">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${name}-error`} className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function TextArea({
  label,
  name,
  error,
  hint,
  ...props
}: FieldProps & ComponentPropsWithoutRef<'textarea'>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={name} className="text-fg block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, hint)}
        className={`${inputClasses(Boolean(error))} min-h-20 resize-y`}
        {...props}
      />
      {error ? (
        <p id={`${name}-error`} className="text-danger text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
