import { created, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { stockAdjustmentSchema } from '@/lib/inventory/validation';
import { adjustStock } from '@/lib/services/stock.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `POST /api/stock/adjustments` — correct a balance after a stock count.
 *
 * The only operation that accepts a negative quantity, because discovering that
 * units are missing *is* a legitimate correction. A reason is mandatory and is
 * stored on the movement so the ledger explains the gap instead of hiding it.
 *
 * A negative result is refused before anything is written, which is what the
 * member sees; the database's own non-negative check is the backstop underneath
 * it.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(stockAdjustmentSchema, await readJsonBody(request));

  const movement = await adjustStock(context, input);

  return created({ movement });
});
