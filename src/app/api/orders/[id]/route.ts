import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { cancelOrderSchema, parseOrderId, updateOrderSchema } from '@/lib/orders/validation';
import { cancelOrder, getOrder, updateOrder } from '@/lib/services/order.service';
import { parseOrThrow, readJsonBody, readOptionalJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `GET /api/orders/:id`
 *
 * Knowing an order id is not sufficient: the lookup is scoped to the caller's
 * organization, so another tenant's id returns the same 404 as a missing record.
 */
export const GET = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const order = await getOrder(context, parseOrderId((await params).id));

  return ok({ order });
});

/**
 * `PATCH /api/orders/:id` — partial update of the customer or the money inputs.
 *
 * Only `PENDING` and `CONFIRMED` orders accept edits; the service refuses later
 * stages with a 409 rather than silently dropping the change. Totals are always
 * recomputed from the submitted line items, so a payload cannot claim its own
 * subtotal.
 */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(updateOrderSchema, await readJsonBody(request));
  const order = await updateOrder(context, parseOrderId((await params).id), input);

  return ok({ order });
});

/**
 * `DELETE /api/orders/:id` — cancel an order.
 *
 * Cancellation rather than deletion: the row, its line items and its activity
 * trail are kept with `status = CANCELLED` and `cancelledAt` set, because an
 * order someone will later ask about must never disappear. No endpoint destroys
 * an order.
 *
 * `DELETE` carries an optional `{ reason }` body; a bare `DELETE` with no body
 * is valid and cancels without one. It reaches `cancelOrder`, which demands
 * `orders:cancel`, never the `orders:update` that the general status route uses.
 */
export const DELETE = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const { reason } = parseOrThrow(cancelOrderSchema, await readOptionalJsonBody(request));
  const order = await cancelOrder(context, parseOrderId((await params).id), reason ?? null);

  return ok({ order });
});
