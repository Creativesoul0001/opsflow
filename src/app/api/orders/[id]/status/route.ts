import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { changeOrderStatusSchema, parseOrderId } from '@/lib/orders/validation';
import { changeOrderStatus } from '@/lib/services/order.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `POST /api/orders/:id/status` — move an order along its workflow.
 *
 * Only forward transitions reach here. Cancellation is deliberately refused by
 * the service: it takes a reason, needs `orders:cancel` rather than
 * `orders:update`, and accepting it here would be a second way to do the same
 * thing with fewer checks.
 */
export const POST = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const orderId = parseOrderId((await params).id);
  const { status } = parseOrThrow(changeOrderStatusSchema, await readJsonBody(request));

  const order = await changeOrderStatus(context, orderId, status);

  return ok({ order });
});
