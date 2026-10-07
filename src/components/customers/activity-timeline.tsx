import { customerActivityLabel, formatDateTime } from '@/lib/customers/presentation';
import type { CustomerActivityDto } from '@/lib/services/customer.service';

/**
 * Customer timeline, newest first.
 *
 * Entries are written as a side effect of the operations they describe, so this
 * is a record of what happened rather than a free-text log a member could
 * rewrite.
 */
export function ActivityTimeline({ activities }: { activities: readonly CustomerActivityDto[] }) {
  if (activities.length === 0) {
    return (
      <p className="text-fg-muted text-sm">
        No activity recorded yet. Creating the customer, editing their details, adding a note,
        assigning them or archiving them all appear here.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {activities.map((activity) => (
        <li key={activity.id} className="flex gap-3">
          <span aria-hidden="true" className="bg-brand mt-1.5 size-2 shrink-0 rounded-full" />
          <div className="min-w-0">
            <p className="text-fg text-sm font-medium">{customerActivityLabel(activity.type)}</p>
            <p className="text-fg-muted text-sm">{activity.description}</p>
            <p className="text-fg-muted/80 mt-0.5 text-xs">
              {formatDateTime(activity.createdAt)}
              {activity.user ? ` · ${activity.user.name}` : ' · removed member'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
