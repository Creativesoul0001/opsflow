import { created, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { stockReceiptSchema } from '@/lib/inventory/validation';
import { receiveStock } from '@/lib/services/stock.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/stock/receipts` — record stock arriving at a warehouse.
 *
 * This is the opening balance path as well as the supplier delivery path. The
 * quantity is always positive, so an accidental sign cannot silently destroy
 * stock, and the movement row it writes is the only record of how the balance
 * came to be what it is.
 *
 * Both the product and the warehouse are resolved inside the transaction with a
 * row lock, so two simultaneous receipts to the same product cannot read the
 * same starting quantity and overwrite one another.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(stockReceiptSchema, await readJsonBody(request));

  const movement = await receiveStock(context, input);

  return created({ movement });
});
