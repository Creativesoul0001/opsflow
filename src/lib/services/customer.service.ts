import 'server-only';

import { CustomerActivityType, CustomerStatus, CustomerType } from '@/generated/prisma/enums';
import type { Prisma } from '@/generated/prisma/client';
import { db } from '@/lib/db';
import { ConflictError, isPrismaLikeError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';
import { buildCustomerOrderBy, buildCustomerWhere, buildPagination } from '@/lib/customers/query';
import type {
  CreateCustomerInput,
  CustomerActivityQuery,
  CustomerListQuery,
  UpdateCustomerInput,
} from '@/lib/customers/validation';
import { assertPermission, type AuthorizationContext } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';

const log = logger.child('customers');

/**
 * CRM customer service.
 *
 * Authorization is enforced here rather than in the route handlers, so the check
 * cannot be bypassed by adding a new caller: every page and every endpoint that
 * touches customer data goes through one of these functions.
 *
 * Tenant scoping is equally deliberate. Two rules hold throughout:
 *
 *  1. Every read filters on `organizationId: context.organizationId`, which comes
 *     from a verified membership — never from the request.
 *  2. Single-record lookups use `findFirst({ where: { id, organizationId } })`
 *     rather than `findUnique({ where: { id } })`, so the tenant predicate is part
 *     of the same query. A caller who knows another tenant's customer id gets the
 *     same 404 as for a non-existent id, which confirms nothing.
 */

const CUSTOMER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  companyName: true,
  status: true,
  customerType: true,
  assignedUserId: true,
  notes: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedUser: { select: { id: true, name: true, email: true } },
} as const;

type CustomerRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  status: string;
  customerType: string;
  assignedUserId: string | null;
  notes: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedUser: { id: string; name: string; email: string } | null;
};

export interface CustomerDto {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string | null;
  companyName: string | null;
  status: string;
  customerType: string;
  assignedUserId: string | null;
  assignedUser: { id: string; name: string; email: string } | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerActivityDto {
  id: string;
  type: string;
  description: string;
  createdAt: string;
  user: { id: string; name: string } | null;
}

export interface AssignableMember {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string;
  roleKey: string;
}

export interface CustomerStats {
  total: number;
  active: number;
  leads: number;
  archived: number;
  newLast30Days: number;
}

const NEW_CUSTOMER_WINDOW_DAYS = 30;
const MAX_NOTES_LENGTH = 5_000;

function toDto(row: CustomerRow): CustomerDto {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    status: row.status,
    customerType: row.customerType,
    assignedUserId: row.assignedUserId,
    assignedUser: row.assignedUser,
    notes: row.notes,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Loads one customer inside the caller's organization.
 *
 * Returns 404 — not 403 — for a customer in another organization, so the
 * response cannot be used to probe which ids exist elsewhere.
 */
async function requireCustomer(
  context: AuthorizationContext,
  customerId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<CustomerRow> {
  const customer = await client.customer.findFirst({
    where: { id: customerId, organizationId: context.organizationId },
    select: CUSTOMER_SELECT,
  });

  if (!customer) throw new NotFoundError('Customer not found.');
  return customer;
}

/**
 * Confirms a user is an ACTIVE member of the caller's organization before they
 * are assigned a customer.
 *
 * `users` is a global table, so the foreign key on `assignedUserId` alone would
 * happily accept a user from a different organization. This check is what stops
 * a customer from being assigned to (and therefore exposing work to) a stranger.
 */
async function requireAssignableMember(
  organizationId: string,
  userId: string,
  client: Prisma.TransactionClient | typeof db = db,
): Promise<{ id: string; name: string }> {
  const membership = await client.organizationMembership.findFirst({
    where: { organizationId, userId, status: 'ACTIVE' },
    select: { user: { select: { id: true, name: true } } },
  });

  if (!membership) {
    throw new ValidationError([
      {
        path: 'assignedUserId',
        message: 'That person is not an active member of this organization.',
      },
    ]);
  }

  return membership.user;
}

/**
 * Email is unique per organization, so two people can legitimately share one
 * address across tenants but not within one.
 *
 * The database is the authority (a pre-flight check would still race), so the
 * unique-constraint violation is translated into a field-level validation error.
 * That keeps the raw constraint name — which says nothing useful to the member
 * who just typed an address — out of the response, and lets the form highlight
 * the offending field instead of showing a generic banner.
 */
async function withDuplicateEmailGuard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isPrismaLikeError(error) && error.code === 'P2002') {
      throw new ValidationError([
        {
          path: 'email',
          message: 'That email address is already used by another customer in this organization.',
        },
      ]);
    }

    throw error;
  }
}

function recordActivity(
  tx: Prisma.TransactionClient,
  entry: {
    context: AuthorizationContext;
    customerId: string;
    type: CustomerActivityType;
    description: string;
  },
) {
  return tx.customerActivity.create({
    data: {
      organizationId: entry.context.organizationId,
      customerId: entry.customerId,
      // Nullable in the schema so history survives removal of the actor.
      userId: entry.context.userId,
      type: entry.type,
      description: entry.description,
    },
    select: { id: true },
  });
}

/** Lists customers for the caller's organization with search, filters and paging. */
export async function listCustomers(
  context: AuthorizationContext,
  query: CustomerListQuery,
): Promise<{ customers: CustomerDto[]; pagination: ReturnType<typeof buildPagination> }> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_READ);

  const where = buildCustomerWhere(context, query);

  // A transaction keeps `total` and the page contents consistent when another
  // request writes between the two statements.
  const [rows, total] = await db.$transaction([
    db.customer.findMany({
      where,
      select: CUSTOMER_SELECT,
      orderBy: buildCustomerOrderBy(query.sort, query.order),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    db.customer.count({ where }),
  ]);

  return {
    customers: rows.map(toDto),
    pagination: buildPagination(query.page, query.limit, total),
  };
}

export async function getCustomer(
  context: AuthorizationContext,
  customerId: string,
): Promise<CustomerDto> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_READ);
  return toDto(await requireCustomer(context, customerId));
}

export async function createCustomer(
  context: AuthorizationContext,
  input: CreateCustomerInput,
): Promise<CustomerDto> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_CREATE);

  const assignee = input.assignedUserId
    ? await requireAssignableMember(context.organizationId, input.assignedUserId)
    : null;

  const row = await withDuplicateEmailGuard(() =>
    db.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          organizationId: context.organizationId,
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone ?? null,
          companyName: input.companyName ?? null,
          status: input.status ?? CustomerStatus.ACTIVE,
          customerType: input.customerType ?? CustomerType.INDIVIDUAL,
          assignedUserId: input.assignedUserId ?? null,
          notes: input.notes ?? null,
        },
        select: CUSTOMER_SELECT,
      });

      await recordActivity(tx, {
        context,
        customerId: created.id,
        type: CustomerActivityType.CREATED,
        description: assignee
          ? `Customer created by ${context.name} and assigned to ${assignee.name}.`
          : `Customer created by ${context.name}.`,
      });

      return created;
    }),
  );

  log.info('Customer created', {
    organizationId: context.organizationId,
    customerId: row.id,
    userId: context.userId,
  });

  return toDto(row);
}

export async function updateCustomer(
  context: AuthorizationContext,
  customerId: string,
  input: UpdateCustomerInput,
): Promise<CustomerDto> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_UPDATE);

  const row = await withDuplicateEmailGuard(() =>
    db.$transaction(async (tx) => {
      const existing = await requireCustomer(context, customerId, tx);

      // Archived records are read-only. Restoring them is a separate operation
      // with its own permission, so that flipping `status` back cannot silently
      // resurrect a record whose `archivedAt` still hides it from every list.
      if (existing.archivedAt) {
        throw new ConflictError('Archived customers cannot be edited.');
      }

      const updated = await tx.customer.update({
        where: { id: existing.id },
        data: {
          // `undefined` leaves a column untouched, which is what a partial PATCH
          // needs; `null` is an explicit clear for the optional fields.
          ...(input.firstName !== undefined && { firstName: input.firstName }),
          ...(input.lastName !== undefined && { lastName: input.lastName }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.companyName !== undefined && { companyName: input.companyName }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.customerType !== undefined && { customerType: input.customerType }),
          ...(input.notes !== undefined && { notes: input.notes }),
        },
        select: CUSTOMER_SELECT,
      });

      await recordActivity(tx, {
        context,
        customerId: updated.id,
        type: CustomerActivityType.UPDATED,
        description: `Customer details updated by ${context.name}.`,
      });

      return updated;
    }),
  );

  log.info('Customer updated', {
    organizationId: context.organizationId,
    customerId: row.id,
    userId: context.userId,
  });

  return toDto(row);
}

/**
 * Archives a customer: sets `archivedAt`, moves status to `ARCHIVED` and records
 * the action. The row is retained so history and the activity trail survive;
 * there is no hard-delete endpoint in this module.
 */
export async function archiveCustomer(
  context: AuthorizationContext,
  customerId: string,
): Promise<CustomerDto> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_ARCHIVE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireCustomer(context, customerId, tx);

    if (existing.archivedAt) {
      throw new ConflictError('That customer is already archived.');
    }

    const archived = await tx.customer.update({
      where: { id: existing.id },
      data: { status: CustomerStatus.ARCHIVED, archivedAt: new Date() },
      select: CUSTOMER_SELECT,
    });

    await recordActivity(tx, {
      context,
      customerId: archived.id,
      type: CustomerActivityType.ARCHIVED,
      description: `Customer archived by ${context.name}.`,
    });

    return archived;
  });

  log.info('Customer archived', {
    organizationId: context.organizationId,
    customerId: row.id,
    userId: context.userId,
  });

  return toDto(row);
}

/** Assigns (or, with `null`, unassigns) a customer to an active member. */
export async function assignCustomer(
  context: AuthorizationContext,
  customerId: string,
  assignedUserId: string | null,
): Promise<CustomerDto> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_ASSIGN);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireCustomer(context, customerId, tx);

    if (existing.archivedAt) {
      throw new ConflictError('Archived customers cannot be reassigned.');
    }

    const assignee = assignedUserId
      ? await requireAssignableMember(context.organizationId, assignedUserId, tx)
      : null;

    const updated = await tx.customer.update({
      where: { id: existing.id },
      data: { assignedUserId },
      select: CUSTOMER_SELECT,
    });

    await recordActivity(tx, {
      context,
      customerId: updated.id,
      type: CustomerActivityType.ASSIGNED,
      description: assignee
        ? `Customer assigned to ${assignee.name} by ${context.name}.`
        : `Customer unassigned by ${context.name}.`,
    });

    return updated;
  });

  log.info('Customer assignment changed', {
    organizationId: context.organizationId,
    customerId: row.id,
    assignedUserId,
    userId: context.userId,
  });

  return toDto(row);
}

/**
 * Appends a note to the customer and records a `NOTE_ADDED` activity, so the
 * timeline explains where the note text came from.
 */
export async function addCustomerNote(
  context: AuthorizationContext,
  customerId: string,
  body: string,
): Promise<CustomerDto> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_UPDATE);

  const row = await db.$transaction(async (tx) => {
    const existing = await requireCustomer(context, customerId, tx);

    if (existing.archivedAt) {
      throw new ConflictError('Archived customers cannot be edited.');
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

    const updated = await tx.customer.update({
      where: { id: existing.id },
      data: { notes: appended },
      select: CUSTOMER_SELECT,
    });

    await recordActivity(tx, {
      context,
      customerId: updated.id,
      type: CustomerActivityType.NOTE_ADDED,
      description: `Note added by ${context.name}.`,
    });

    return updated;
  });

  return toDto(row);
}

/**
 * Returns the customer's timeline. The customer is loaded first so a caller
 * cannot read the activity log of a customer outside their organization.
 */
export async function listCustomerActivities(
  context: AuthorizationContext,
  customerId: string,
  query: CustomerActivityQuery,
): Promise<{
  activities: CustomerActivityDto[];
  pagination: ReturnType<typeof buildPagination>;
}> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_READ);

  await requireCustomer(context, customerId);

  const where = { customerId, organizationId: context.organizationId };

  const [rows, total] = await db.$transaction([
    db.customerActivity.findMany({
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
    db.customerActivity.count({ where }),
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

/** Active members who may be assigned a customer. */
export async function listAssignableMembers(
  context: AuthorizationContext,
): Promise<AssignableMember[]> {
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId: context.organizationId, status: 'ACTIVE' },
    select: {
      id: true,
      user: { select: { id: true, name: true, email: true } },
      role: { select: { key: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
    roleName: membership.role.name,
    roleKey: membership.role.key,
  }));
}

/**
 * Real customer counts for the dashboard.
 *
 * Scoped to the caller's organization like every other read, so two tenants never
 * see each other's numbers.
 */
export async function getCustomerStats(context: AuthorizationContext): Promise<CustomerStats> {
  assertPermission(context, PERMISSIONS.CUSTOMERS_READ);

  const organizationId = context.organizationId;
  const visible = { organizationId, archivedAt: null };
  const since = new Date(Date.now() - NEW_CUSTOMER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [total, active, leads, archived, newLast30Days] = await db.$transaction([
    db.customer.count({ where: { organizationId } }),
    db.customer.count({ where: { ...visible, status: CustomerStatus.ACTIVE } }),
    db.customer.count({ where: { ...visible, status: CustomerStatus.LEAD } }),
    db.customer.count({ where: { organizationId, status: CustomerStatus.ARCHIVED } }),
    db.customer.count({ where: { ...visible, createdAt: { gte: since } } }),
  ]);

  return { total, active, leads, archived, newLast30Days };
}
