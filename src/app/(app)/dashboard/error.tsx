'use client';

import { ErrorState } from '@/components/ui/error-state';

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  // Only a safe, static message reaches the client. The real error and its
  // stack stay on the server, where `app/api` logs them.
  return (
    <ErrorState
      title="We could not load your dashboard"
      message="Something went wrong while loading this page. Please try again."
      retry={reset}
    />
  );
}
