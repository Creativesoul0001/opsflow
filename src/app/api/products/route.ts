import { created, ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { createProductSchema, productListQuerySchema } from '@/lib/inventory/validation';
import { createProduct, listProducts } from '@/lib/services/inventory.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/products` — list, search, filter, sort and paginate products.
 *
 * Filtering happens in Postgres via `buildProductWhere`, which always pins the
 * caller's organization, so no amount of query-string input can widen the result
 * set beyond the tenant. `?stock=low` and `?stock=out` are resolved by the SQL
 * helper in `inventory/stock-levels`, because comparing a summed quantity
 * against the product's own threshold cannot be expressed in the query builder.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseOrThrow(productListQuerySchema, params);

  const { products, pagination } = await listProducts(context, query);

  return ok({ products }, { pagination });
});

/**
 * `POST /api/products` — create a product in the caller's organization.
 *
 * Only the catalogue fields are accepted: the SKU, name, category, prices,
 * reorder threshold and unit. `organizationId` is never read from the payload,
 * and stock is not part of this operation — a product has no balances until its
 * first receipt, which writes its own movement.
 */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(createProductSchema, await readJsonBody(request));

  const product = await createProduct(context, input);

  return created({ product });
});
