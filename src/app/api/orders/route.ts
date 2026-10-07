import { created, ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { createOrderSchema, orderListQuerySchema } from '@/lib/orders/validation';
import { createOrder, listOrders } from '@/lib/services/order.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/orders` — list, search, filter, sort and paginate orders.
 *
 * Filtering happens in Postgres via `buildOrderWhere`, which always pins the
 * caller's organization, so no amount of query-string input can widen the result
 * set beyond the tenant.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(orderListQuerySchema, params);

  const { orders, pagination } = await listOrders(context, query);

  return ok({ orders }, { pagination });
});

/**
 * `POST /api/orders` — create an order in the caller's organization.
 *
 * Only the customer, line items, discount, tax rate, notes and assignee are
 * accepted. The order number, status and every money total are derived
 * server-side, and `organizationId` is never read from the payload.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(createOrderSchema, await readJsonBody(request));

  const order = await createOrder(context, input);

  return created({ order });
});
