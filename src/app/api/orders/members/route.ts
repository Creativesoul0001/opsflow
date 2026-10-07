import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { listOrderAssignableMembers } from '@/lib/services/order.service';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/orders/members` — the people an order may be assigned to.
 *
 * Only ACTIVE members of the caller's organization. Employees can *create*
 * orders without holding `orders:assign`, so this is deliberately a read-only
 * endpoint that does not gate on the assign permission: the create form still
 * needs to offer someone, and the service re-checks the assignee on write.
 *
 * Lives under `/orders` rather than `/members` because it exists solely for this
 * module and must not imply a general-purpose directory API.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const members = await listOrderAssignableMembers(context);

  return ok({ members });
});
