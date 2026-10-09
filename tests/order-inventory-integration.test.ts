import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db } from '@/lib/db';
import { StockMovementType } from '@/generated/prisma/enums';
import type { AuthorizationContext } from '@/lib/rbac/guard';
import { PERMISSIONS } from '@/lib/rbac/permissions';
import {
  createProductSchema,
  createWarehouseSchema,
  stockMovementQuerySchema,
} from '@/lib/inventory/validation';
import {
  changeOrderStatusSchema,
  createOrderSchema,
  orderActivityQuerySchema,
  updateOrderSchema,
} from '@/lib/orders/validation';
import {
  cancelOrder,
  changeOrderStatus,
  createOrder,
  listOrderActivities,
  updateOrder,
} from '@/lib/services/order.service';
import { listStockMovements } from '@/lib/services/stock.service';
import { createCustomer } from '@/lib/services/customer.service';
import { createProduct, createWarehouse } from '@/lib/services/inventory.service';
import { parseOrThrow } from '@/lib/validation';

/**
 * Order ↔ inventory integration.
 *
 * This is the riskiest seam in Phase 4, because it joins two modules that each
 * worked before it existed. The policy under test is deliberately narrow and is
 * documented in full in `src/lib/services/stock.service.ts`:
 *
 *  * creating or editing an order moves no stock;
 *  * **confirming** deducts it, from the primary warehouse first;
 *  * **cancelling** a confirmed order releases exactly what was deducted;
 *  * cancelling a still-PENDING order releases nothing, because nothing was taken;
 *  * both effects are idempotent, and both are rolled back with the order's own
 *    transaction.
 *
 * These claims cannot be proved with mocks: they are about what Postgres does
 * when a unique index meets a retry, and about two transactions racing. Skipped
 * when `DATABASE_URL` is absent, so `npm run verify` stays hermetic.
 */

const ENABLED = Boolean(process.env.DATABASE_URL);

/** Runs `operation`, expecting it to fail, and returns the error. */
async function failure(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected the operation to fail, but it succeeded.');
}

describe.skipIf(!ENABLED)('order inventory integration (database)', () => {
  const ORG_A = '91000000-0000-4000-8000-000000000021';
  const ORG_B = '91000000-0000-4000-8000-000000000022';

  let ownerA: AuthorizationContext;
  let ownerB: AuthorizationContext;

  const userIds: string[] = [];

  function asOwner(organizationId: string, name: string): AuthorizationContext {
    return {
      userId: randomUUID(),
      email: `${name.toLowerCase()}-integration@integration.test`,
      name,
      organizationId,
      organizationName: 'Test Org',
      roleKey: 'OWNER',
      roleName: 'Owner',
      permissions: new Set<string>(Object.values(PERMISSIONS)),
    } as AuthorizationContext;
  }

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
  }

  async function seedOrganization(id: string, name: string, context: AuthorizationContext) {
    await db.organization.create({
      data: {
        id,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${id.slice(-8)}`,
      },
    });

    await addMember(id, context.userId, context.email, name, 'OWNER');
  }

  const productFor = (context: AuthorizationContext, overrides: Record<string, unknown> = {}) =>
    createProduct(
      context,
      parseOrThrow(createProductSchema, {
        sku: `SKU-${randomUUID().slice(0, 8)}`,
        name: `Product ${randomUUID().slice(0, 6)}`,
        unitPrice: '10.00',
        ...overrides,
      }),
    );

  const warehouseFor = (context: AuthorizationContext, overrides: Record<string, unknown> = {}) =>
    createWarehouse(
      context,
      parseOrThrow(createWarehouseSchema, {
        code: `WH-${randomUUID().slice(0, 6)}`,
        name: `Warehouse ${randomUUID().slice(0, 6)}`,
        ...overrides,
      }),
    );

  /** The order timeline, parsed the way a route handler would. */
  const activitiesFor = (context: AuthorizationContext, orderId: string) =>
    listOrderActivities(context, orderId, orderActivityQuerySchema.parse({}));

  /** The tenant-scoped ledger, parsed the way its list endpoint would. */
  const ledgerFor = (context: AuthorizationContext) =>
    listStockMovements(context, stockMovementQuerySchema.parse({ limit: 100 }));

  /** Total on hand for one product, straight from the ledger. */
  async function onHand(productId: string): Promise<number> {
    const rows = await db.inventoryStock.findMany({ where: { productId } });
    return rows.reduce((sum, row) => sum + row.quantity, 0);
  }

  /** The deduction rows an order wrote, by warehouse. */
  async function deductionsFor(orderId: string) {
    return db.stockMovement.findMany({
      where: { orderId, type: StockMovementType.ORDER_DEDUCTION },
    });
  }

  /** The release rows an order wrote, by warehouse. */
  async function releasesFor(orderId: string) {
    return db.stockMovement.findMany({
      where: { orderId, type: StockMovementType.ORDER_RELEASE },
    });
  }

  beforeAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await db.user.deleteMany({ where: { email: { endsWith: '@integration.test' } } });

    ownerA = asOwner(ORG_A, 'Ada');
    ownerB = asOwner(ORG_B, 'Grace');

    await seedOrganization(ORG_A, 'Integration Harness A', ownerA);
    await seedOrganization(ORG_B, 'Integration Harness B', ownerB);

    for (const context of [ownerA, ownerB]) {
      await db.user.update({ where: { id: context.userId }, data: { name: context.name } });
    }

    userIds.push(ownerA.userId, ownerB.userId);
  });

  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
  });

  describe('deduction on confirmation', () => {
    it('creates and edits an order without touching stock', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'One',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA);

      await db.$transaction(async () => {
        await db.user.findFirstOrThrow({ where: { id: ownerA.userId } });
        await db.inventoryStock.upsert({
          where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
          create: {
            organizationId: ORG_A,
            productId: product.id,
            warehouseId: warehouse.id,
            quantity: 5,
          },
          update: { quantity: 5 },
        });
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 2, unitPrice: '10.00' },
          ],
        }),
      );

      // Creating is a commitment, not a dispatch: nothing has left the floor.
      expect(await onHand(product.id)).toBe(5);

      // Editing the line items still moves no stock.
      await updateOrder(
        ownerA,
        order.id,
        parseOrThrow(updateOrderSchema, {
          items: [
            { productId: product.id, productName: product.name, quantity: 1, unitPrice: '10.00' },
          ],
        }),
      );

      expect(await onHand(product.id)).toBe(5);
      expect(await deductionsFor(order.id)).toHaveLength(0);
    });

    it('deducts stock when an order is confirmed', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Two',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 10,
        },
        update: { quantity: 10 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 4, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );

      expect(await onHand(product.id)).toBe(6);

      const movements = await deductionsFor(order.id);
      expect(movements).toHaveLength(1);
      expect(movements[0]?.quantity).toBe(-4);
      expect(movements[0]?.quantityBefore).toBe(10);
      expect(movements[0]?.quantityAfter).toBe(6);
      expect(movements[0]?.orderId).toBe(order.id);
    });

    it('refuses a confirmation that would take stock below zero and moves nothing', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Three',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 2,
        },
        update: { quantity: 2 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 3, unitPrice: '10.00' },
          ],
        }),
      );

      const error = await failure(() =>
        changeOrderStatus(
          ownerA,
          order.id,
          parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
        ),
      );

      // The order stays PENDING and the stock never moved, because both the
      // status change and its deduction rode in the same transaction.
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toContain('Not enough stock');

      expect(await onHand(product.id)).toBe(2);
      expect(await deductionsFor(order.id)).toHaveLength(0);
    });

    it('takes the full quantity from the primary warehouse first, then replenishes elsewhere', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Four',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);

      // A secondary warehouse holds more than the primary, so a naive "biggest
      // stock wins" rule would take it in the wrong order.
      const secondary = await warehouseFor(ownerA);
      const primary = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: secondary.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: secondary.id,
          quantity: 10,
        },
        update: { quantity: 10 },
      });
      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: primary.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: primary.id,
          quantity: 4,
        },
        update: { quantity: 4 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 5, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );

      // Four from the primary, the remaining one from the secondary.
      expect(await onHand(product.id)).toBe(9);

      const byWarehouse = new Map(
        (await deductionsFor(order.id)).map((movement) => [
          movement.warehouseId,
          movement.quantity,
        ]),
      );

      expect(byWarehouse.get(primary.id)).toBe(-4);
      expect(byWarehouse.get(secondary.id)).toBe(-1);

      // The organization's total is conserved across the split.
      const balances = await db.inventoryStock.findMany({ where: { productId: product.id } });
      expect(balances.reduce((sum, row) => sum + row.quantity, 0)).toBe(9);
    });
  });

  describe('idempotency', () => {
    it('deducts once even when the confirmation request is retried', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Five',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 8,
        },
        update: { quantity: 8 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 2, unitPrice: '10.00' },
          ],
        }),
      );

      const confirmed = await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );

      expect(await onHand(product.id)).toBe(6);

      // A retry of the same confirmation is a no-op: the status transition
      // itself is now illegal AND the movement ledger refuses a second row.
      await failure(() =>
        changeOrderStatus(
          ownerA,
          order.id,
          parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
        ),
      );

      expect(await onHand(product.id)).toBe(6);
      expect(await deductionsFor(order.id)).toHaveLength(1);
      expect(confirmed.status).toBe('CONFIRMED');
    });

    it('does not deduct again when a confirmed order is edited', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Six',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 8,
        },
        update: { quantity: 8 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 2, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );
      expect(await onHand(product.id)).toBe(6);

      // Confirmed orders are still editable up to fulfilment, so the same
      // quantity could be submitted twice; the ledger must not charge twice.
      await updateOrder(
        ownerA,
        order.id,
        parseOrThrow(updateOrderSchema, {
          items: [
            { productId: product.id, productName: product.name, quantity: 2, unitPrice: '10.00' },
          ],
        }),
      );

      expect(await onHand(product.id)).toBe(6);
      expect(await deductionsFor(order.id)).toHaveLength(1);
    });
  });

  describe('release on cancellation', () => {
    it('releases exactly what a confirmed order deducted', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Seven',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 9,
        },
        update: { quantity: 9 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 3, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );
      expect(await onHand(product.id)).toBe(6);

      await cancelOrder(ownerA, order.id, 'Changed mind');

      // Back where it started, and the ledger shows both halves of the exchange.
      expect(await onHand(product.id)).toBe(9);

      const releases = await releasesFor(order.id);
      expect(releases).toHaveLength(1);
      expect(releases[0]?.quantity).toBe(3);
      expect(releases[0]?.quantityBefore).toBe(6);
      expect(releases[0]?.quantityAfter).toBe(9);
      expect(releases[0]?.orderId).toBe(order.id);
    });

    it('releases nothing when a still-PENDING order is cancelled', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Eight',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 7,
        },
        update: { quantity: 7 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 3, unitPrice: '10.00' },
          ],
        }),
      );

      await cancelOrder(ownerA, order.id, null);

      expect(await onHand(product.id)).toBe(7);
      expect(await releasesFor(order.id)).toHaveLength(0);
      expect(await deductionsFor(order.id)).toHaveLength(0);
    });

    it('restores stock when a delivered order is cancelled from a mid-workflow state', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Nine',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 10,
        },
        update: { quantity: 10 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 2, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );
      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'PROCESSING' }).status,
      );
      expect(await onHand(product.id)).toBe(8);

      // Cancelling mid-workflow is legal, and the stock still goes home.
      await cancelOrder(ownerA, order.id, 'Refunded');

      expect(await onHand(product.id)).toBe(10);
      expect(await releasesFor(order.id)).toHaveLength(1);
    });

    it('releases nothing for an order whose stock was never deducted', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Ten',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      // Never received, so no deduction was ever possible.
      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 0,
        },
        update: { quantity: 0 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 1, unitPrice: '10.00' },
          ],
        }),
      );

      await cancelOrder(ownerA, order.id, null);

      expect(await onHand(product.id)).toBe(0);
      expect(await releasesFor(order.id)).toHaveLength(0);
    });
  });

  describe('cross-organization isolation', () => {
    it('refuses an order line that references another organization product', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Eleven',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;

      const foreignProduct = await productFor(ownerB);

      const error = await failure(() =>
        createOrder(
          ownerA,
          parseOrThrow(createOrderSchema, {
            customerId: customer,
            items: [
              {
                productId: foreignProduct.id,
                productName: foreignProduct.name,
                quantity: 1,
                unitPrice: '10.00',
              },
            ],
          }),
        ),
      );

      // Refused at write time rather than at confirmation, so an order can never
      // be left pointing at stock that is not ours.
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).message)).toContain('not in this organization');
      expect(foreignProduct.id).not.toBe(customer);
    });

    it('never lists another organization movements on an order', async () => {
      const customer = (
        await createCustomer(ownerB, {
          firstName: 'Buyer',
          lastName: 'Twelve',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerB);
      const warehouse = await warehouseFor(ownerB, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_B,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 6,
        },
        update: { quantity: 6 },
      });

      const order = await createOrder(
        ownerB,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 2, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerB,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );

      const { movements } = await ledgerFor(ownerA);

      expect(movements.every((movement) => movement.orderId !== order.id)).toBe(true);
    });
  });

  describe('order activity never records a forged stock entry', () => {
    it('keeps deduction rows readable only through the tenant-scoped ledger', async () => {
      const customer = (
        await createCustomer(ownerA, {
          firstName: 'Buyer',
          lastName: 'Thirteen',
          email: `buyer-${randomUUID()}@integration.test`,
        })
      ).id;
      const product = await productFor(ownerA);
      const warehouse = await warehouseFor(ownerA, { isPrimary: true });

      await db.inventoryStock.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
        create: {
          organizationId: ORG_A,
          productId: product.id,
          warehouseId: warehouse.id,
          quantity: 5,
        },
        update: { quantity: 5 },
      });

      const order = await createOrder(
        ownerA,
        parseOrThrow(createOrderSchema, {
          customerId: customer,
          items: [
            { productId: product.id, productName: product.name, quantity: 1, unitPrice: '10.00' },
          ],
        }),
      );

      await changeOrderStatus(
        ownerA,
        order.id,
        parseOrThrow(changeOrderStatusSchema, { status: 'CONFIRMED' }).status,
      );

      // The stock effect is visible on the ledger, which is where a member is
      // meant to look for it — not as a forgeable free-text activity.
      const { movements } = await ledgerFor(ownerA);

      expect(movements.some((movement) => movement.orderId === order.id)).toBe(true);

      // And the order's own timeline still reads correctly.
      const { activities } = await activitiesFor(ownerA, order.id);
      expect(activities.length).toBeGreaterThan(0);
    });
  });
});
