import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { parseProductId, updateProductSchema } from '@/lib/inventory/validation';
import { archiveProduct, getProduct, updateProduct } from '@/lib/services/inventory.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `GET /api/products/:id`
 *
 * Knowing a product id is not sufficient: the lookup is scoped to the caller's
 * organization, so another tenant's id returns the same 404 as a missing record.
 */
export const GET = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const product = await getProduct(context, parseProductId((await params).id));

  return ok({ product });
});

/**
 * `PATCH /api/products/:id` — partial update of the catalogue fields.
 *
 * `sku` may change, and a collision inside the organization comes back as a
 * field-level error rather than a raw constraint name. Archiving is deliberately
 * not reachable from here: it has its own permission and its own endpoint.
 */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(updateProductSchema, await readJsonBody(request));
  const product = await updateProduct(context, parseProductId((await params).id), input);

  return ok({ product });
});

/**
 * `DELETE /api/products/:id` — archive a product.
 *
 * Archiving rather than deletion: order lines and stock movements reference the
 * product, so a permanent delete would either break order history or cascade it
 * away. No endpoint destroys a product.
 */
export const DELETE = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const product = await archiveProduct(context, parseProductId((await params).id));

  return ok({ product });
});
