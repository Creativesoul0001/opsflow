import 'server-only';

import { OrderActivityType, OrderStatus } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { ConflictError, isPrismaLikeError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  computeOrderTotals,
  formatTaxRateBp,
  type ComputedOrderTotals,
} from '@/lib/orders/calculation';
import { formatOrderNumber } from '@/lib/orders/number';
import { buildOrderOrderBy, buildOrderWhere } from '@/lib/orders/query';
import {
  canCancel,
  isTerminalOrderStatus,
  transitionRejection,
  ORDER_STATUS_LABELS,
  type OrderStatusValue,
} from '@/lib/orders/status';
import type {
  OrderActivityQuery,
  CreateOrderInput,
  OrderListQuery,
  UpdateOrderInput,
} from '@/lib/orders/validation';
import { assertPermission, type AuthorizationContext } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import { buildPagination } from '@/lib/pagination';
import {
  listActiveMembers,
  requireActiveMember,
  type AssignableMember,
} from '@/lib/services/members.service';

const log = logger.child('orders');

/**
 * Order service.
 *
 * Authorization and tenant scoping live here rather than in the route handlers
 * so the checks cannot be bypassed by adding a new caller. Three invariants hold
 * throughout, and each has its own test:
 *
 *  1. Every read filters on `organizationId: context.organizationId`, which comes
 *     from a verified membership — never from the request.
 *  2. Single-record lookups use `findFirst({ where: { id, organizationId } })`
 *     rather than `findUnique({ where: { id } })`, so the tenant predicate is part
 *     of the same query. A caller who knows another tenant's order id gets the
 *     same 404 as for a non-existent id, which confirms nothing.
 *  3. Every money value is derived by `computeOrderTotals` from the submitted
 *     line items. No route, no form and no client can set `subtotal`, `total`,
 *     `tax` or `discount` directly — those fields are not part of any input
 *     schema, so there is no code path in which a claimed total survives.
 */

const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  companyName: true,
  email: true,
  status: true,
  archivedAt: true,
} as const;

const ORDER_ITEM_SELECT = {
  id: true,
  productId: true,
  productName: true,
  quantity: true,
  unitPrice: true,
  discount: true,
  total: true,
  position: true,
} as const;

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  customerId: true,
  subtotal: true,
  discount: true,
  tax: true,
  taxRate: true,
  total: true,
  notes: true,
  assignedUserId: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  customer: {
    select: { id: true, firstName: true, lastName: true, email: true, companyName: true },
  },
  assignedUser: { select: { id: true, name: true, email: true } },
  items: { select: ORDER_ITEM_SELECT, orderBy: { position: 'asc' } as const },
} as const;

type OrderRow = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

export interface OrderItemDto {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  /** Major-unit decimal string, e.g. `"1250.50"`. */
  unitPrice: string;
  discount: string;
  total: string;
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  status: string;
  customerId: string;
  customer: {
    id: string;
    fullName: string;
    email: string;
    companyName: string | null;
  };
  subtotal: string;
  discount: string;
  tax: string;
  /** Percentage string, e.g. `"18.5"`. */
  taxRate: string;
  total: string;
  notes: string | null;
  assignedUserId: string | null;
  assignedUser: { id: string; name: string; email: string } | null;
  items: OrderItemDto[];
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderActivityDto {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export type { AssignableMember } from '@/lib/services/members.service';

export interface OrderStats {
  total: number;
  open: number;
  pending: number;
  shipped: number;
  cancelled: number;
  /** Sum of `total` for every order that was not cancelled, in major units. */
  revenue: string;
  newLast30Days: number;
}

const MAX_NOTES_LENGTH = 5_000;
const NEW_ORDER_WINDOW_DAYS = 30;

function toDto(row: OrderRow): OrderDto {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    status: row.status,
    customerId: row.customerId,
    customer: {
      id: row.customer.id,
      fullName: `${row.customer.firstName} ${row.customer.lastName}`.trim(),
      email: row.customer.email,
      companyName: row.customer.companyName,
    },
    subtotal: minor(row.subtotal),
    discount: minor(row.discount),
    tax: minor(row.tax),
    taxRate: formatTaxRateBp(row.taxRate),
    total: minor(row.total),
    notes: row.notes,
    assignedUserId: row.assignedUserId,
    assignedUser: row.assignedUser,
    items: row.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: minor(item.unitPrice),
      discount: minor(item.discount),
      total: minor(item.total),
    })),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Integer minor units -> the decimal string the API and the UI exchange. */
function minor(value: number): string {
  const whole = Math.trunc(value / 100);
  const fraction = Math.abs(value % 100);
  return `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * Loads one order inside the caller's organization.
 *
 * Returns 404 — not 403 — for an order in another organization, so the response
 * cannot be used to probe which ids exist elsewhere.
 */
async function requireOrder(
  context: AuthorizationContext,
  orderId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<OrderRow> {
  const order = await client.order.findFirst({
    where: { id: orderId, organizationId: context.organizationId },
    select: ORDER_SELECT,
  });

  if (!order) throw new NotFoundError('Order not found.');
  return order;
}

/**
 * Resolves the customer an order must belong to.
 *
 * The lookup is always tenant-scoped, so a customer id from another
 * organization is indistinguishable from one that does not exist. Archiving is
 * an explicit rejection rather than a silent no-op: an order for a customer the
 * member cannot otherwise reach should never be created by accident.
 */
async function requireOrderableCustomer(
  organizationId: string,
  customerId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<{ id: string; name: string }> {
  const customer = await client.customer.findFirst({
    where: { id: customerId, organizationId },
    select: CUSTOMER_SELECT,
  });

  if (!customer) {
    throw new ValidationError([
      { path: 'customerId', message: 'That customer does not exist in this organization.' },
    ]);
  }

  if (customer.archivedAt) {
    throw new ValidationError([
      { path: 'customerId', message: 'Archived customers cannot receive new orders.' },
    ]);
  }

  return {
    id: customer.id,
    name: `${customer.firstName} ${customer.lastName}`.trim(),
  };
}

function recordActivity(
  tx: Prisma.TransactionClient,
  entry: {
    context: AuthorizationContext;
    orderId: string;
    type: OrderActivityType;
    description: string;
  },
) {
  return tx.orderActivity.create({
    data: {
      organizationId: entry.context.organizationId,
      orderId: entry.orderId,
      // Nullable in the schema so history survives removal of the actor.
      userId: entry.context.userId,
      type: entry.type,
      description: entry.description,
    },
    select: { id: true },
  });
}

/**
 * Allocates the next order number for the organization.
 *
 * The counter row is upserted inside the order's own transaction, so the number
 * and the order it belongs to commit or roll back together. Two concurrent
 * creates cannot read the same value: `INSERT ... ON CONFLICT DO UPDATE`
 * increments the row while holding its lock.
 *
 * A gap is possible if the transaction aborts afterwards — that is normal for
 * sequence-like allocators and preferable to a number that is reused.
 */
async function nextOrderNumber(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<string> {
  const sequence = await tx.orderSequence.upsert({
    where: { organizationId },
    create: { organizationId, lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });

  return formatOrderNumber(sequence.lastNumber);
}

/**
 * Writes an order's money, customer and items, allocating the order number on
 * first write.
 *
 * Items are deleted and re-created rather than diffed: an order carries at most
 * a hundred lines, the whole write happens inside an existing transaction, and a
 * diff would be far more code for no visible benefit. Every stored amount comes
 * from `totals` — no caller-supplied subtotal or total is ever written.
 */
async function writeOrder(
  tx: Prisma.TransactionClient,
  args: {
    context: AuthorizationContext;
    order: OrderRow | null;
    customerId: string;
    totals: ComputedOrderTotals;
    notes: string | null;
    assignedUserId: string | null;
  },
): Promise<string> {
  const { context, order, customerId, totals } = args;

  const data: Omit<Prisma.OrderUncheckedCreateInput, 'orderNumber'> = {
    organizationId: context.organizationId,
    customerId,
    subtotal: totals.subtotalMinor,
    discount: totals.discountMinor,
    tax: totals.taxMinor,
    taxRate: totals.taxRateBp,
    total: totals.totalMinor,
    notes: args.notes,
    assignedUserId: args.assignedUserId,
  };

  if (order) {
    await tx.order.update({ where: { id: order.id }, data });
    await tx.orderItem.deleteMany({ where: { orderId: order.id } });
  }

  const target = order
    ? { id: order.id, orderNumber: order.orderNumber }
    : await tx.order.create({
        data: { ...data, orderNumber: await nextOrderNumber(tx, context.organizationId) },
        select: { id: true, orderNumber: true },
      });

  if (totals.lines.length > 0) {
    await tx.orderItem.createMany({
      data: totals.lines.map((line) => ({
        organizationId: context.organizationId,
        orderId: target.id,
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        unitPrice: line.unitPriceMinor,
        discount: line.discountMinor,
        total: line.totalMinor,
        position: line.index,
      })),
    });
  }

  return target.id;
}

/**
 * Detects the unique `(organizationId, orderNumber)` race and retries once.
 *
 * The allocator already serializes on the counter row, so this should never
 * fire; it exists so that a surprising interleaving degrades into a second
 * attempt rather than a 409 the member would have to retry by hand.
 */
async function withOrderNumberRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isOrderNumberCollision(error)) {
      log.warn('Order number collision, retrying once');
      return operation();
    }
    throw error;
  }
}

function isOrderNumberCollision(error: unknown): boolean {
  if (!isPrismaLikeError(error) || error.code !== 'P2002') return false;
  const target = error.meta?.target;
  const text = Array.isArray(target)
    ? target.join(',')
    : typeof target === 'string'
      ? target
      : JSON.stringify(target ?? null);
  return text.includes('organization_id') || text.includes('order_number');
}

/** Lists orders for the caller's organization with search, filters and paging. */
export async function listOrders(
  context: AuthorizationContext,
  query: OrderListQuery,
): Promise<{ orders: OrderDto[]; pagination: ReturnType<typeof buildPagination> }> {
  assertPermission(context, PERMISSIONS.ORDERS_READ);

  const where = buildOrderWhere(context, query);

  // A transaction keeps `total` and the page contents consistent when another
  // request writes between the two statements.
  const [rows, total] = await db.$transaction([
    db.order.findMany({
      where,
      select: ORDER_SELECT,
      orderBy: buildOrderOrderBy(query.sort, query.order),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.order.count({ where }),
  ]);

  return {
    orders: rows.map(toDto),
    pagination: buildPagination(query.page, query.limit, total),
  };
}

export async function getOrder(context: AuthorizationContext, orderId: string): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_READ);
  return toDto(await requireOrder(context, orderId));
}

export async function createOrder(
  context: AuthorizationContext,
  input: CreateOrderInput,
): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_CREATE);

  // Totals are computed before anything is written so an invalid amount fails
  // without leaving a partial order behind, and before the customer lookup so a
  // payload with both problems reports both.
  const totals = computeOrderTotals(input);
  const customer = await requireOrderableCustomer(context.organizationId, input.customerId);
  const assignee = input.assignedUserId
    ? await requireActiveMember(context.organizationId, input.assignedUserId)
    : null;

  const row = await withOrderNumberRetry(() =>
    db.$transaction(async (tx) => {
      const orderId = await writeOrder(tx, {
        context,
        order: null,
        customerId: customer.id,
        totals,
        notes: input.notes ?? null,
        assignedUserId: input.assignedUserId ?? null,
      });

      const created = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: ORDER_SELECT,
      });

      await recordActivity(tx, {
        context,
        orderId,
        type: OrderActivityType.CREATED,
        description: assignee
          ? `Order ${created.orderNumber} created by ${context.name} and assigned to ${assignee.name}.`
          : `Order ${created.orderNumber} created by ${context.name}.`,
      });

      return created;
    }),
  );

  log.info('Order created', {
    organizationId: context.organizationId,
    orderId: row.id,
    orderNumber: row.orderNumber,
    userId: context.userId,
  });

  return toDto(row);
}

/**
 * Edits an order's customer or money inputs.
 *
 * Only `PENDING` and `CONFIRMED` orders may be edited. Once fulfilment starts,
 * changing what was ordered would rewrite history, so later stages are refused
 * with a 409 rather than silently ignored.
 */
export async function updateOrder(
  context: AuthorizationContext,
  orderId: string,
  input: UpdateOrderInput,
): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_UPDATE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireOrder(context, orderId, tx);

    if (existing.status !== 'PENDING' && existing.status !== 'CONFIRMED') {
      throw new ConflictError(
        `An order that is ${ORDER_STATUS_LABELS[existing.status as OrderStatusValue].toLowerCase()} cannot be edited. Create a new order instead.`,
      );
    }

    const customerId = input.customerId ?? existing.customerId;
    const customer = await requireOrderableCustomer(context.organizationId, customerId, tx);

    // `!== undefined`, not `??`: a cleared field arrives as `null`, which must
    // become zero rather than fall back to the value it was meant to clear.
    const totals = computeOrderTotals({
      items: input.items ?? existing.items.map(toLineDraft),
      discount: input.discount !== undefined ? input.discount : minor(existing.discount),
      taxRate: input.taxRate !== undefined ? input.taxRate : formatTaxRateBp(existing.taxRate),
    });

    await writeOrder(tx, {
      context,
      order: existing,
      customerId: customer.id,
      totals,
      notes: existing.notes,
      assignedUserId: existing.assignedUserId,
    });

    const updated = await tx.order.findUniqueOrThrow({
      where: { id: existing.id },
      select: ORDER_SELECT,
    });

    const changes: string[] = [];
    if (input.customerId !== undefined && input.customerId !== existing.customerId) {
      changes.push(`customer set to ${customer.name}`);
    }
    if (input.items !== undefined) changes.push('line items changed');
    if (input.discount !== undefined || input.taxRate !== undefined) {
      changes.push('totals recalculated');
    }

    await recordActivity(tx, {
      context,
      orderId: existing.id,
      type: OrderActivityType.UPDATED,
      description: `Order details updated by ${context.name}${changes.length > 0 ? ` (${changes.join(', ')})` : ''}.`,
    });

    return updated;
  });

  log.info('Order updated', {
    organizationId: context.organizationId,
    orderId: row.id,
    userId: context.userId,
  });

  return toDto(row);
}

/** Stored line items -> the draft shape `computeOrderTotals` expects. */
function toLineDraft(item: {
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  discount: number;
}) {
  return {
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPrice: minor(item.unitPrice),
    discount: minor(item.discount),
  };
}

/**
 * Moves an order to another status.
 *
 * Cancellation is accepted here as well as on the dedicated endpoint so that
 * there is exactly one place that writes `status`, but it demands
 * `orders:cancel` rather than `orders:update` — routing through this endpoint
 * must not become a way to cancel without the permission.
 */
export async function changeOrderStatus(
  context: AuthorizationContext,
  orderId: string,
  status: OrderStatusValue,
): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_UPDATE);

  if (status === 'CANCELLED') {
    // Cancellation carries a reason and its own permission, so it has its own
    // operation. Accepting it here would be a second, quieter way to do the same
    // thing and would let a caller with only `orders:update` cancel an order.
    throw new ConflictError('Cancelling an order is a separate operation.');
  }

  const row = await db.$transaction(async (tx) => {
    const existing = await requireOrder(context, orderId, tx);
    const from = existing.status;

    const rejection = transitionRejection(from, status);
    if (rejection) throw new ConflictError(rejection);

    const updated = await tx.order.update({
      where: { id: existing.id },
      data: { status },
      select: ORDER_SELECT,
    });

    await recordActivity(tx, {
      context,
      orderId: existing.id,
      type: OrderActivityType.STATUS_CHANGED,
      description: `Order status changed from ${ORDER_STATUS_LABELS[from]} to ${ORDER_STATUS_LABELS[status]} by ${context.name}.`,
    });

    return updated;
  });

  log.info('Order status changed', {
    organizationId: context.organizationId,
    orderId: row.id,
    status,
    userId: context.userId,
  });

  return toDto(row);
}

/**
 * Cancels an order: sets `CANCELLED`, stamps `cancelledAt` and records why.
 *
 * The row is retained so the timeline survives — a cancelled order is still a
 * real order. `cancelledAt` and `status` move together because the database
 * constraint requires it, which is what stops the list filter and the timeline
 * from ever disagreeing.
 */
export async function cancelOrder(
  context: AuthorizationContext,
  orderId: string,
  reason: string | null,
): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_CANCEL);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireOrder(context, orderId, tx);
    const from = existing.status;

    if (!canCancel(from)) {
      throw new ConflictError(
        `An order that is ${ORDER_STATUS_LABELS[from].toLowerCase()} cannot be cancelled.`,
      );
    }

    const updated = await tx.order.update({
      where: { id: existing.id },
      data: { status: OrderStatus.CANCELLED, cancelledAt: new Date() },
      select: ORDER_SELECT,
    });

    await recordActivity(tx, {
      context,
      orderId: existing.id,
      type: OrderActivityType.CANCELLED,
      description: reason
        ? `Order cancelled by ${context.name}. Reason: ${reason}`
        : `Order cancelled by ${context.name}.`,
    });

    return updated;
  });

  log.info('Order cancelled', {
    organizationId: context.organizationId,
    orderId: row.id,
    userId: context.userId,
  });

  return toDto(row);
}

/** Assigns (or, with `null`, unassigns) an order to an active member. */
export async function assignOrder(
  context: AuthorizationContext,
  orderId: string,
  assignedUserId: string | null,
): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_ASSIGN);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireOrder(context, orderId, tx);

    if (isTerminalOrderStatus(existing.status)) {
      throw new ConflictError('A delivered or cancelled order cannot be reassigned.');
    }

    const assignee = assignedUserId
      ? await requireActiveMember(context.organizationId, assignedUserId, 'assignedUserId', tx)
      : null;

    const updated = await tx.order.update({
      where: { id: existing.id },
      data: { assignedUserId },
      select: ORDER_SELECT,
    });

    await recordActivity(tx, {
      context,
      orderId: existing.id,
      type: OrderActivityType.ASSIGNED,
      description: assignee
        ? `Order assigned to ${assignee.name} by ${context.name}.`
        : `Order unassigned by ${context.name}.`,
    });

    return updated;
  });

  log.info('Order assignment changed', {
    organizationId: context.organizationId,
    orderId: row.id,
    assignedUserId,
    userId: context.userId,
  });

  return toDto(row);
}

/**
 * Appends a note to the order and records a `NOTE_ADDED` activity, so the
 * timeline explains where the note text came from.
 *
 * Terminal orders are refused: notes are stored on the order row, and allowing
 * them after delivery or cancellation would mean the record can still change
 * after the workflow that produced it has closed.
 */
export async function addOrderNote(
  context: AuthorizationContext,
  orderId: string,
  body: string,
): Promise<OrderDto> {
  assertPermission(context, PERMISSIONS.ORDERS_UPDATE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireOrder(context, orderId, tx);

    if (isTerminalOrderStatus(existing.status)) {
      throw new ConflictError('A delivered or cancelled order cannot be modified.');
    }

    const appended = existing.notes ? `${existing.notes}\n\n${body}` : body;

    if (appended.length > MAX_NOTES_LENGTH) {
      throw new ValidationError([
        {
          path: 'body',
          message: `Notes are limited to ${MAX_NOTES_LENGTH} characters. Shorten an earlier note first.`,
        },
      ]);
    }

    const updated = await tx.order.update({
      where: { id: existing.id },
      data: { notes: appended },
      select: ORDER_SELECT,
    });

    await recordActivity(tx, {
      context,
      orderId: existing.id,
      type: OrderActivityType.NOTE_ADDED,
      description: `Note added by ${context.name}.`,
    });

    return updated;
  });

  return toDto(row);
}

/**
 * Returns the order's timeline. The order is loaded first so a caller cannot
 * read the activity log of an order outside their organization.
 */
export async function listOrderActivities(
  context: AuthorizationContext,
  orderId: string,
  query: OrderActivityQuery,
): Promise<{
  activities: OrderActivityDto[];
  pagination: ReturnType<typeof buildPagination>;
}> {
  assertPermission(context, PERMISSIONS.ORDERS_READ);

  await requireOrder(context, orderId);

  const where = { orderId, organizationId: context.organizationId };

  const [rows, total] = await db.$transaction([
    db.orderActivity.findMany({
      where,
      select: {
        id: true,
        type: true,
        description: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.orderActivity.count({ where }),
  ]);

  return {
    activities: rows.map((row) => ({
      id: row.id,
      type: row.type,
      description: row.description,
      createdAt: row.createdAt.toISOString(),
      user: row.user,
    })),
    pagination: buildPagination(query.page, query.limit, total),
  };
}

/** Active members who may be assigned an order. */
export async function listOrderAssignableMembers(
  context: AuthorizationContext,
): Promise<AssignableMember[]> {
  return listActiveMembers(context.organizationId);
}

/**
 * Real order counts and revenue for the dashboard.
 *
 * Scoped to the caller's organization like every other read, so two tenants
 * never see each other's numbers. Cancelled orders are excluded from revenue
 * because no money should be counted for work that was called off.
 */
export async function getOrderStats(context: AuthorizationContext): Promise<OrderStats> {
  assertPermission(context, PERMISSIONS.ORDERS_READ);

  const organizationId = context.organizationId;
  const since = new Date(Date.now() - NEW_ORDER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [total, open, pending, shipped, cancelled, revenue, newLast30Days] = await db.$transaction([
    db.order.count({ where: { organizationId } }),
    // Still being worked on: not cancelled and not yet delivered.
    db.order.count({
      where: {
        organizationId,
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.DELIVERED] },
      },
    }),
    db.order.count({ where: { organizationId, status: OrderStatus.PENDING } }),
    db.order.count({ where: { organizationId, status: OrderStatus.SHIPPED } }),
    db.order.count({ where: { organizationId, status: OrderStatus.CANCELLED } }),
    db.order.aggregate({
      where: { organizationId, status: { not: OrderStatus.CANCELLED } },
      _sum: { total: true },
    }),
    db.order.count({ where: { organizationId, createdAt: { gte: since } } }),
  ]);

  return {
    total,
    open,
    pending,
    shipped,
    cancelled,
    revenue: minor(revenue._sum.total ?? 0),
    newLast30Days,
  };
}
