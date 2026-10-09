import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { parseWarehouseId, updateWarehouseSchema } from '@/lib/inventory/validation';
import { archiveWarehouse, getWarehouse, updateWarehouse } from '@/lib/services/inventory.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `GET /api/warehouses/:id`
 *
 * Tenant-scoped like every other single-record lookup, so another
 * organization's warehouse id returns the same 404 as a missing one.
 */
export const GET = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const warehouse = await getWarehouse(context, parseWarehouseId((await params).id));

  return ok({ warehouse });
});

/**
 * `PATCH /api/warehouses/:id` — edit details, or promote/demote the primary.
 *
 * Removing the primary flag is refused when the warehouse is the only one
 * holding it: the organization must always have a default source for order
 * deductions, and silently leaving it without one would break every future
 * confirmation.
 */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(updateWarehouseSchema, await readJsonBody(request));
  const warehouse = await updateWarehouse(context, parseWarehouseId((await params).id), input);

  return ok({ warehouse });
});

/**
 * `DELETE /api/warehouses/:id` — archive a warehouse.
 *
 * Its stock rows and movements are retained so the ledger still balances;
 * an archived location simply stops accepting new movements. No endpoint
 * destroys a warehouse.
 */
export const DELETE = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const warehouse = await archiveWarehouse(context, parseWarehouseId((await params).id));

  return ok({ warehouse });
});
