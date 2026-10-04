import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { customerActivityQuerySchema, parseCustomerId } from '@/lib/customers/validation';
import { listCustomerActivities } from '@/lib/services/customer.service';
import { parseOrThrow } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `GET /api/customers/:id/activities` — the customer timeline.
 *
 * Read-only by design: activities are written as a side effect of the operation
 * they describe (create, update, note, assign, archive), never posted directly,
 * so the trail cannot be forged or back-dated.
 */
export const GET = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const customerId = parseCustomerId((await params).id);

  const queryParams = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(customerActivityQuerySchema, queryParams);

  const { activities, pagination } = await listCustomerActivities(context, customerId, query);

  return ok({ activities }, { pagination });
});