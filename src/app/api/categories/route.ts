import { created, ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { createProductCategorySchema } from '@/lib/inventory/validation';
import { createProductCategory, listProductCategories } from '@/lib/services/inventory.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/categories` — the organization's product categories.
 *
 * The list is unpaginated on purpose: a category set is a small, curated
 * vocabulary rather than a data table, and it feeds a picker that has to show
 * every option at once.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get('archived') === 'true';

  const categories = await listProductCategories(context, { includeArchived });

  return ok({ categories });
});

/** `POST /api/categories` — create a grouping. */
export const POST = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(createProductCategorySchema, await readJsonBody(request));

  const category = await createProductCategory(context, input);

  return created({ category });
});
