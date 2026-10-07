import { created, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { customerNoteSchema, parseCustomerId } from '@/lib/customers/validation';
import { addCustomerNote } from '@/lib/services/customer.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `POST /api/customers/:id/notes` — append a note.
 *
 * Notes are a first-class resource because they have their own validation
 * ceiling and they are the only CRM write a member without `customers:update`
 * on other fields still needs; keeping them separate avoids a PATCH that rewrites
 * the whole notes column from a stale client copy.
 */
export const POST = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const customerId = parseCustomerId((await params).id);

  const { body } = parseOrThrow(customerNoteSchema, await readJsonBody(request));
  const customer = await addCustomerNote(context, customerId, body);

  return created({ customer });
});
