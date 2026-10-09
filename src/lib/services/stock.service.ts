import 'server-only';

import { Prisma } from '@/generated/prisma/client';

import { StockMovementType, StockTransferStatus } from '@/generated/prisma/enums';
import { NotFoundError, ValidationError, isPrismaLikeError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { findStockLevels, type LowStockProductRow } from '@/lib/inventory/stock-levels';
import {
  buildPagination,
  buildStockMovementOrderBy,
  buildStockMovementWhere,
  type Pagination,
} from '@/lib/inventory/query';
import { formatTransferNumber } from '@/lib/inventory/validation';
import type {
  StockAdjustmentInput,
  StockMovementQuery,
  StockReceiptInput,
  StockTransferInput,
} from '@/lib/inventory/validation';
import { assertPermission, type AuthorizationContext } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';

const log = logger.child('stock');

/**
 * The stock ledger.
 *
 * Three properties this service exists to guarantee, because a warehouse system
 * that breaks any of them is worse than a spreadsheet:
 *
 *  1. **Every change is recorded.** A quantity never moves without a
 *     `StockMovement` row in the same transaction, so the balance can always be
 *     traced back to the movements that produced it.
 *  2. **No balance goes negative, and no update is lost.** Before a movement is
 *     written the row is locked with `SELECT ... FOR UPDATE`. Two simultaneous
 *     adjustments to the same product therefore serialize instead of both
 *     reading the same starting quantity and overwriting one another.
 *  3. **Order effects are idempotent.** An order that has already had stock
 *     deducted cannot be deducted again, and an order that was never deducted
 *     cannot have stock released. Both are guarded by a pre-check plus the
 *     partial unique indexes on `stock_movements`.
 *
 * The order-facing functions (`deductOrderStock`, `releaseOrderStock`) are
 * called from the order service *inside its own transaction*, so a status change
 * and its stock consequence commit or roll back together.
 */

const MOVEMENT_SELECT = {
  id: true,
  type: true,
  quantity: true,
  quantityBefore: true,
  quantityAfter: true,
  reason: true,
  orderId: true,
  transferId: true,
  createdAt: true,
  product: { select: { id: true, sku: true, name: true, unit: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  user: { select: { id: true, name: true } },
} as const;

type MovementRow = Prisma.StockMovementGetPayload<{ select: typeof MOVEMENT_SELECT }>;

export interface StockMovementDto {
  id: string;
  type: string;
  /** Signed change applied to the warehouse balance. */
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string | null;
  orderId: string | null;
  transferId: string | null;
  product: { id: string; sku: string; name: string; unit: string };
  warehouse: { id: string; code: string; name: string };
  user: { id: string; name: string } | null;
  createdAt: string;
}

export interface StockTransferDto {
  id: string;
  number: string;
  fromWarehouse: { id: string; code: string; name: string };
  toWarehouse: { id: string; code: string; name: string };
  quantity: number;
  status: string;
  notes: string | null;
  movements: StockMovementDto[];
  createdAt: string;
}

function toMovementDto(row: MovementRow): StockMovementDto {
  return {
    id: row.id,
    type: row.type,
    quantity: row.quantity,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    reason: row.reason,
    orderId: row.orderId,
    transferId: row.transferId,
    product: row.product,
    warehouse: row.warehouse,
    user: row.user,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Row-level locking
// ---------------------------------------------------------------------------

/**
 * Locks one product row for the rest of the transaction.
 *
 * This is the serialization point for the whole module. Taking it *first*, and
 * always in ascending product id order, is what prevents deadlocks when one
 * transaction touches several products (an order deduction) while another moves
 * a different subset of them. Every mutation path takes this lock before any
 * `inventory_stocks` row is touched, so two transactions can never hold stock
 * row locks on the same product in opposite orders.
 *
 * @param includeArchived lets the release path lock a product that has been
 *   archived since the order was confirmed: the stock is still physically there
 *   and must go back where it came from.
 *
 * The lookup is tenant-scoped and returns null for a product in another
 * organization, so a guessed id is indistinguishable from an unknown one.
 */
async function lockProduct(
  tx: Prisma.TransactionClient,
  organizationId: string,
  productId: string,
  includeArchived = false,
): Promise<{ id: string; name: string; unit: string } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; name: string; unit: string }>>(Prisma.sql`
    SELECT "id", "name", "unit" FROM "products"
      WHERE "id" = ${productId}::uuid
        AND "organization_id" = ${organizationId}::uuid
        ${includeArchived ? Prisma.empty : Prisma.sql`AND "archived_at" IS NULL`}
      FOR UPDATE
  `);

  return rows[0] ?? null;
}

/** Locks one product's stock rows, in a stable order, for the transaction. */
async function lockStockRows(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ quantity: number }>>(Prisma.sql`
    SELECT "quantity" FROM "inventory_stocks"
      WHERE "product_id" = ${productId}::uuid
        AND "warehouse_id" = ${warehouseId}::uuid
      FOR UPDATE
  `);

  return rows[0]?.quantity ?? 0;
}

/**
 * Applies a signed change to one balance and records the movement that caused
 * it, in the caller's transaction.
 *
 * @throws {ValidationError} when the change would drive the balance negative.
 *   Stock is real: the check happens *before* the movement row is written, so
 *   the member sees a field-level error rather than a database constraint
 *   violation.
 */
async function applyMovement(
  tx: Prisma.TransactionClient,
  entry: {
    organizationId: string;
    productId: string;
    warehouseId: string;
    type: StockMovementType;
    quantity: number;
    reason?: string | null;
    orderId?: string | null;
    transferId?: string | null;
    userId?: string | null;
    /** Quantity as read under the product lock, so the check cannot go stale. */
    current: number;
  },
): Promise<StockMovementDto> {
  if (entry.quantity === 0) {
    throw new ValidationError([
      { path: 'quantity', message: 'The quantity must change the stock; zero is not a movement.' },
    ]);
  }

  const quantityBefore = entry.current;
  const quantityAfter = quantityBefore + entry.quantity;

  if (quantityAfter < 0) {
    throw new ValidationError([
      {
        path: 'quantity',
        message: `Not enough stock: this would leave ${quantityAfter} in the warehouse.`,
      },
    ]);
  }

  // The row is upserted rather than inserted because a product has no balance row
  // until its first receipt, and the unique index on `(product_id, warehouse_id)`
  // makes the create path safe under the product lock taken above.
  await tx.inventoryStock.upsert({
    where: {
      productId_warehouseId: { productId: entry.productId, warehouseId: entry.warehouseId },
    },
    create: {
      organizationId: entry.organizationId,
      productId: entry.productId,
      warehouseId: entry.warehouseId,
      quantity: quantityAfter,
    },
    update: { quantity: quantityAfter },
  });

  const movement = await tx.stockMovement.create({
    data: {
      organizationId: entry.organizationId,
      productId: entry.productId,
      warehouseId: entry.warehouseId,
      type: entry.type,
      quantity: entry.quantity,
      quantityBefore,
      quantityAfter,
      reason: entry.reason ?? null,
      orderId: entry.orderId ?? null,
      transferId: entry.transferId ?? null,
      userId: entry.userId ?? null,
    },
    select: MOVEMENT_SELECT,
  });

  return toMovementDto(movement);
}

/** Validates a warehouse id belongs to the caller's organization and is active. */
async function requireActiveWarehouse(
  tx: Prisma.TransactionClient,
  organizationId: string,
  warehouseId: string,
  path: string,
): Promise<{ id: string; code: string; name: string }> {
  // The lookup deliberately does not filter on `archived_at`, so an id the
  // organization *used* to have can be told apart from one it never had. The
  // message matters: "that warehouse is archived, pick another" tells the member
  // what to do, while "does not exist" would leave them hunting for a typo that
  // is not there.
  const rows = await tx.$queryRaw<
    Array<{ id: string; code: string; name: string; archivedAt: Date | null }>
  >(Prisma.sql`
    SELECT "id", "code", "name", "archived_at" AS "archivedAt" FROM "warehouses"
      WHERE "id" = ${warehouseId}::uuid
        AND "organization_id" = ${organizationId}::uuid
  `);

  const warehouse = rows[0];

  if (!warehouse) {
    throw new ValidationError([
      { path, message: 'That warehouse does not exist in this organization.' },
    ]);
  }

  if (warehouse.archivedAt) {
    throw new ValidationError([
      { path, message: 'That warehouse is archived. Choose an active one.' },
    ]);
  }

  return { id: warehouse.id, code: warehouse.code, name: warehouse.name };
}

// ---------------------------------------------------------------------------
// Receipts and adjustments
// ---------------------------------------------------------------------------

/**
 * Records stock arriving at a warehouse — an opening balance or a delivery.
 *
 * Always positive: `ADJUSTMENT` is the type for a decrease, and having a
 * negative receipt would let a sign mistake silently destroy stock.
 */
export async function receiveStock(
  context: AuthorizationContext,
  input: StockReceiptInput,
): Promise<StockMovementDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_STOCK_ADJUST);

  const movement = await db.$transaction(async (tx) => {
    const warehouse = await requireActiveWarehouse(
      tx,
      context.organizationId,
      input.warehouseId,
      'warehouseId',
    );

    const product = await lockProduct(tx, context.organizationId, input.productId);
    if (!product) {
      throw new ValidationError([
        { path: 'productId', message: 'That product does not exist in this organization.' },
      ]);
    }

    const current = await lockStockRows(tx, product.id, warehouse.id);

    return applyMovement(tx, {
      organizationId: context.organizationId,
      productId: product.id,
      warehouseId: warehouse.id,
      type: StockMovementType.RECEIPT,
      quantity: input.quantity,
      reason: input.reason ?? null,
      userId: context.userId,
      current,
    });
  });

  log.info('Stock received', {
    organizationId: context.organizationId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    quantity: input.quantity,
    userId: context.userId,
  });

  return movement;
}

/**
 * Corrects a balance after a stock count.
 *
 * The only operation that accepts a negative quantity, because discovering that
 * 3 units are missing *is* a legitimate correction. A reason is mandatory and
 * lands on the movement row, so the ledger explains the gap rather than hiding
 * it.
 */
export async function adjustStock(
  context: AuthorizationContext,
  input: StockAdjustmentInput,
): Promise<StockMovementDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_STOCK_ADJUST);

  const movement = await db.$transaction(async (tx) => {
    const warehouse = await requireActiveWarehouse(
      tx,
      context.organizationId,
      input.warehouseId,
      'warehouseId',
    );

    const product = await lockProduct(tx, context.organizationId, input.productId);
    if (!product) {
      throw new ValidationError([
        { path: 'productId', message: 'That product does not exist in this organization.' },
      ]);
    }

    const current = await lockStockRows(tx, product.id, warehouse.id);

    return applyMovement(tx, {
      organizationId: context.organizationId,
      productId: product.id,
      warehouseId: warehouse.id,
      type: StockMovementType.ADJUSTMENT,
      quantity: input.quantity,
      reason: input.reason,
      userId: context.userId,
      current,
    });
  });

  log.info('Stock adjusted', {
    organizationId: context.organizationId,
    productId: input.productId,
    warehouseId: input.warehouseId,
    quantity: input.quantity,
    userId: context.userId,
  });

  return movement;
}

/**
 * Moves stock between two warehouses of the same organization.
 *
 * Two movements are written in one transaction — `TRANSFER_OUT` at the source and
 * `TRANSFER_IN` at the destination — so the organization's total stock is
 * conserved and neither side can be committed without the other. Locking the
 * product row first serializes the whole transfer against every other change to
 * that product.
 */
export async function transferStock(
  context: AuthorizationContext,
  input: StockTransferInput,
): Promise<StockTransferDto> {
  assertPermission(context, PERMISSIONS.INVENTORY_STOCK_TRANSFER);

  const result = await db.$transaction(async (tx) => {
    const [from, to] = await Promise.all([
      requireActiveWarehouse(tx, context.organizationId, input.fromWarehouseId, 'fromWarehouseId'),
      requireActiveWarehouse(tx, context.organizationId, input.toWarehouseId, 'toWarehouseId'),
    ]);

    const product = await lockProduct(tx, context.organizationId, input.productId);
    if (!product) {
      throw new ValidationError([
        { path: 'productId', message: 'That product does not exist in this organization.' },
      ]);
    }

    const fromCurrent = await lockStockRows(tx, product.id, from.id);
    const toCurrent = await lockStockRows(tx, product.id, to.id);

    const sequence = await tx.stockTransferSequence.upsert({
      where: { organizationId: context.organizationId },
      create: { organizationId: context.organizationId, lastNumber: 1 },
      update: { lastNumber: { increment: 1 } },
      select: { lastNumber: true },
    });

    const transfer = await tx.stockTransfer.create({
      data: {
        organizationId: context.organizationId,
        number: formatTransferNumber(sequence.lastNumber),
        fromWarehouseId: from.id,
        toWarehouseId: to.id,
        status: StockTransferStatus.COMPLETED,
        notes: input.reason ?? null,
        userId: context.userId,
      },
      select: { id: true, number: true },
    });

    const out = await applyMovement(tx, {
      organizationId: context.organizationId,
      productId: product.id,
      warehouseId: from.id,
      type: StockMovementType.TRANSFER_OUT,
      quantity: -input.quantity,
      reason: input.reason ?? null,
      transferId: transfer.id,
      userId: context.userId,
      current: fromCurrent,
    });

    const inbound = await applyMovement(tx, {
      organizationId: context.organizationId,
      productId: product.id,
      warehouseId: to.id,
      type: StockMovementType.TRANSFER_IN,
      quantity: input.quantity,
      reason: input.reason ?? null,
      transferId: transfer.id,
      userId: context.userId,
      current: toCurrent,
    });

    return { transfer, from, to, out, inbound };
  });

  log.info('Stock transferred', {
    organizationId: context.organizationId,
    productId: input.productId,
    fromWarehouseId: input.fromWarehouseId,
    toWarehouseId: input.toWarehouseId,
    quantity: input.quantity,
    userId: context.userId,
  });

  return {
    id: result.transfer.id,
    number: result.transfer.number,
    fromWarehouse: result.from,
    toWarehouse: result.to,
    quantity: input.quantity,
    status: 'COMPLETED',
    notes: input.reason ?? null,
    movements: [result.out, result.inbound],
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Movement history
// ---------------------------------------------------------------------------

/** The stock ledger, filtered and paginated. */
export async function listStockMovements(
  context: AuthorizationContext,
  query: StockMovementQuery,
): Promise<{ movements: StockMovementDto[]; pagination: Pagination }> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const where = buildStockMovementWhere(context, query);

  const [rows, total] = await db.$transaction([
    db.stockMovement.findMany({
      where,
      select: MOVEMENT_SELECT,
      orderBy: buildStockMovementOrderBy(query.sort, query.order),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.stockMovement.count({ where }),
  ]);

  return {
    movements: rows.map(toMovementDto),
    pagination: buildPagination(query.page, query.limit, total),
  };
}

/** Movements for one product, for its detail page. */
export async function listProductStockMovements(
  context: AuthorizationContext,
  productId: string,
  query: StockMovementQuery,
) {
  return listStockMovements(context, { ...query, productId });
}

/** Movements for one warehouse, for its detail page. */
export async function listWarehouseStockMovements(
  context: AuthorizationContext,
  warehouseId: string,
  query: StockMovementQuery,
) {
  return listStockMovements(context, { ...query, warehouseId });
}

/** The paginated low-stock report. */
export async function listLowStock(
  context: AuthorizationContext,
  query: { page?: number; limit?: number; level?: 'low' | 'out' } = {},
): Promise<{ rows: LowStockProductRow[]; pagination: Pagination }> {
  assertPermission(context, PERMISSIONS.INVENTORY_READ);

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const level = query.level ?? 'low';

  // A separate count mirrors the report's WHERE clause. Reusing the row query
  // for the total would mean fetching every match just to count it.
  const [rows, count] = await Promise.all([
    findStockLevels(context.organizationId, level, { limit, offset: (page - 1) * limit }),
    db.$queryRaw<Array<{ total: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS "total" FROM (
        SELECT 1
        FROM "products" p
        LEFT JOIN "inventory_stocks" s ON s."product_id" = p."id"
        WHERE p."organization_id" = ${context.organizationId}::uuid
          AND p."archived_at" IS NULL
        GROUP BY p."id", p."reorder_threshold"
        HAVING (
          CASE WHEN ${level === 'out'}
            THEN COALESCE(SUM(s."quantity"), 0) = 0
            ELSE COALESCE(SUM(s."quantity"), 0) <= p."reorder_threshold"
                 AND p."reorder_threshold" > 0
          END
        )
      ) flagged
    `),
  ]);

  return { rows, pagination: buildPagination(page, limit, count[0]?.total ?? 0) };
}

// ---------------------------------------------------------------------------
// Order integration
//
// The exact policy, in one place:
//
//  * Creating or editing an order touches no stock. An order is a commitment
//    from the moment it is placed, and stock is still physically in the
//    warehouse; deducting at creation would make a cancelled order look like it
//    had consumed goods that never left.
//  * **Confirming** an order (PENDING -> CONFIRMED) deducts stock. This is the
//    point the organization has committed to the sale, so the units leave the
//    floor immediately rather than after shipping catches up.
//  * **Cancelling** a confirmed order releases stock. Cancelling an order that
//    was never confirmed releases nothing, because nothing was taken.
//  * Later transitions (PROCESSING, SHIPPED, DELIVERED) do not change stock.
//    They track fulfilment, and the units have already left inventory.
//
// Both effects are idempotent: a pre-check for an existing movement on the
// order makes a retried request a no-op, and the partial unique indexes on
// `stock_movements` make a *concurrent* duplicate fail rather than double-count.
//
// These functions run inside the caller's order transaction, so a status change
// and its stock consequence commit or roll back together. They are here rather
// than in the order service so the locking rules stay in one module.
// ---------------------------------------------------------------------------

/** The shape of an order these functions need; `OrderRow` satisfies it. */
export interface OrderStockSubject {
  id: string;
  orderNumber: string;
  items: ReadonlyArray<{
    productId: string | null;
    productName: string;
    quantity: number;
  }>;
}

/** Result of applying (or declining to re-apply) an order's stock effect. */
export interface OrderStockEffect {
  /** Units of stock that actually moved. Zero when the order had no products. */
  units: number;
  /** True when the effect had already been applied and this call did nothing. */
  alreadyApplied: boolean;
  /** True when the order carries no stocked products. */
  skipped: boolean;
}

interface DeductionStep {
  productId: string;
  productName: string;
  warehouseId: string;
  /** Warehouse balances at the time they were locked, adjusted as we deduct. */
  onHand: number;
  quantity: number;
}

/**
 * Reads one product's warehouse balances, locked for the transaction.
 *
 * Ordered by `warehouse_id` so the lock order is identical in every
 * transaction: that, plus the product lock taken first, is what makes
 * concurrent deductions of two different warehouses deadlock-free.
 */
async function readStockForDeduction(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<Array<{ warehouseId: string; code: string; quantity: number; isPrimary: boolean }>> {
  const rows = await tx.$queryRaw<
    Array<{ warehouseId: string; code: string; quantity: number; isPrimary: boolean }>
  >(Prisma.sql`
    SELECT s."warehouse_id" AS "warehouseId",
           w."code"         AS "code",
           s."quantity"     AS "quantity",
           w."is_primary"   AS "isPrimary"
    FROM "inventory_stocks" s
    JOIN "warehouses" w ON w."id" = s."warehouse_id"
    WHERE s."product_id" = ${productId}::uuid
    ORDER BY s."warehouse_id"
    FOR UPDATE OF s
  `);

  return rows;
}

/**
 * Deducts stock for a confirmed order.
 *
 * Which warehouse the units come from is a policy, not a preference: the
 * organization's **primary** warehouse first, then whichever warehouse holds the
 * most of that product, breaking ties on the warehouse code. That order is
 * deterministic, so the same order always explains itself the same way, and no
 * input from the client is involved.
 *
 * An order line that is out of stock everywhere aborts the whole confirmation
 * with a field-level error naming the product — the order stays `PENDING`, and
 * because this runs inside the order's transaction, not one unit has moved.
 */
export async function deductOrderStock(
  tx: Prisma.TransactionClient,
  context: AuthorizationContext,
  order: OrderStockSubject,
): Promise<OrderStockEffect> {
  const products = order.items.filter((item) => item.productId !== null);
  if (products.length === 0) return { units: 0, alreadyApplied: false, skipped: true };

  // Idempotency: an order that already has stock deducted is left alone. Without
  // this, a client retrying a timed-out confirmation would charge the order
  // twice and the stock ledger would drift from the order it claims to mirror.
  const applied = await tx.stockMovement.findFirst({
    where: { orderId: order.id, type: StockMovementType.ORDER_DEDUCTION },
    select: { id: true },
  });
  if (applied) return { units: 0, alreadyApplied: true, skipped: false };

  // Demand is summed per product first. An order may list the same product on
  // two lines, and assessing them separately would let the second line be
  // measured against stock the first line had not yet consumed.
  const demand = new Map<string, { name: string; unit: string; quantity: number }>();
  for (const item of products) {
    const existing = demand.get(item.productId!);
    if (existing) existing.quantity += item.quantity;
    else
      demand.set(item.productId!, { name: item.productName, unit: 'pcs', quantity: item.quantity });
  }

  const productIds = [...demand.keys()].sort();

  // Pass one: lock every product, then verify the demand against real stock.
  const steps: DeductionStep[] = [];

  for (const productId of productIds) {
    const needed = demand.get(productId)!;
    const product = await lockProduct(tx, context.organizationId, productId);

    if (!product) {
      throw new ValidationError([
        {
          path: '(root)',
          message: `${needed.name} is no longer available in the catalogue, so this order cannot be confirmed.`,
        },
      ]);
    }

    const balances = await readStockForDeduction(tx, productId);
    const available = balances.reduce((sum, balance) => sum + balance.quantity, 0);

    if (available < needed.quantity) {
      throw new ValidationError([
        {
          path: '(root)',
          message: `Not enough stock for ${product.name}: ${available} ${product.unit} on hand, ${needed.quantity} needed. Receive or transfer stock before confirming.`,
        },
      ]);
    }

    // Primary first, then the fullest warehouse, then the code — deterministic
    // so the ledger always explains itself the same way for the same order.
    const ordered = [...balances].sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        b.quantity - a.quantity ||
        a.code.localeCompare(b.code),
    );

    let remaining = needed.quantity;
    for (const balance of ordered) {
      if (remaining === 0) break;
      const quantity = Math.min(remaining, balance.quantity);
      if (quantity <= 0) continue;

      steps.push({
        productId,
        productName: product.name,
        warehouseId: balance.warehouseId,
        onHand: balance.quantity,
        quantity,
      });
      remaining -= quantity;
    }
  }

  // Pass two: write the movements. Nothing here can fail on availability —
  // every quantity was verified above under the locks we still hold.
  let units = 0;
  for (const step of steps) {
    await applyMovement(tx, {
      organizationId: context.organizationId,
      productId: step.productId,
      warehouseId: step.warehouseId,
      type: StockMovementType.ORDER_DEDUCTION,
      quantity: -step.quantity,
      reason: `Deducted for order ${order.orderNumber}.`,
      orderId: order.id,
      userId: context.userId,
      current: step.onHand,
    });
    units += step.quantity;
  }

  return { units, alreadyApplied: false, skipped: false };
}

/**
 * Releases the stock a cancelled order had deducted.
 *
 * Only ever called for an order that was `CONFIRMED` or later, so the movement
 * rows it reverses are guaranteed to exist — but the pre-check is still there,
 * because a retried cancellation must not restore stock the order never took.
 */
export async function releaseOrderStock(
  tx: Prisma.TransactionClient,
  context: AuthorizationContext,
  order: OrderStockSubject,
): Promise<OrderStockEffect> {
  // Idempotency: an order whose stock was already released is left alone.
  const released = await tx.stockMovement.findFirst({
    where: { orderId: order.id, type: StockMovementType.ORDER_RELEASE },
    select: { id: true },
  });
  if (released) return { units: 0, alreadyApplied: true, skipped: false };

  const deductions = await tx.stockMovement.findMany({
    where: { orderId: order.id, type: StockMovementType.ORDER_DEDUCTION },
    select: { productId: true, warehouseId: true, quantity: true },
  });

  if (deductions.length === 0) return { units: 0, alreadyApplied: false, skipped: true };

  const productIds = [...new Set(deductions.map((movement) => movement.productId))].sort();

  // Archived products are still locked: their stock is physically present and
  // cancelling an order must put it back exactly where it came from.
  for (const productId of productIds) {
    await lockProduct(tx, context.organizationId, productId, true);
  }

  let units = 0;
  for (const deduction of deductions) {
    const current = await lockStockRows(tx, deduction.productId, deduction.warehouseId);

    await applyMovement(tx, {
      organizationId: context.organizationId,
      productId: deduction.productId,
      warehouseId: deduction.warehouseId,
      type: StockMovementType.ORDER_RELEASE,
      quantity: -deduction.quantity,
      reason: `Released by cancellation of order ${order.orderNumber}.`,
      orderId: order.id,
      userId: context.userId,
      current,
    });
    units += -deduction.quantity;
  }

  return { units, alreadyApplied: false, skipped: false };
}

export { NotFoundError, isPrismaLikeError };
