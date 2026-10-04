import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { parseCustomerId, updateCustomerSchema } from '@/lib/customers/validation';
import { archiveCustomer, getCustomer, updateCustomer } from '@/lib/services/customer.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `GET /api/customers/:id`
 *
 * Knowing a customer id is not sufficient: the lookup is scoped to the caller's
 * organization, so another tenant's id returns the same 404 as a missing record.
 */
export const GET = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const customer = await getCustomer(context, parseCustomerId((await params).id));

  return ok({ customer });
});

/** `PATCH /api/customers/:id` — partial update; every field is optional. */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(updateCustomerSchema, await readJsonBody(request));
  const customer = await updateCustomer(context, parseCustomerId((await params).id), input);

  return ok({ customer });
});

/**
 * `DELETE /api/customers/:id` — archives the customer.
 *
 * Deliberately a soft delete: the row is retained with `archivedAt` set and
 * status `ARCHIVED`, so history and the activity trail survive. Archived records
 * are hidden from the default list and can be revealed with `includeArchived`.
 * There is no endpoint that destroys a customer record.
 */
export const DELETE = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const customer = await archiveCustomer(context, parseCustomerId((await params).id));

  return ok({ customer });
});