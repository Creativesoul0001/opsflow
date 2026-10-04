import { created, ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { customerListQuerySchema, createCustomerSchema } from '@/lib/customers/validation';
import { createCustomer, listCustomers } from '@/lib/services/customer.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/customers` — list, search, filter, sort and paginate customers.
 *
 * Filtering happens in Postgres via `buildCustomerWhere`, which always pins the
 * caller's organization, so no amount of query-string input can widen the result
 * set beyond the tenant.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(customerListQuerySchema, params);

  const { customers, pagination } = await listCustomers(context, query);

  return ok({ customers }, { pagination });
});

/**
 * `POST /api/customers` — create a customer in the caller's organization.
 *
 * The response includes pagination metadata on reads; a create returns only the
 * record. `organizationId` is not accepted from the client.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(createCustomerSchema, await readJsonBody(request));

  const customer = await createCustomer(context, input);

  return created({ customer });
});