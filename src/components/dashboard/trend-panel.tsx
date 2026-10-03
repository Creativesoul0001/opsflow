import { Card, CardBody, CardHeader } from '@/components/ui/card';

const SERIES = [
  { label: 'Revenue', ready: false, phase: 4 },
  { label: 'Orders', ready: false, phase: 2 },
  { label: 'New customers', ready: false, phase: 2 },
];

/**
 * Trend panel placeholder.
 *
 * No charting library is installed in Phase 1: there is no series data to draw
 * and an empty-but-pretty graph would imply the pipeline is live. Once the
 * Orders and Finance modules land, real series replace these entries and this
 * component gains a chart implementation.
 */
export function TrendPanel() {
  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Trends appear once business modules ship."
        action={
          <span className="bg-surface-muted text-fg-muted rounded px-2 py-1 text-xs font-medium">
            Phase 1
          </span>
        }
      />
      <CardBody className="space-y-4">
        <div className="border-border-subtle bg-surface-muted grid h-48 place-items-center rounded-lg border border-dashed">
          <p className="text-fg-muted max-w-xs text-center text-sm">
            No chart data is available in Phase 1.
          </p>
        </div>

        <ul className="divide-border-subtle divide-y">
          {SERIES.map((series) => (
            <li key={series.label} className="flex items-center justify-between py-2.5">
              <span className="text-fg text-sm">{series.label}</span>
              <span className="text-fg-muted text-xs">Planned for Phase {series.phase}</span>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
