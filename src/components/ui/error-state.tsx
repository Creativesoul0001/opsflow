'use client';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

export interface ErrorStateProps {
  title?: string;
  message: string;
  retry?: () => void;
}

/**
 * Client-side error boundary body. Deliberately shows only a safe, human
 * message: server stack traces never reach this component.
 */
export function ErrorState({ title = 'Something went wrong', message, retry }: ErrorStateProps) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-10 text-center">
      <Alert tone="error" title={title}>
        {message}
      </Alert>
      {retry ? (
        <Button variant="secondary" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
