import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@/lib/api/errors';
import { db } from '@/lib/db';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import type { AuthorizationContext } from '@/lib/rbac/guard';
import { archiveCustomer, createCustomer } from '@/lib/services/customer.service';
import {
  addOrderNote,
  assignOrder,
  cancelOrder,
  changeOrderStatus,
  createOrder,
  getOrder,
  getOrderStats,
  listOrderActivities,
  listOrderAssignableMembers,
  listOrders,
  updateOrder,
} from '@/lib/services/order.service';
import {
  coerceOrderListQuery,
  createOrderSchema,
  orderActivityQuerySchema,
  updateOrderSchema,
} from '@/lib/orders/validation';

/**
 * Order service behaviour against a real PostgreSQL database.
 *
 * The claims these tests prove cannot be proven with mocks: that a per-org
 * sequence really does hand out `ORD-000001` to two different tenants, that
 * money stored as `int4` reads back as the same decimal string it was submitted
 * as, and above all that one organization cannot read or write another's
 * orders. A mock would assert the query I wrote, not the rows Postgres returns.
 *
 * They run against a throwaway database per run and are skipped when
 * `DATABASE_URL` is absent, so `npm run verify` stays hermetic.
 */

const ENABLED = Boolean(process.env.DATABASE_URL);

/** `ValidationError` keeps its per-field messages under `details.issues`. */
function fieldIssues(error: unknown): { path: string; message: string }[] {
  return (
    (error as { details?: { issues?: { path: string; message: string }[] } }).details?.issues ?? []
  );
}

/** Runs `operation`, expecting it to fail, and returns the error. */
async function failure(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail, but it succeeded.');
}

describe.skipIf(!ENABLED)('order service (database)', () => {
  // Fixed ids are reused across runs, so a previous interrupted run must not
  // leave rows behind. Organization cascades clean up the order domain.
  const ORG_A = '91000000-0000-4000-8000-000000000001';
  const ORG_B = '91000000-0000-4000-8000-000000000002';
  const ORG_C = '91000000-0000-4000-8000-000000000003';
  const ORGS = [ORG_A, ORG_B, ORG_C];

  let ownerA: AuthorizationContext;
  let ownerB: AuthorizationContext;
  let ownerC: AuthorizationContext;
  /** Holds read + create + update — the shape an EMPLOYEE actually has. */
  let clerkA: AuthorizationContext;
  /** Holds orders:read but nothing else. */
  let readerA: AuthorizationContext;

  let customerA: string;
  let customerB: string;
  let customerC: string;
  let archivedCustomerA: string;

  const userIds: string[] = [];

  /** A context that holds every permission. */
  function asOwner(organizationId: string, name: string) {
    return {
      userId: randomUUID(),
      email: `${name.toLowerCase().replace(/[^a-z]/g, '')}-orders@orders.test`,
      name,
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'OWNER',
      roleName: 'Owner',
      permissions: new Set<string>(Object.values(PERMISSIONS)),
    } as AuthorizationContext;
  }

  /** A context with an explicit permission set, to test enforcement. */
  function asMember(organizationId: string, name: string, permissions: string[]) {
    return {
      userId: randomUUID(),
      email: `${name.toLowerCase()}@orders.test`,
      name,
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'EMPLOYEE',
      roleName: 'Employee',
      permissions: new Set<string>(permissions),
    } as AuthorizationContext;
  }

  /** Adds a user with an ACTIVE membership in an existing organization. */
  async function addMember(
    organizationId: string,
    userId: string,
    email: string,
    name: string,
    roleKey: string,
  ) {
    await db.user.create({
      data: { id: userId, email, name, passwordHash: 'not-used-in-these-tests' },
    });

    const role = await db.role.findFirstOrThrow({ where: { key: roleKey } });
    await db.organizationMembership.create({
      data: { organizationId, userId, roleId: role.id },
    });

    return userId;
  }

  /** Creates an organization with a single member holding `roleKey`. */
  async function seedOrganization(
    id: string,
    name: string,
    userId: string,
    email: string,
    roleKey: string,
  ) {
    await db.organization.create({
      data: {
        id,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(-8)}`,
      },
    });

    await addMember(id, userId, email, name, roleKey);
  }

  /** Parses a create payload exactly as a route handler would. */
  function orderInput(customerId: string, overrides: Record<string, unknown> = {}) {
    return createOrderSchema.parse({
      customerId,
      items: [{ productName: 'Consulting', quantity: 2, unitPrice: '125.50' }],
      ...overrides,
    });
  }

  const createFor = (
    context: AuthorizationContext,
    customerId: string,
    overrides: Record<string, unknown> = {},
  ) => createOrder(context, orderInput(customerId, overrides));

  const listFor = (context: AuthorizationContext, overrides: Record<string, unknown> = {}) =>
    listOrders(context, coerceOrderListQuery({ limit: 100, ...overrides }));

  const activitiesFor = (context: AuthorizationContext, orderId: string) =>
    listOrderActivities(context, orderId, orderActivityQuerySchema.parse({}));

  beforeAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: ORGS } } });
    await db.user.deleteMany({ where: { email: { endsWith: '@orders.test' } } });

    ownerA = asOwner(ORG_A, 'Ada');
    ownerB = asOwner(ORG_B, 'Grace');
    ownerC = asOwner(ORG_C, 'Hopper');
    clerkA = asMember(ORG_A, 'Clerk', [
      PERMISSIONS.ORDERS_READ,
      PERMISSIONS.ORDERS_CREATE,
      PERMISSIONS.ORDERS_UPDATE,
      PERMISSIONS.CUSTOMERS_READ,
    ]);
    readerA = asMember(ORG_A, 'Reader', [PERMISSIONS.ORDERS_READ]);

    await seedOrganization(ORG_A, 'Orders Harness A', ownerA.userId, ownerA.email, 'OWNER');
    await seedOrganization(ORG_B, 'Orders Harness B', ownerB.userId, ownerB.email, 'OWNER');
    await seedOrganization(ORG_C, 'Orders Harness C', ownerC.userId, ownerC.email, 'OWNER');
    await addMember(ORG_A, clerkA.userId, clerkA.email, 'Clerk', 'EMPLOYEE');
    await addMember(ORG_A, readerA.userId, readerA.email, 'Reader', 'EMPLOYEE');

    // Activity descriptions use the name on the context while the timeline shows
    // the name on the user row, so the two are pointed at the same text here.
    for (const context of [ownerA, ownerB, ownerC, clerkA, readerA]) {
      await db.user.update({ where: { id: context.userId }, data: { name: context.name } });
    }

    userIds.push(ownerA.userId, ownerB.userId, ownerC.userId, clerkA.userId, readerA.userId);

    customerA = (
      await createCustomer(ownerA, {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: `customer-a-${randomUUID()}@orders.test`,
      })
    ).id;
    customerB = (
      await createCustomer(ownerB, {
        firstName: 'Grace',
        lastName: 'Hopper',
        email: `customer-b-${randomUUID()}@orders.test`,
      })
    ).id;
    customerC = (
      await createCustomer(ownerC, {
        firstName: 'Alan',
        lastName: 'Turing',
        email: `customer-c-${randomUUID()}@orders.test`,
      })
    ).id;
    archivedCustomerA = (
      await createCustomer(ownerA, {
        firstName: 'Archived',
        lastName: 'Customer',
        email: `customer-archived-${randomUUID()}@orders.test`,
      })
    ).id;

    await archiveCustomer(ownerA, archivedCustomerA);
  });

  afterAll(async () => {
    // Cascades remove orders, customers, memberships and activity for these orgs.
    await db.organization.deleteMany({ where: { id: { in: ORGS } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.$disconnect();
  });

  describe('create and read', () => {
    it('creates an order with server-derived totals and a pending status', async () => {
      const order = await createFor(ownerA, customerA);

      expect(order.status).toBe('PENDING');
      expect(order.cancelledAt).toBeNull();
      expect(order.subtotal).toBe('251.00');
      expect(order.discount).toBe('0.00');
      expect(order.tax).toBe('0.00');
      expect(order.taxRate).toBe('0');
      expect(order.total).toBe('251.00');
      expect(order.customer).toMatchObject({ id: customerA, fullName: 'Ada Lovelace' });
      expect(order.items).toHaveLength(1);
      expect(order.items[0]).toMatchObject({
        productName: 'Consulting',
        quantity: 2,
        unitPrice: '125.50',
        discount: '0.00',
        total: '251.00',
      });
      expect(order.assignedUserId).toBeNull();
    });

    it('numbers orders sequentially within the organization', async () => {
      expect((await createFor(ownerA, customerA)).orderNumber).toBe('ORD-000002');
      expect((await createFor(ownerA, customerA)).orderNumber).toBe('ORD-000003');
    });

    it("starts a second organization at the first number, not the first one's next", async () => {
      expect((await createFor(ownerB, customerB)).orderNumber).toBe('ORD-000001');
    });

    it('derives discount, tax and total from the line items', async () => {
      const order = await createFor(ownerA, customerA, { discount: '10.00', taxRate: '10' });

      expect(order.subtotal).toBe('251.00');
      expect(order.discount).toBe('10.00');
      expect(order.tax).toBe('24.10'); // (251.00 - 10.00) * 10%
      expect(order.taxRate).toBe('10');
      expect(order.total).toBe('265.10');
    });

    it('round-trips every money value it was asked to store', async () => {
      const order = await createFor(ownerA, customerA, {
        items: [
          { productName: 'A', quantity: 3, unitPrice: '0.33' },
          { productName: 'B', quantity: 1, unitPrice: '1000.05', discount: '0.05' },
        ],
        taxRate: '5',
      });

      expect(order.subtotal).toBe('1000.99'); // 0.99 + 1000.00
      expect(order.tax).toBe('50.05'); // 1000.99 * 5% = 50.0495 -> 50.05
      expect(order.total).toBe('1051.04');

      const fetched = await getOrder(ownerA, order.id);
      expect(fetched.subtotal).toBe(order.subtotal);
      expect(fetched.tax).toBe(order.tax);
      expect(fetched.total).toBe(order.total);
      expect(fetched.items.map((item) => item.total)).toEqual(['0.99', '1000.00']);
    });

    it('rejects an order for a customer in another organization', async () => {
      const error = await failure(() => createFor(ownerA, customerB));

      expect(error).toBeInstanceOf(ValidationError);
      const issue = fieldIssues(error)[0];
      expect(issue?.path).toBe('customerId');
      expect(issue?.message).toMatch(/does not exist/i);
    });

    it('rejects an order for an archived customer', async () => {
      const error = await failure(() => createFor(ownerA, archivedCustomerA));

      expect(error).toBeInstanceOf(ValidationError);
      expect(fieldIssues(error)[0]?.message).toMatch(/archived/i);
    });

    it('reports a bad amount before anything is written', async () => {
      const before = (await listFor(ownerA)).pagination.total;

      const error = await failure(() => createFor(ownerA, customerA, { discount: '99999.00' }));

      expect(error).toBeInstanceOf(ValidationError);
      expect((await listFor(ownerA)).pagination.total).toBe(before);
    });

    it("gives a missing order and another tenant's order the identical 404", async () => {
      const foreign = await createFor(ownerB, customerB);

      const missing = await failure(() => getOrder(ownerA, randomUUID()));
      const crossed = await failure(() => getOrder(ownerA, foreign.id));

      expect(missing).toBeInstanceOf(NotFoundError);
      expect(crossed).toBeInstanceOf(NotFoundError);
      expect((crossed as Error).message).toBe((missing as Error).message);
    });
  });

  describe('permissions', () => {
    it('refuses to create an order without orders:create', async () => {
      const reader = asMember(ORG_A, 'NoCreate', [PERMISSIONS.ORDERS_READ]);

      const error = await failure(() => createFor(reader, customerA));

      expect(error).toBeInstanceOf(AuthorizationError);
    });

    it('refuses to list orders without orders:read', async () => {
      const noRead = asMember(ORG_A, 'NoRead', [PERMISSIONS.ORDERS_CREATE]);

      const error = await failure(() => listFor(noRead));

      expect(error).toBeInstanceOf(AuthorizationError);
    });

    it('lets an employee create, read and edit, but not cancel or assign', async () => {
      const order = await createFor(clerkA, customerA);
      expect(order.orderNumber).toMatch(/^ORD-\d{6,}$/);

      const { orders } = await listFor(clerkA);
      expect(orders.some((entry) => entry.id === order.id)).toBe(true);

      const edited = await updateOrder(
        clerkA,
        order.id,
        updateOrderSchema.parse({ discount: '1.00' }),
      );
      expect(edited.discount).toBe('1.00');

      expect(await failure(() => cancelOrder(clerkA, order.id, 'nope'))).toBeInstanceOf(
        AuthorizationError,
      );
      expect(await failure(() => assignOrder(clerkA, order.id, clerkA.userId))).toBeInstanceOf(
        AuthorizationError,
      );
    });

    it('does not let orders:read alone reach another tenant', async () => {
      const foreign = await createFor(ownerB, customerB);

      expect(await failure(() => getOrder(readerA, foreign.id))).toBeInstanceOf(NotFoundError);
      expect((await listFor(readerA)).orders.length).toBeGreaterThan(0);
    });
  });

  describe('status workflow', () => {
    it('walks the happy path one step at a time', async () => {
      const order = await createFor(ownerA, customerA);

      const confirmed = await changeOrderStatus(ownerA, order.id, 'CONFIRMED');
      const processing = await changeOrderStatus(ownerA, order.id, 'PROCESSING');
      const shipped = await changeOrderStatus(ownerA, order.id, 'SHIPPED');
      const delivered = await changeOrderStatus(ownerA, order.id, 'DELIVERED');

      expect([confirmed.status, processing.status, shipped.status, delivered.status]).toEqual([
        'CONFIRMED',
        'PROCESSING',
        'SHIPPED',
        'DELIVERED',
      ]);
      expect(delivered.cancelledAt).toBeNull();
    });

    it('refuses to skip a stage, and says which moves remain', async () => {
      const order = await createFor(ownerA, customerA);

      const error = await failure(() => changeOrderStatus(ownerA, order.id, 'SHIPPED'));

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toBe(
        'An order that is pending can only become confirmed or cancelled.',
      );
      expect((await getOrder(ownerA, order.id)).status).toBe('PENDING');
    });

    it('refuses to run backwards', async () => {
      const order = await createFor(ownerA, customerA);
      await changeOrderStatus(ownerA, order.id, 'CONFIRMED');

      const error = await failure(() => changeOrderStatus(ownerA, order.id, 'PENDING'));

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toMatch(/can only become processing or cancelled/i);
    });

    it('refuses to cancel through the status endpoint', async () => {
      const order = await createFor(ownerA, customerA);

      // The owner holds orders:cancel, so this is a policy refusal, not RBAC.
      const error = await failure(() => changeOrderStatus(ownerA, order.id, 'CANCELLED'));

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toBe('Cancelling an order is a separate operation.');
      expect((await getOrder(ownerA, order.id)).status).toBe('PENDING');
    });

    it('cancels with a reason and records why on the timeline', async () => {
      const order = await createFor(ownerA, customerA);

      const cancelled = await cancelOrder(ownerA, order.id, 'Customer changed their mind');

      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancelledAt).not.toBeNull();

      const { activities } = await activitiesFor(ownerA, order.id);
      const cancellation = activities.find((activity) => activity.type === 'CANCELLED');
      expect(cancellation?.description).toContain('Reason: Customer changed their mind');
      expect(cancellation?.user?.name).toBe('Ada');
    });

    it('refuses to cancel a delivered or already cancelled order', async () => {
      const delivered = await createFor(ownerA, customerA);
      await changeOrderStatus(ownerA, delivered.id, 'CONFIRMED');
      await changeOrderStatus(ownerA, delivered.id, 'PROCESSING');
      await changeOrderStatus(ownerA, delivered.id, 'SHIPPED');
      await changeOrderStatus(ownerA, delivered.id, 'DELIVERED');

      const cancelled = await createFor(ownerA, customerA);
      await cancelOrder(ownerA, cancelled.id, null);

      for (const id of [delivered.id, cancelled.id]) {
        const error = await failure(() => cancelOrder(ownerA, id, 'again'));
        expect(error).toBeInstanceOf(ConflictError);
        expect((error as Error).message).toMatch(/cannot be cancelled/);
      }
    });

    it('refuses any status change once delivered', async () => {
      const order = await createFor(ownerA, customerA);
      await changeOrderStatus(ownerA, order.id, 'CONFIRMED');
      await changeOrderStatus(ownerA, order.id, 'PROCESSING');
      await changeOrderStatus(ownerA, order.id, 'SHIPPED');
      await changeOrderStatus(ownerA, order.id, 'DELIVERED');

      const error = await failure(() => changeOrderStatus(ownerA, order.id, 'PENDING'));

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toBe('An order that is delivered cannot be changed.');
    });
  });

  describe('editing', () => {
    it('recalculates every total when the items change', async () => {
      const order = await createFor(ownerA, customerA);

      const updated = await updateOrder(
        ownerA,
        order.id,
        updateOrderSchema.parse({
          items: [{ productName: 'Redesigned', quantity: 1, unitPrice: '10.00' }],
        }),
      );

      expect(updated.subtotal).toBe('10.00');
      expect(updated.discount).toBe('0.00');
      expect(updated.total).toBe('10.00');
      expect(updated.items[0]?.productName).toBe('Redesigned');
      expect(updated.orderNumber).toBe(order.orderNumber);
    });

    it('clears a tax rate that is set to null rather than keeping the old one', async () => {
      const order = await createFor(ownerA, customerA, { taxRate: '15' });
      expect(order.taxRate).toBe('15');
      expect(order.tax).toBe('37.65');

      const cleared = await updateOrder(
        ownerA,
        order.id,
        updateOrderSchema.parse({ taxRate: null }),
      );

      expect(cleared.taxRate).toBe('0');
      expect(cleared.tax).toBe('0.00');
      expect(cleared.total).toBe('251.00');
    });

    it('keeps the order number and the rest of the order intact', async () => {
      const order = await createFor(ownerA, customerA, { notes: 'Leave at reception' });

      const updated = await updateOrder(
        ownerA,
        order.id,
        updateOrderSchema.parse({ discount: '5.00' }),
      );

      expect(updated.orderNumber).toBe(order.orderNumber);
      expect(updated.notes).toBe('Leave at reception');
      expect(updated.subtotal).toBe('251.00');
      expect(updated.discount).toBe('5.00');
      expect(updated.total).toBe('246.00');
    });

    it('refuses to edit an order once fulfilment has started', async () => {
      const order = await createFor(ownerA, customerA);
      await changeOrderStatus(ownerA, order.id, 'CONFIRMED');
      await changeOrderStatus(ownerA, order.id, 'PROCESSING');

      const error = await failure(() =>
        updateOrder(ownerA, order.id, updateOrderSchema.parse({ discount: '1.00' })),
      );

      expect(error).toBeInstanceOf(ConflictError);
      expect((error as Error).message).toMatch(/cannot be edited/i);
    });
  });

  describe('assignment', () => {
    it('assigns an order to an active member of the same organization', async () => {
      const order = await createFor(ownerA, customerA);

      const assigned = await assignOrder(ownerA, order.id, clerkA.userId);

      expect(assigned.assignedUserId).toBe(clerkA.userId);
      expect(assigned.assignedUser).toMatchObject({ id: clerkA.userId, name: 'Clerk' });

      const { activities } = await activitiesFor(ownerA, order.id);
      const assignmentEvent = activities.find((activity) => activity.type === 'ASSIGNED');
      expect(assignmentEvent?.description).toContain('Order assigned to Clerk');
      expect(assignmentEvent?.user?.name).toBe('Ada');
    });

    it('refuses to assign work to someone outside the organization', async () => {
      const order = await createFor(ownerA, customerA);

      for (const outsider of [ownerB.userId, randomUUID()]) {
        const error = await failure(() => assignOrder(ownerA, order.id, outsider));
        expect(error).toBeInstanceOf(ValidationError);
        expect(fieldIssues(error)[0]?.message).toMatch(/not an active member/i);
      }

      expect((await getOrder(ownerA, order.id)).assignedUserId).toBeNull();
    });

    it('unassigns with an explicit null', async () => {
      const order = await createFor(ownerA, customerA);
      await assignOrder(ownerA, order.id, clerkA.userId);

      const cleared = await assignOrder(ownerA, order.id, null);

      expect(cleared.assignedUserId).toBeNull();
      expect(cleared.assignedUser).toBeNull();
    });

    it("lists only the caller organization's active members", async () => {
      const members = await listOrderAssignableMembers(ownerA);
      const ids = members.map((member) => member.userId);

      expect(ids).toContain(clerkA.userId);
      expect(ids).toContain(ownerA.userId);
      expect(ids).not.toContain(ownerB.userId);
      expect(members.every((member) => Boolean(member.roleName))).toBe(true);
    });
  });

  describe('terminal orders are immutable', () => {
    it('refuses every kind of change once cancelled', async () => {
      const order = await createFor(ownerA, customerA);
      await cancelOrder(ownerA, order.id, 'No longer needed');

      expect(
        await failure(() =>
          updateOrder(ownerA, order.id, updateOrderSchema.parse({ discount: '0' })),
        ),
      ).toBeInstanceOf(ConflictError);

      expect(await failure(() => addOrderNote(ownerA, order.id, 'A late note'))).toBeInstanceOf(
        ConflictError,
      );

      expect(await failure(() => assignOrder(ownerA, order.id, clerkA.userId))).toBeInstanceOf(
        ConflictError,
      );

      const unchanged = await getOrder(ownerA, order.id);
      expect(unchanged.status).toBe('CANCELLED');
      expect(unchanged.notes).toBeNull();
      expect(unchanged.assignedUserId).toBeNull();
    });

    it('refuses edits after delivery too', async () => {
      const order = await createFor(ownerA, customerA);
      await changeOrderStatus(ownerA, order.id, 'CONFIRMED');
      await changeOrderStatus(ownerA, order.id, 'PROCESSING');
      await changeOrderStatus(ownerA, order.id, 'SHIPPED');
      await changeOrderStatus(ownerA, order.id, 'DELIVERED');

      expect(await failure(() => addOrderNote(ownerA, order.id, 'Looks good'))).toBeInstanceOf(
        ConflictError,
      );
      expect(await failure(() => assignOrder(ownerA, order.id, clerkA.userId))).toBeInstanceOf(
        ConflictError,
      );
    });
  });

  describe('notes and timeline', () => {
    it('appends notes instead of replacing them, and records each addition', async () => {
      const order = await createFor(ownerA, customerA, { notes: 'First note' });

      await addOrderNote(ownerA, order.id, 'Second note');
      const updated = await addOrderNote(ownerA, order.id, 'Third note');

      expect(updated.notes).toBe('First note\n\nSecond note\n\nThird note');

      const { activities } = await activitiesFor(ownerA, order.id);
      const types = activities.map((activity) => activity.type);
      expect(types).toContain('CREATED');
      expect(types).toContain('NOTE_ADDED');
      expect(types.filter((type) => type === 'NOTE_ADDED')).toHaveLength(2);
    });

    it('attributes the timeline to the member who acted', async () => {
      const order = await createFor(clerkA, customerA);
      await changeOrderStatus(clerkA, order.id, 'CONFIRMED');

      const { activities } = await activitiesFor(clerkA, order.id);

      const statusChange = activities.find((activity) => activity.type === 'STATUS_CHANGED');
      expect(statusChange?.description).toContain('by Clerk');
      expect(statusChange?.user).toEqual({ id: clerkA.userId, name: 'Clerk' });
      expect(activities.find((activity) => activity.type === 'CREATED')?.user).toEqual({
        id: clerkA.userId,
        name: 'Clerk',
      });
      // Newest first, so the page reads as a story.
      const timestamps = activities.map((activity) => Date.parse(activity.createdAt));
      expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    });

    it('refuses a note that would push the stored text past its limit', async () => {
      const order = await createFor(ownerA, customerA, { notes: 'x'.repeat(4_900) });

      const error = await failure(() => addOrderNote(ownerA, order.id, 'y'.repeat(200)));

      expect(error).toBeInstanceOf(ValidationError);
      const issue = fieldIssues(error)[0];
      expect(issue?.path).toBe('body');
      expect(issue?.message).toMatch(/limited to 5000/i);
    });

    it('pages the timeline', async () => {
      const order = await createFor(ownerA, customerA);
      await addOrderNote(ownerA, order.id, 'one');
      await addOrderNote(ownerA, order.id, 'two');

      const page = await listOrderActivities(
        ownerA,
        order.id,
        orderActivityQuerySchema.parse({ page: 1, limit: 2 }),
      );

      expect(page.activities).toHaveLength(2);
      expect(page.pagination.total).toBe(3);
      expect(page.pagination.totalPages).toBe(2);
      expect(page.pagination.hasNextPage).toBe(true);
    });
  });

  describe('list', () => {
    it('searches by order number within the tenant', async () => {
      const order = await createFor(ownerA, customerA);

      const { orders } = await listFor(ownerA, { search: order.orderNumber, limit: 10 });

      expect(orders.map((entry) => entry.id)).toContain(order.id);
      expect(orders.every((entry) => entry.orderNumber === order.orderNumber)).toBe(true);
    });

    it('filters by status', async () => {
      const order = await createFor(ownerA, customerA);
      await changeOrderStatus(ownerA, order.id, 'CONFIRMED');

      const { orders } = await listFor(ownerA, { status: 'CONFIRMED', limit: 100 });

      expect(orders.map((entry) => entry.id)).toContain(order.id);
      expect(orders.every((entry) => entry.status === 'CONFIRMED')).toBe(true);
    });

    it('sorts by the padded order number so lexical order is numeric order', async () => {
      const { orders } = await listFor(ownerA, { sort: 'orderNumber', order: 'asc', limit: 100 });

      const numbers = orders.map((entry) => entry.orderNumber);
      expect(numbers).toEqual([...numbers].sort());
      expect(numbers[0]).toBe('ORD-000001');
    });

    it("never returns another organization's orders", async () => {
      await createFor(ownerB, customerB);

      const inA = await listFor(ownerA);
      const inB = await listFor(ownerB);

      expect(inA.orders.length).toBeGreaterThan(0);
      expect(inB.orders.length).toBeGreaterThan(0);

      const idsInB = new Set(inB.orders.map((order) => order.id));
      expect(inA.orders.some((order) => idsInB.has(order.id))).toBe(false);
      expect(inB.orders.every((order) => order.customer.id === customerB)).toBe(true);
      expect(inA.pagination.total).toBe(inA.orders.length);
    });

    it('returns an empty page rather than an error past the last page', async () => {
      const result = await listFor(ownerA, { page: 9_999 });

      expect(result.orders).toEqual([]);
      expect(result.pagination.hasNextPage).toBe(false);
    });
  });

  describe('writes cannot cross the tenant boundary', () => {
    it("treats another organization's order id as missing on every write path", async () => {
      const foreign = await createFor(ownerB, customerB);

      const attempts = [
        () => updateOrder(ownerA, foreign.id, updateOrderSchema.parse({ discount: '1.00' })),
        () => changeOrderStatus(ownerA, foreign.id, 'CONFIRMED'),
        () => cancelOrder(ownerA, foreign.id, 'nope'),
        () => assignOrder(ownerA, foreign.id, clerkA.userId),
        () => addOrderNote(ownerA, foreign.id, 'nope'),
        () => listOrderActivities(ownerA, foreign.id, orderActivityQuerySchema.parse({})),
      ];

      for (const attempt of attempts) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(NotFoundError);
        expect((error as Error).message).toBe('Order not found.');
      }

      const unchanged = await getOrder(ownerB, foreign.id);
      expect(unchanged.status).toBe('PENDING');
      expect(unchanged.assignedUserId).toBeNull();
      expect(unchanged.notes).toBeNull();
    });
  });

  describe('stats', () => {
    it("counts and sums only the caller organization's orders", async () => {
      const statsA = await getOrderStats(ownerA);
      const statsB = await getOrderStats(ownerB);

      expect(statsA.total).toBe(await db.order.count({ where: { organizationId: ORG_A } }));
      expect(statsB.total).toBe(await db.order.count({ where: { organizationId: ORG_B } }));
      expect(statsA.total).not.toBe(statsB.total);
    });

    it('excludes cancelled orders from revenue but not from the total', async () => {
      const statsBefore = await getOrderStats(ownerC);
      expect(statsBefore).toMatchObject({
        total: 0,
        open: 0,
        pending: 0,
        processing: 0,
        delivered: 0,
        cancelled: 0,
        revenue: '0.00',
      });

      const first = await createFor(ownerC, customerC, {
        items: [{ productName: 'One', quantity: 1, unitPrice: '30.00' }],
      });
      const second = await createFor(ownerC, customerC, {
        items: [{ productName: 'Two', quantity: 1, unitPrice: '30.00' }],
      });
      const third = await createFor(ownerC, customerC, {
        items: [{ productName: 'Three', quantity: 1, unitPrice: '30.00' }],
      });

      await cancelOrder(ownerC, third.id, 'Called off');

      const afterCancel = await getOrderStats(ownerC);
      expect(afterCancel).toMatchObject({
        total: 3,
        open: 2,
        pending: 2,
        processing: 0,
        delivered: 0,
        cancelled: 1,
        revenue: '60.00',
        newLast30Days: 3,
      });

      // Mid-way, the second order shows up in the processing stage.
      await changeOrderStatus(ownerC, second.id, 'CONFIRMED');
      await changeOrderStatus(ownerC, second.id, 'PROCESSING');

      const afterProcessing = await getOrderStats(ownerC);
      expect(afterProcessing).toMatchObject({
        total: 3,
        open: 2,
        pending: 1,
        processing: 1,
        shipped: 0,
        delivered: 0,
        cancelled: 1,
        revenue: '60.00',
      });

      // Delivering one leaves `open` at one: delivered is also no longer open.
      await changeOrderStatus(ownerC, second.id, 'SHIPPED');
      await changeOrderStatus(ownerC, second.id, 'DELIVERED');

      const afterDelivery = await getOrderStats(ownerC);
      expect(afterDelivery).toMatchObject({
        total: 3,
        open: 1,
        pending: 1,
        processing: 0,
        shipped: 0,
        delivered: 1,
        cancelled: 1,
        revenue: '60.00',
      });
      expect(afterDelivery.total).toBeGreaterThan(afterDelivery.open);
      expect(first.total).toBe('30.00');
    });
  });

  describe('order numbers', () => {
    it('never hands the same number to two orders in one organization', async () => {
      const { orders } = await listFor(ownerA, { limit: 100 });
      const numbers = orders.map((order) => order.orderNumber);

      expect(numbers.length).toBeGreaterThan(3);
      expect(new Set(numbers).size).toBe(numbers.length);
      expect(numbers.every((number) => /^ORD-\d{6,}$/.test(number))).toBe(true);
    });
  });
});
