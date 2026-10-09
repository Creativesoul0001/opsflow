import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { stockMovementQuerySchema } from '@/lib/inventory/validation';
import { listStockMovements } from '@/lib/services/stock.service';
import { parseOrThrow } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/stock/movements` — the stock ledger.
 *
 * Every quantity change in the module is on this list, including the ones the
 * order workflow wrote, which is what makes "why is this product's stock what it
 * is?" answerable. `buildStockMovementWhere` pins the organization first and
 * every parameter below can only narrow it further.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(stockMovementQuerySchema, params);

  const { movements, pagination } = await listStockMovements(context, query);

  return ok({ movements }, { pagination });
});
