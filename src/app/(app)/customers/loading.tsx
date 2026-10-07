import { Skeleton } from '@/components/ui/spinner';

export default function CustomersLoading() {
  return (
    <div className="mx-auto max-w-6xl space-y-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading customers…</span>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <Skeleton className="h-44 w-full" />

      <div className="space-y-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
