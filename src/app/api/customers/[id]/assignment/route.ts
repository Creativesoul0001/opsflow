import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { assignCustomerSchema, parseCustomerId } from '@/lib/customers/validation';
import { assignCustomer } from '@/lib/services/customer.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `PATCH /api/customers/:id/assignment` — assign or unassign a customer.
 *
 * Separate from the general update route because assignment carries its own
 * `customers:assign` permission, and because it needs a membership check the
 * generic update does not: the target must be an ACTIVE member of *this*
 * organization.
 */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const customerId = parseCustomerId((await params).id);

  const { assignedUserId } = parseOrThrow(assignCustomerSchema, await readJsonBody(request));
  const customer = await assignCustomer(context, customerId, assignedUserId);

  return ok({ customer });
});
