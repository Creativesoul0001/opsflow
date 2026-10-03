import { Card, CardBody } from '@/components/ui/card';

/**
 * Dashboard metric tile.
 *
 * Phase 1 has no business tables yet, so every metric renders in an explicit
 * "not available yet" state rather than a fabricated number. When a real module
 * lands, it supplies `value` and the placeholder copy is dropped.
 */
export function StatCard({
  label,
  description,
  value,
  isPlaceholder = true,
}: {
  label: string;
  description: string;
  value?: string;
  isPlaceholder?: boolean;
}) {
  return (
    <Card>
      <CardBody className="space-y-2">
        <p className="text-fg-muted text-sm font-medium">{label}</p>
        {isPlaceholder || value === undefined ? (
          <>
            <p className="text-fg-muted/70 text-2xl font-semibold tracking-tight">No data yet</p>
            <p className="text-fg-muted text-xs">{description}</p>
          </>
        ) : (
          <>
            <p className="text-fg text-2xl font-semibold tracking-tight">{value}</p>
            <p className="text-fg-muted text-xs">{description}</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
