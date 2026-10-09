import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { getInventoryStats } from '@/lib/services/inventory.service';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/inventory/stats` — real dashboard statistics.
 *
 * Every figure is scoped to the caller's organization by the service, so two
 * tenants never see each other's stock or their warehouse count. Nothing here is
 * a placeholder: if a number cannot be computed from the database it is not
 * returned.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);

  const stats = await getInventoryStats(context);

  return ok({ stats });
});
