import { created, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { orderNoteSchema, parseOrderId } from '@/lib/orders/validation';
import { addOrderNote } from '@/lib/services/order.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `POST /api/orders/:id/notes` — append a note to the activity timeline.
 *
 * The response is the whole updated order rather than the note itself: notes are
 * never read in isolation, and the UI refreshes its timeline from the record it
 * already has on screen.
 *
 * A terminal order refuses notes. Once an order is delivered or cancelled it is
 * a historical record, and adding to it afterwards would make the trail read as
 * though work were still happening.
 */
export const POST = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const orderId = parseOrderId((await params).id);
  const { body } = parseOrThrow(orderNoteSchema, await readJsonBody(request));

  const order = await addOrderNote(context, orderId, body);

  return created({ order });
});
