import 'server-only';

import { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';

/**
 * Stock-level reporting for the Inventory module.
 *
 * "Is this product low on stock?" compares two columns on the same row — the
 * summed quantity across every warehouse and the product's own reorder
 * threshold — which Prisma's query API cannot express. Doing it in raw SQL keeps
 * the comparison inside the database, so it stays one indexed query instead of
 * reading every stock row into Node and summing it there.
 *
 * Everything this module reads is pinned to a single `organizationId`, which the
 * service layer has already verified against a membership. The caller passes
 * that id and nothing else that could widen the result set.
 */

export interface LowStockProductRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  reorderThreshold: number;
  /** Sum of the product's quantity across every warehouse. */
  totalQuantity: number;
  /** How many warehouses hold a row for it (0 when it has never been stocked). */
  warehouseCount: number;
}

export interface StockLevelCounts {
  /** Products with at least one unit on hand but at or below the threshold. */
  low: number;
  /** Products with nothing on hand anywhere, regardless of the threshold. */
  out: number;
}

/**
 * Stock levels for one organization.
 *
 * The `LEFT JOIN` means a product with no stock row at all reports a total of
 * zero rather than disappearing, which is what makes "out of stock" mean
 * something for a catalogue entry that was never received.
 *
 * @param level `low` selects products in stock but at or below their reorder
 *   threshold (a threshold of zero means "no reorder point configured" and is
 *   therefore never reported); `out` selects products with nothing on hand.
 * @param window page size and offset, so the report can be paginated like every
 *   other list in the application.
 */
export async function findStockLevels(
  organizationId: string,
  level: 'low' | 'out',
  window: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<LowStockProductRow[]> {
  return db.$queryRaw<LowStockProductRow[]>(Prisma.sql`
    SELECT
      p.id                AS "productId",
      p.sku               AS "sku",
      p.name              AS "name",
      p.unit              AS "unit",
      p.reorder_threshold AS "reorderThreshold",
      COALESCE(SUM(s."quantity"), 0)::int          AS "totalQuantity",
      COUNT(s."warehouse_id")::int                 AS "warehouseCount"
    FROM "products" p
    LEFT JOIN "inventory_stocks" s ON s."product_id" = p."id"
    WHERE p."organization_id" = ${organizationId}::uuid
      AND p."archived_at" IS NULL
    GROUP BY p."id", p."sku", p."name", p."unit", p."reorder_threshold"
    HAVING (
      CASE WHEN ${level === 'out'}
        THEN COALESCE(SUM(s."quantity"), 0) = 0
        ELSE COALESCE(SUM(s."quantity"), 0) <= p."reorder_threshold"
             AND p."reorder_threshold" > 0
      END
    )
    ORDER BY COALESCE(SUM(s."quantity"), 0) ASC, p."name" ASC
    LIMIT ${window.limit} OFFSET ${window.offset}
  `);
}

/** Low-stock and out-of-stock counts for the dashboard, in one round trip. */
export async function countStockLevels(organizationId: string): Promise<StockLevelCounts> {
  const rows = await db.$queryRaw<Array<{ total: bigint; out: bigint; low: bigint }>>(Prisma.sql`
    SELECT
      COUNT(*)::bigint                                        AS "total",
      COUNT(*) FILTER (WHERE summed = 0)::bigint              AS "out",
      COUNT(*) FILTER (
        WHERE summed > 0 AND summed <= threshold AND threshold > 0
      )::bigint                                               AS "low"
    FROM (
      SELECT p."reorder_threshold" AS threshold,
             COALESCE(SUM(s."quantity"), 0)::int AS summed
      FROM "products" p
      LEFT JOIN "inventory_stocks" s ON s."product_id" = p."id"
      WHERE p."organization_id" = ${organizationId}::uuid
        AND p."archived_at" IS NULL
      GROUP BY p."id", p."reorder_threshold"
    ) levels
  `);

  const row = rows[0];
  return { low: Number(row?.low ?? 0), out: Number(row?.out ?? 0) };
}
