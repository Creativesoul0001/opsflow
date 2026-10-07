import { Badge } from '@/components/ui/badge';
import { orderStatusLabel } from '@/lib/orders/presentation';
import { ORDER_STATUS_TONES, isOrderStatus } from '@/lib/orders/status';

/**
 * Order status chip.
 *
 * The tone comes from the shared status module rather than being chosen here, so
 * the list, the detail page and the dashboard can never disagree about what
 * colour "Shipped" is.
 */
export function OrderStatusBadge({ status }: { status: string }) {
  const tone = isOrderStatus(status) ? ORDER_STATUS_TONES[status] : 'neutral';

  return <Badge tone={tone}>{orderStatusLabel(status)}</Badge>;
}
