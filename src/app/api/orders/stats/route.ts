import { ok, route } from '@/lib/api/responses';
import { requireApiContext } from '@/lib/auth/session';
import { getOrderStats } from '@/lib/services/order.service';

export const dynamic = 'force-dynamic';

/**
 * `GET /api/orders/stats` — real counts and revenue for the dashboard.
 *
 * Every figure is computed in Postgres against the caller's organization, so
 * there is no cached rollup that could show one tenant's numbers to another.
 * Counts are never invented to fill a card: a metric that has no data reads as
 * zero rather than an aspirational number.
 *
 * Read-only and gated on `orders:read`, matching the list endpoint that feeds
 * the page these numbers summarize.
 */
export const GET = route(async (request: Request): Promise<Response> => {
  const context = await requireApiContext(request);
  const stats = await getOrderStats(context);

  return ok({ stats });
});
