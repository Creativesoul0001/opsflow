import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { assignOrderSchema, parseOrderId } from '@/lib/orders/validation';
import { assignOrder } from '@/lib/services/order.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `PATCH /api/orders/:id/assignment` — assign or unassign an order.
 *
 * Separate from the general update because assignment carries its own
 * `orders:assign` permission, and because it needs a membership check the
 * generic update does not: the target must be an ACTIVE member of *this*
 * organization. A terminal order refuses reassignment rather than silently
 * accepting a change nobody can see.
 */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const orderId = parseOrderId((await params).id);

  const { assignedUserId } = parseOrThrow(assignOrderSchema, await readJsonBody(request));
  const order = await assignOrder(context, orderId, assignedUserId);

  return ok({ order });
});
