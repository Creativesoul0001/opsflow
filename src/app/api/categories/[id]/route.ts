import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { parseProductCategoryId, updateProductCategorySchema } from '@/lib/inventory/validation';
import { archiveProductCategory, updateProductCategory } from '@/lib/services/inventory.service';
import { parseOrThrow, readJsonBody } from '@/lib/validation';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ id: string }>;
}

/**
 * `PATCH /api/categories/:id` — rename a grouping or change its description.
 *
 * The name is unique within the organization, so a collision is reported
 * against the `name` field rather than as a raw constraint name.
 */
export const PATCH = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const input = parseOrThrow(updateProductCategorySchema, await readJsonBody(request));
  const category = await updateProductCategory(
    context,
    parseProductCategoryId((await params).id),
    input,
  );

  return ok({ category });
});

/**
 * `DELETE /api/categories/:id` — archive a grouping.
 *
 * The products inside it are kept and become uncategorised, because the grouping
 * is retired rather than destroyed. No endpoint deletes a category.
 */
export const DELETE = route(async (request: Request, { params }: Params): Promise<Response> => {
  const context = await requireApiContext(request);
  const category = await archiveProductCategory(context, parseProductCategoryId((await params).id));

  return ok({ category });
});
