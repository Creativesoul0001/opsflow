'use client';

import { ErrorState } from '@/components/ui/error-state';

export default function WarehousesError({ reset }: { error: Error; reset: () => void }) {
  // Only a safe, static message reaches the client; the real error and its stack
  // stay on the server, where the API layer logs them.
  return (
    <ErrorState
      title="We could not load your warehouses"
      message="Something went wrong while loading the warehouse list. Please try again."
      retry={reset}
    />
  );
}
