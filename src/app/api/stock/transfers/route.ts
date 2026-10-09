import { created, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { stockTransferSchema } from '@/lib/inventory/validation';
import { transferStock } from '@/lib/services/stock.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/stock/transfers` — move stock between two warehouses.
 *
 * Both warehouses must belong to the caller's organization; the service resolves
 * them inside the transaction and rejects an id that is unknown to this tenant
 * with the same message as one that does not exist, so nothing is confirmed
 * about another organization's locations.
 *
 * The transfer writes `TRANSFER_OUT` and `TRANSFER_IN` in one transaction, so
 * the organization's total stock is conserved and neither side can be committed
 * without the other.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(stockTransferSchema, await readJsonBody(request));

  const transfer = await transferStock(context, input);

  return created({ transfer });
});
