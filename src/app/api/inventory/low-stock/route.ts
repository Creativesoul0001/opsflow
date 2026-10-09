import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { lowStockQuerySchema } from '@/lib/inventory/validation';
import { listLowStock } from '@/lib/services/stock.service';
import { parseOrThrow } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/inventory/low-stock` — the reorder report.
 *
 * `?level=out` narrows it to products with nothing on hand anywhere; the default
 * is every product at or below its reorder threshold. A product whose threshold
 * is zero has no reorder point configured, so it is never reported as low —
 * otherwise a catalogue entry that was simply never stocked would permanently
 * sit at the top of the report.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(lowStockQuerySchema, params);

  const { rows, pagination } = await listLowStock(context, query);

  return ok({ products: rows }, { pagination });
});
