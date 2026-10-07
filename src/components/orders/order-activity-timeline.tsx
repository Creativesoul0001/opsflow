import { formatDateTime, orderActivityLabel } from '@/lib/orders/presentation';
import type { OrderActivityDto } from '@/lib/services/order.service';

/**
 * Order timeline, newest first.
 *
 * Entries are written as a side effect of the operations they describe, so this
 * is a record of what happened rather than a free-text log a member could
 * rewrite. Nothing here is posted directly by a client.
 */
export function OrderActivityTimeline({ activities }: { activities: readonly OrderActivityDto[] }) {
  if (activities.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        No activity recorded yet. Creating the order, editing it, moving it through the workflow,
        cancelling it, reassigning it or adding a note all appear here.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {activities.map((activity) => (
        <li key={activity.id} className="flex gap-3">
          <span aria-hidden="true" className="bg-brand mt-1.5 size-2 shrink-0 rounded-full" />
          <div className="min-w-0">
            <p className="text-fg text-sm font-medium">{orderActivityLabel(activity.type)}</p>
            <p className="text-fg-muted text-sm">{activity.description}</p>
            <p className="text-fg-muted/80 mt-0.5 text-xs">
              {formatDateTime(activity.createdAt)}
              {activity.user ? ` — ${activity.user.name}` : ' — removed member'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
