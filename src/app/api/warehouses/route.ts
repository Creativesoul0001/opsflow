import { created, ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { createWarehouseSchema, warehouseListQuerySchema } from '@/lib/inventory/validation';
import { createWarehouse, listWarehouses } from '@/lib/services/inventory.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/warehouses` — list, search, filter, sort and paginate warehouses.
 *
 * Each row carries how much it holds, so the overview page needs no second
 * request. The organization predicate is applied in `buildWarehouseWhere`, so no
 * query-string input can widen the result set beyond the tenant.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(warehouseListQuerySchema, params);

  const { warehouses, pagination } = await listWarehouses(context, query);

  return ok({ warehouses }, { pagination });
});

/**
 * `POST /api/warehouses` — create a warehouse.
 *
 * The organization's first warehouse becomes the primary automatically, because
 * order deductions need somewhere to take stock from. After that, promotion is
 * explicit: it changes where order stock is drawn from.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(createWarehouseSchema, await readJsonBody(request));

  const warehouse = await createWarehouse(context, input);

  return created({ warehouse });
});
