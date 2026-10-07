import { Badge, type BadgeTone } from '@/components/ui/badge';
import { customerStatusLabel, customerTypeLabel } from '@/lib/customers/presentation';

const STATUS_TONES: Readonly<Record<string, BadgeTone>> = {
  ACTIVE: 'success',
  LEAD: 'brand',
  INACTIVE: 'neutral',
  ARCHIVED: 'danger',
};

export function CustomerStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{customerStatusLabel(status)}</Badge>;
}

export function CustomerTypeBadge({ customerType }: { customerType: string }) {
  return <Badge tone="neutral">{customerTypeLabel(customerType)}</Badge>;
}
